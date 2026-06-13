<?php
/**
 * Platform access: 7-day trial (DB), Stripe subscription, or grandfathered legacy users.
 * Include after db.php (provides $conn, requireAuth, sendResponse).
 */
if (!function_exists('sendResponse')) {
    require_once(__DIR__ . '/db.php');
}

function membership_table_exists($conn, $table) {
    $r = $conn->query("SHOW TABLES LIKE " . $conn->real_escape_string($table));
    return $r && $r->num_rows > 0;
}

function membership_has_columns($conn) {
    static $cached = null;
    if ($cached !== null) return $cached;
    $cached = $conn->query("SHOW COLUMNS FROM `users` LIKE 'access_state'")->num_rows > 0;
    return $cached;
}

function membership_vip_lifetime_column($conn) {
    static $cached = null;
    if ($cached !== null) return $cached;
    return $cached = ($conn->query("SHOW COLUMNS FROM `users` LIKE 'vip_lifetime'")->num_rows > 0);
}

/**
 * Expire local trial if past trial_ends_at and no active sub; set access_state to lapsed.
 */
function membership_refresh_user_access($conn, $userId) {
    if (!membership_has_columns($conn)) return;
    $userId = (int)$userId;
    $vipCol = membership_vip_lifetime_column($conn) ? ', vip_lifetime' : '';
    $stmt = $conn->prepare("SELECT id, role, access_state, trial_ends_at$vipCol FROM users WHERE id = ? LIMIT 1");
    $stmt->bind_param("i", $userId);
    $stmt->execute();
    $u = $stmt->get_result()->fetch_assoc();
    if (!$u) return;

    if (($u['role'] ?? '') === 'admin') return;

    if (!empty($u['vip_lifetime'])) return;

    $state = $u['access_state'] ?? 'none';
    if ($state === 'grandfathered' || $state === 'active' || $state === 'past_due') return;

    if ($state === 'trialing' && !empty($u['trial_ends_at'])) {
        $end = strtotime($u['trial_ends_at']);
        if ($end && time() > $end) {
            if (membership_user_has_active_subscription($conn, $userId)) {
                $upd = $conn->prepare("UPDATE users SET access_state = 'active' WHERE id = ?");
                $upd->bind_param("i", $userId);
                $upd->execute();
                return;
            }
            $upd = $conn->prepare("UPDATE users SET access_state = 'lapsed' WHERE id = ?");
            $upd->bind_param("i", $userId);
            $upd->execute();
        }
    }
}

function membership_user_has_active_subscription($conn, $userId) {
    if (!membership_table_exists($conn, 'user_subscriptions')) return false;
    $userId = (int)$userId;
    $stmt = $conn->prepare("SELECT 1 FROM user_subscriptions WHERE user_id = ? AND status IN ('active','trialing') LIMIT 1");
    $stmt->bind_param("i", $userId);
    $stmt->execute();
    return $stmt->get_result()->num_rows > 0;
}

/**
 * Returns true if user may use paid platform features (grading, vault writes, etc.).
 */
function membership_user_can_use_platform($conn, $userRow) {
    if (!membership_has_columns($conn)) return true;
    $role = $userRow['role'] ?? 'user';
    if ($role === 'admin') return true;
    if (!empty($userRow['vip_lifetime'])) return true;

    $state = $userRow['access_state'] ?? 'none';
    if ($state === 'grandfathered') return true;
    if ($state === 'active') return true;
    if ($state === 'past_due') return false;

    if ($state === 'trialing') {
        $end = !empty($userRow['trial_ends_at']) ? strtotime($userRow['trial_ends_at']) : 0;
        if ($end && time() <= $end) return true;
        return membership_user_has_active_subscription($conn, (int)$userRow['id']);
    }

    if ($state === 'lapsed' || $state === 'none') {
        return membership_user_has_active_subscription($conn, (int)$userRow['id']);
    }

    return false;
}

/**
 * Append access_state, trial_ends_at, has_platform_access to session user payload ($payload must include id and role).
 */
function membership_enrich_user_payload($conn, &$payload) {
    if (($payload['role'] ?? '') === 'admin') {
        $payload['has_platform_access'] = true;
        $payload['access_state'] = $payload['access_state'] ?? 'active';
        return;
    }
    if (!membership_has_columns($conn)) {
        $payload['has_platform_access'] = true;
        $payload['access_state'] = 'grandfathered';
        return;
    }
    $uid = (int)($payload['id'] ?? 0);
    if ($uid) membership_refresh_user_access($conn, $uid);

    $vipCol = membership_vip_lifetime_column($conn) ? ', vip_lifetime' : '';
    $stmt = $conn->prepare("SELECT access_state, trial_started_at, trial_ends_at, stripe_customer_id, application_id$vipCol FROM users WHERE id = ? LIMIT 1");
    $stmt->bind_param("i", $uid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    if (!$row) return;

    $payload['access_state'] = $row['access_state'] ?? 'none';
    $payload['trial_started_at'] = $row['trial_started_at'] ?? null;
    $payload['trial_ends_at'] = $row['trial_ends_at'] ?? null;
    $payload['stripe_customer_id'] = $row['stripe_customer_id'] ?? null;
    $payload['application_id'] = isset($row['application_id']) ? (int)$row['application_id'] : null;
    $payload['vip_lifetime'] = (membership_vip_lifetime_column($conn) && !empty($row['vip_lifetime'])) ? 1 : 0;
    $payload['has_platform_access'] = membership_user_can_use_platform($conn, array_merge($payload, $row));
}

function require_active_platform_membership($conn) {
    $user = requireAuth();
    $uid = (int)$user['id'];
    $vipCol = membership_vip_lifetime_column($conn) ? ', vip_lifetime' : '';
    $stmt = $conn->prepare("SELECT id, role, access_state, trial_ends_at$vipCol FROM users WHERE id = ? LIMIT 1");
    $stmt->bind_param("i", $uid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    if (!$row) {
        sendResponse(['error' => 'User not found', 'code' => 'USER_NOT_FOUND'], 401);
    }
    membership_refresh_user_access($conn, $uid);
    $stmt = $conn->prepare("SELECT id, role, access_state, trial_ends_at$vipCol FROM users WHERE id = ? LIMIT 1");
    $stmt->bind_param("i", $uid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();

    if (!membership_user_can_use_platform($conn, $row)) {
        $code = 'TRIAL_EXPIRED';
        if (($row['access_state'] ?? '') === 'lapsed' || ($row['access_state'] ?? '') === 'none') {
            $code = 'SUBSCRIPTION_REQUIRED';
        }
        sendResponse(['error' => 'An active membership or trial is required.', 'code' => $code, 'access_state' => $row['access_state'] ?? 'none'], 402);
    }
    return $user;
}
