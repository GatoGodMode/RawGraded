<?php
require_once dirname(__FILE__) . '/db.php';

$user = requireAuth();
$isAdmin = ($user['role'] ?? '') === 'admin';

$input = json_decode(file_get_contents('php://input'), true);
if (!$input || empty($input['cert_id'])) {
    sendResponse(['error' => 'Missing cert_id'], 400);
}

$cert_id = $input['cert_id'];
$refresh  = !empty($input['refresh']) && $isAdmin; // Only admins can force a refresh

// ---------------------------------------------------------------
// 1. Load certificate — fail fast with a clean error if migration
//    hasn't run yet (columns won't exist → prepare returns false).
// ---------------------------------------------------------------
try {
    $stmt = $conn->prepare(
        "SELECT user_id, name, card_set,
                market_price_unlocked, market_price_json, market_price_fetched_at
         FROM   certificates WHERE id = ?"
    );
    if (!$stmt) {
        sendResponse([
            'error'   => 'DB not ready — please run update_db_market.php first.',
            'success' => false
        ], 500);
    }
    $stmt->bind_param("s", $cert_id);
    $stmt->execute();
    $cert = $stmt->get_result()->fetch_assoc();
} catch (\Throwable $e) {
    sendResponse(['error' => 'DB error: ' . $e->getMessage(), 'success' => false], 500);
}

if (!$cert) {
    sendResponse(['error' => 'Certificate not found'], 404);
}

// ---------------------------------------------------------------
// 2. Ownership / access check
// ---------------------------------------------------------------
if (!$isAdmin && (string)$cert['user_id'] !== (string)$user['id']) {
    sendResponse(['error' => 'Unauthorized'], 403);
}

$already_unlocked = (int)($cert['market_price_unlocked'] ?? 0) === 1;

// ---------------------------------------------------------------
// 3. Credit deduction — only when NOT yet unlocked AND not admin
// ---------------------------------------------------------------
if (!$already_unlocked && !$isAdmin) {
    try {
        $stmt = $conn->prepare("SELECT paid_credits FROM users WHERE id = ?");
        $stmt->bind_param("s", $user['id']);
        $stmt->execute();
        $uRow    = $stmt->get_result()->fetch_assoc();
        $credits = (int)($uRow['paid_credits'] ?? 0);
    } catch (\Throwable $e) {
        sendResponse(['error' => 'Credit check failed', 'success' => false], 500);
    }

    if ($credits < 1) {
        sendResponse(['error' => 'Not enough Pro Credits', 'code' => 'CREDITS_REQUIRED', 'success' => false], 403);
    }

    $conn->begin_transaction();
    try {
        $stmt = $conn->prepare("UPDATE users SET paid_credits = paid_credits - 1 WHERE id = ? AND paid_credits >= 1");
        $stmt->bind_param("s", $user['id']);
        $stmt->execute();
        if ($stmt->affected_rows === 0) throw new \Exception("Concurrent credit deduction conflict.");

        // Unlock ALL copies of this same card (name + set) belonging to this user — one credit covers them all
        $stmt = $conn->prepare("UPDATE certificates SET market_price_unlocked = 1 WHERE user_id = ? AND name = ? AND card_set = ?");
        $stmt->bind_param("sss", $user['id'], $cert['name'], $cert['card_set']);
        $stmt->execute();

        $conn->commit();
        $user['paid_credits'] = $credits - 1;
        $already_unlocked     = true;
    } catch (\Throwable $e) {
        $conn->rollback();
        sendResponse(['error' => 'Failed to process credit: ' . $e->getMessage(), 'success' => false], 500);
    }
} elseif ($isAdmin && !$already_unlocked) {
    // Admin unlocks for free — mark all copies of this card for the requesting user
    try {
        $stmt = $conn->prepare("UPDATE certificates SET market_price_unlocked = 1 WHERE name = ? AND card_set = ?");
        $stmt->bind_param("ss", $cert['name'], $cert['card_set']);
        $stmt->execute();
        $already_unlocked = true;
    } catch (\Throwable $e) {
        // Non-fatal — still continue to return data
    }
}

// ---------------------------------------------------------------
// 4. Global synchronistic 24-hour cache check
// ---------------------------------------------------------------
$cached_json         = null;
$needs_external_fetch = true;

if (!$refresh && !empty($cert['name']) && !empty($cert['card_set'])) {
    try {
        $cacheStmt = $conn->prepare(
            "SELECT market_price_json
             FROM   certificates
             WHERE  name = ? AND card_set = ?
               AND  market_price_json IS NOT NULL
               AND  market_price_fetched_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
             ORDER  BY market_price_fetched_at DESC
             LIMIT 1"
        );
        $cacheStmt->bind_param("ss", $cert['name'], $cert['card_set']);
        $cacheStmt->execute();
        $cacheRow = $cacheStmt->get_result()->fetch_assoc();

        if ($cacheRow && !empty($cacheRow['market_price_json'])) {
            $cached_json          = $cacheRow['market_price_json'];
            $needs_external_fetch = false;

            // Backfill this cert if it somehow doesn't have the json yet
            if (empty($cert['market_price_json'])) {
                try {
                    $upd = $conn->prepare("UPDATE certificates SET market_price_json = ?, market_price_fetched_at = CURRENT_TIMESTAMP WHERE id = ?");
                    $upd->bind_param("ss", $cached_json, $cert_id);
                    $upd->execute();
                } catch (\Throwable $e) { /* non-fatal */ }
            }
        }
    } catch (\Throwable $e) {
        // Cache check failed — fall through to live API
    }
}

// ---------------------------------------------------------------
// 5. External API fetch (only when truly needed)
// ---------------------------------------------------------------
if ($needs_external_fetch) {
    require_once dirname(__FILE__) . '/market_helper.php';
    $cached_json = fetchMarketData($conn, $cert_id, $cert['name'], $cert['card_set'], (float)($cert['overall_grade'] ?? 0));
}
// ---------------------------------------------------------------
// 6. Return
// ---------------------------------------------------------------
$out = [
    'success'     => true,
    'unlocked'    => true,
    'market_data' => json_decode($cached_json, true)
];
if (isset($user['paid_credits'])) {
    $out['paid_credits'] = $user['paid_credits'];
}

sendResponse($out);
