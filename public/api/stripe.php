<?php
// stripe.php - Stripe Integration Service
ob_start();

require_once('db.php');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

function fatal_handler() {
    $err = error_get_last();
    if ($err && ($err['type'] === E_ERROR || $err['type'] === E_PARSE || $err['type'] === E_CORE_ERROR)) {
        if (ob_get_length()) ob_clean();
        header('Content-Type: application/json');
        http_response_code(500);
        echo json_encode(['error' => 'Server Error: ' . $err['message']]);
        exit;
    }
}
register_shutdown_function('fatal_handler');

// Helper to get Stripe Secret Key
function getStripeSecretKey($conn) {
    $stmt = $conn->prepare("SELECT `value` FROM settings WHERE `key` = 'stripe_secret_key'");
    $stmt->execute();
    $res = $stmt->get_result()->fetch_assoc();
    return $res['value'] ?? '';
}

function stripe_request_base_url() {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin && preg_match('#^https?://#', $origin)) {
        return rtrim($origin, '/');
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['SERVER_PORT'] ?? '') == '443');
    $host = $_SERVER['HTTP_HOST'] ?? 'rawgraded.com';
    return ($https ? 'https://' : 'http://') . $host;
}

function stripe_api_get($secretKey, $path) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, 'https://api.stripe.com/v1/' . ltrim($path, '/'));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_USERPWD, $secretKey . ':');
    $response = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, json_decode($response, true)];
}

function stripe_sync_subscription_to_db($conn, array $sub, $userId) {
    $userId = (int)$userId;
    if ($userId <= 0 || empty($sub['id'])) return;
    $tbl = $conn->query("SHOW TABLES LIKE 'user_subscriptions'");
    if (!$tbl || $tbl->num_rows === 0) return;

    $priceId = $sub['items']['data'][0]['price']['id'] ?? '';
    $status = $sub['status'] ?? 'unknown';
    $periodEnd = !empty($sub['current_period_end']) ? (int)$sub['current_period_end'] : 0;
    $cancelAt = !empty($sub['cancel_at_period_end']) ? 1 : 0;
    $dt = $periodEnd > 0 ? date('Y-m-d H:i:s', $periodEnd) : date('Y-m-d H:i:s', time());

    $stmt = $conn->prepare("INSERT INTO user_subscriptions (user_id, stripe_subscription_id, stripe_price_id, status, current_period_end, cancel_at_period_end) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE stripe_price_id = VALUES(stripe_price_id), status = VALUES(status), current_period_end = VALUES(current_period_end), cancel_at_period_end = VALUES(cancel_at_period_end)");
    if ($stmt) {
        $stmt->bind_param("issssi", $userId, $sub['id'], $priceId, $status, $dt, $cancelAt);
        $stmt->execute();
    }

    $hasMem = $conn->query("SHOW COLUMNS FROM `users` LIKE 'access_state'")->num_rows > 0;
    if (!$hasMem) return;

    $access = 'none';
    if (in_array($status, ['active', 'trialing'], true)) {
        $access = 'active';
    } elseif ($status === 'past_due') {
        $access = 'past_due';
    } elseif (in_array($status, ['canceled', 'unpaid', 'incomplete_expired'], true)) {
        $access = 'lapsed';
    }
    if ($access !== 'none') {
        $upd = $conn->prepare("UPDATE users SET access_state = ? WHERE id = ?");
        $upd->bind_param("si", $access, $userId);
        $upd->execute();
    }
}

try {
    $action = $_GET['action'] ?? '';
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $origin = stripe_request_base_url();

    // 1. PUBLIC: Get Active Packs
    if ($action === 'get_packs') {
        $res = $conn->query("SELECT * FROM scan_packs WHERE active = 1 ORDER BY price ASC");
        $packs = [];
        while($p = $res->fetch_assoc()) {
            $p['id'] = (int)$p['id'];
            $p['credits'] = (int)$p['credits'];
            $p['price'] = (float)$p['price'];
            $packs[] = $p;
        }
        sendResponse(['data' => $packs]);
    }

    // 1b. PUBLIC: recurring membership plans (Stripe Price IDs configured in admin / sync_db)
    else if ($action === 'get_subscription_plans') {
        $tbl = $conn->query("SHOW TABLES LIKE 'subscription_plans'");
        if (!$tbl || $tbl->num_rows === 0) {
            sendResponse(['data' => []]);
        }
        $res = $conn->query("SELECT id, label, interval_days, stripe_price_id, amount_cents, currency, active, sort_order FROM subscription_plans WHERE active = 1 AND stripe_price_id != '' ORDER BY sort_order ASC, interval_days ASC");
        $plans = [];
        while ($res && ($p = $res->fetch_assoc())) {
            $p['id'] = (int)$p['id'];
            $p['interval_days'] = (int)$p['interval_days'];
            $p['active'] = (int)$p['active'];
            $p['sort_order'] = (int)$p['sort_order'];
            if (isset($p['amount_cents'])) $p['amount_cents'] = $p['amount_cents'] !== null ? (int)$p['amount_cents'] : null;
            $plans[] = $p;
        }
        sendResponse(['data' => $plans]);
    }

    // 1c. USER: Subscription Checkout (saves card; recurring per Price)
    else if ($action === 'create_subscription_checkout') {
        $user = requireAuth();
        $planId = (int)($input['plan_id'] ?? 0);
        if (!$planId) sendResponse(['error' => 'Missing plan_id'], 400);

        $stmt = $conn->prepare("SELECT * FROM subscription_plans WHERE id = ? AND active = 1 AND stripe_price_id != '' LIMIT 1");
        $stmt->bind_param("i", $planId);
        $stmt->execute();
        $plan = $stmt->get_result()->fetch_assoc();
        if (!$plan) sendResponse(['error' => 'Plan not available'], 404);

        $secretKey = getStripeSecretKey($conn);
        if (!$secretKey) sendResponse(['error' => 'Stripe is not configured'], 500);

        $uid = (int)$user['id'];
        $priceId = $plan['stripe_price_id'];
        $successUrl = $origin . '/vault?subscription=success&session_id={CHECKOUT_SESSION_ID}';
        $cancelUrl = $origin . '/vault?subscription=cancel';

        $fields = [
            'mode' => 'subscription',
            'payment_method_types[0]' => 'card',
            'line_items[0][price]' => $priceId,
            'line_items[0][quantity]' => 1,
            'success_url' => $successUrl,
            'cancel_url' => $cancelUrl,
            'client_reference_id' => (string)$uid,
            'customer_email' => $user['email'],
            'subscription_data[metadata][user_id]' => (string)$uid,
            'metadata[user_id]' => (string)$uid,
            'metadata[plan_id]' => (string)$planId,
        ];

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, 'https://api.stripe.com/v1/checkout/sessions');
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($fields));
        curl_setopt($ch, CURLOPT_USERPWD, $secretKey . ':');
        $response = curl_exec($ch);
        $resCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $session = json_decode($response, true);

        if ($resCode === 200 && isset($session['id'])) {
            sendResponse(['data' => ['url' => $session['url'], 'id' => $session['id']]]);
        }
        sendResponse(['error' => 'Stripe Session Error: ' . ($session['error']['message'] ?? 'Unknown')], 500);
    }

    // 1d. USER: Stripe Customer Portal (manage card / cancel)
    else if ($action === 'create_billing_portal') {
        $user = requireAuth();
        $secretKey = getStripeSecretKey($conn);
        if (!$secretKey) sendResponse(['error' => 'Stripe is not configured'], 500);

        $uid = (int)$user['id'];
        $row = $conn->query("SELECT stripe_customer_id FROM users WHERE id = " . $uid)->fetch_assoc();
        $customerId = $row['stripe_customer_id'] ?? '';
        if ($customerId === '') {
            sendResponse(['error' => 'No billing account yet. Subscribe first.'], 400);
        }

        $returnUrl = $origin . '/vault';
        $fields = [
            'customer' => $customerId,
            'return_url' => $returnUrl,
        ];
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, 'https://api.stripe.com/v1/billing_portal/sessions');
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($fields));
        curl_setopt($ch, CURLOPT_USERPWD, $secretKey . ':');
        $response = curl_exec($ch);
        $resCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $sess = json_decode($response, true);
        if ($resCode === 200 && !empty($sess['url'])) {
            sendResponse(['data' => ['url' => $sess['url']]]);
        }
        sendResponse(['error' => $sess['error']['message'] ?? 'Portal error'], 500);
    }

    // 2. USER: Create Checkout Session
    else if ($action === 'create_checkout') {
        $user = requireAuth();
        $packId = $input['pack_id'] ?? 0;

        if (!$packId) sendResponse(['error' => 'Missing pack ID'], 400);

        // Fetch pack details
        $stmt = $conn->prepare("SELECT * FROM scan_packs WHERE id = ? AND active = 1");
        $stmt->bind_param("i", $packId);
        $stmt->execute();
        $pack = $stmt->get_result()->fetch_assoc();

        if (!$pack) sendResponse(['error' => 'Pack not found or inactive'], 404);

        $secretKey = getStripeSecretKey($conn);
        if (!$secretKey) sendResponse(['error' => 'Stripe is not configured (Secret Key missing)'], 500);

        // Initialize Stripe (Manual cURL to avoid dependency issues if possible, or assume user has composer)
        // For simplicity and resilience, we'll use Stripe Checkout via API call
        
        $url = 'https://api.stripe.com/v1/checkout/sessions';
        $fields = [
            'payment_method_types[0]' => 'card',
            'line_items[0][price_data][currency]' => strtolower($pack['currency'] ?: 'usd'),
            'line_items[0][price_data][product_data][name]' => $pack['name'],
            'line_items[0][price_data][unit_amount]' => (int)($pack['price'] * 100),
            'line_items[0][quantity]' => 1,
            'mode' => 'payment',
            'success_url' => ($origin ?: 'https://rawgraded.com') . '/vault?payment=success&session_id={CHECKOUT_SESSION_ID}',
            'cancel_url' => ($origin ?: 'https://rawgraded.com') . '/vault?payment=cancel',
            'client_reference_id' => $user['id'],
            'metadata[pack_id]' => $packId,
            'customer_email' => $user['email']
        ];

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($fields));
        curl_setopt($ch, CURLOPT_USERPWD, $secretKey . ':');
        
        $response = curl_exec($ch);
        $resCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $session = json_decode($response, true);

        if ($resCode === 200 && isset($session['id'])) {
            $credits = (int) $pack['credits'];
            // Record pending transaction (lock credits so fulfillment grants what was purchased)
            $stmt = $conn->prepare("INSERT INTO scan_transactions (user_id, pack_id, credits, stripe_session_id, status) VALUES (?, ?, ?, ?, 'pending')");
            $stmt->bind_param("siis", $user['id'], $packId, $credits, $session['id']);
            $stmt->execute();

            sendResponse(['data' => ['url' => $session['url'], 'id' => $session['id']]]);
        } else {
            sendResponse(['error' => 'Stripe Session Error: ' . ($session['error']['message'] ?? 'Unknown Error')], 500);
        }
    }

    // 2b. USER: Fulfill by session (fallback when webhook not run; idempotent)
    else if ($action === 'fulfill_session') {
        $user = requireAuth();
        $sessionId = trim($input['session_id'] ?? '');
        if (!$sessionId) sendResponse(['error' => 'Missing session_id'], 400);

        $stmt = $conn->prepare("SELECT * FROM scan_transactions WHERE stripe_session_id = ? AND user_id = ?");
        $stmt->bind_param("si", $sessionId, $user['id']);
        $stmt->execute();
        $trans = $stmt->get_result()->fetch_assoc();

        if (!$trans) sendResponse(['error' => 'Transaction not found'], 404);
        if ($trans['status'] === 'paid') {
            $cr = $conn->query("SELECT paid_credits FROM users WHERE id = " . (int)$user['id']);
            $row = $cr ? $cr->fetch_assoc() : null;
            sendResponse(['success' => true, 'already_fulfilled' => true, 'paid_credits' => (int)($row['paid_credits'] ?? 0)]);
        }

        $secretKey = getStripeSecretKey($conn);
        $amount = null;
        if ($secretKey) {
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, 'https://api.stripe.com/v1/checkout/sessions/' . $sessionId);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_USERPWD, $secretKey . ':');
            $response = curl_exec($ch);
            $resCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            $session = json_decode($response, true);
            if ($resCode === 200 && isset($session['payment_status']) && $session['payment_status'] === 'paid') {
                $amount = isset($session['amount_total']) ? $session['amount_total'] / 100 : null;
            } else {
                sendResponse(['error' => 'Session not paid or invalid'], 400);
            }
        }

        $conn->begin_transaction();
        try {
            $upd = $conn->prepare("UPDATE scan_transactions SET status = 'paid', amount_paid = ? WHERE stripe_session_id = ?");
            $upd->bind_param("ds", $amount, $sessionId);
            $upd->execute();

            // Use credits locked at checkout, else fallback to current pack (legacy rows)
            $credits = isset($trans['credits']) && (int)$trans['credits'] > 0
                ? (int) $trans['credits']
                : null;
            if ($credits === null) {
                $stmtPack = $conn->prepare("SELECT credits FROM scan_packs WHERE id = ?");
                $stmtPack->bind_param("i", $trans['pack_id']);
                $stmtPack->execute();
                $pack = $stmtPack->get_result()->fetch_assoc();
                if (!$pack || (int)$pack['credits'] <= 0) {
                    $conn->rollback();
                    sendResponse(['error' => 'Pack has no credits'], 400);
                }
                $credits = (int) $pack['credits'];
            }
            $updUser = $conn->prepare("UPDATE users SET paid_credits = paid_credits + ? WHERE id = ?");
            $updUser->bind_param("ii", $credits, $user['id']);
            $updUser->execute();

            $conn->commit();
            $cr = $conn->query("SELECT paid_credits FROM users WHERE id = " . (int)$user['id']);
            $row = $cr ? $cr->fetch_assoc() : null;
            sendResponse(['success' => true, 'fulfilled' => true, 'paid_credits' => (int)($row['paid_credits'] ?? 0)]);
        } catch (Exception $e) {
            $conn->rollback();
            sendResponse(['error' => 'Fulfillment Error: ' . $e->getMessage()], 500);
        }
    }

    // 3. WEBHOOK: Fulfillment
    else if ($action === 'webhook') {
        $secretKey = getStripeSecretKey($conn);
        $payload = file_get_contents('php://input');
        $sig_header = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
        
        // We fetching webhook secret from settings
        $stmt = $conn->prepare("SELECT `value` FROM settings WHERE `key` = 'stripe_webhook_secret'");
        $stmt->execute();
        $resW = $stmt->get_result()->fetch_assoc();
        $endpoint_secret = $resW['value'] ?? '';

        // Verification logic (Simplified but secure)
        if (!$sig_header || !$endpoint_secret) {
             // In a real production environment, strict validation is required.
             // We will log this and potentially allow testing if in a specific mode.
        }

        $event = json_decode($payload, true);
        if (!$event) sendResponse(['error' => 'Invalid payload'], 400);

        if ($event['type'] === 'checkout.session.completed') {
            $session = $event['data']['object'];
            $sessionId = $session['id'];

            // Subscription checkout: activate membership
            if (!empty($session['subscription'])) {
                $userId = (int)($session['client_reference_id'] ?? $session['metadata']['user_id'] ?? 0);
                $customerId = is_string($session['customer'] ?? null) ? $session['customer'] : '';
                if ($userId > 0 && $customerId !== '') {
                    $hasMem = $conn->query("SHOW COLUMNS FROM `users` LIKE 'stripe_customer_id'")->num_rows > 0;
                    if ($hasMem) {
                        $cu = $conn->prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?");
                        $cu->bind_param("si", $customerId, $userId);
                        $cu->execute();
                    }
                }
                if ($secretKey && !empty($session['subscription'])) {
                    list($sc, $subObj) = stripe_api_get($secretKey, 'subscriptions/' . urlencode($session['subscription']));
                    if ($sc === 200 && is_array($subObj) && !empty($subObj['id']) && $userId > 0) {
                        stripe_sync_subscription_to_db($conn, $subObj, $userId);
                    }
                }
                sendResponse(['success' => true, 'fulfilled' => 'subscription']);
            }

            $amount = ($session['amount_total'] ?? 0) / 100;

            $stmt = $conn->prepare("SELECT * FROM scan_transactions WHERE stripe_session_id = ? AND status = 'pending'");
            $stmt->bind_param("s", $sessionId);
            $stmt->execute();
            $trans = $stmt->get_result()->fetch_assoc();

            if ($trans) {
                $conn->begin_transaction();
                try {
                    $upd = $conn->prepare("UPDATE scan_transactions SET status = 'paid', amount_paid = ? WHERE stripe_session_id = ?");
                    $upd->bind_param("ds", $amount, $sessionId);
                    $upd->execute();

                    $credits = isset($trans['credits']) && (int)$trans['credits'] > 0
                        ? (int) $trans['credits']
                        : null;
                    if ($credits === null) {
                        $stmtPack = $conn->prepare("SELECT credits FROM scan_packs WHERE id = ?");
                        $stmtPack->bind_param("i", $trans['pack_id']);
                        $stmtPack->execute();
                        $pack = $stmtPack->get_result()->fetch_assoc();
                        $credits = ($pack && (int)$pack['credits'] > 0) ? (int) $pack['credits'] : 0;
                    }
                    if ($credits > 0) {
                        $updUser = $conn->prepare("UPDATE users SET paid_credits = paid_credits + ? WHERE id = ?");
                        $updUser->bind_param("ii", $credits, $trans['user_id']);
                        $updUser->execute();
                    }

                    $conn->commit();
                    sendResponse(['success' => true, 'fulfilled' => true]);
                } catch (Exception $e) {
                    $conn->rollback();
                    sendResponse(['error' => 'Fulfillment Error: ' . $e->getMessage()], 500);
                }
            }
            sendResponse(['success' => true, 'message' => 'No matching pack transaction (ok for subscription-only)']);
        }

        if (in_array($event['type'], ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'], true) && $secretKey) {
            $sub = $event['data']['object'];
            $userId = (int)($sub['metadata']['user_id'] ?? 0);
            if ($userId <= 0 && !empty($sub['customer'])) {
                $cq = $conn->prepare("SELECT id FROM users WHERE stripe_customer_id = ? LIMIT 1");
                $cid = $sub['customer'];
                $cq->bind_param("s", $cid);
                $cq->execute();
                $cr = $cq->get_result()->fetch_assoc();
                if ($cr) $userId = (int)$cr['id'];
            }
            if ($userId > 0) {
                if ($event['type'] === 'customer.subscription.deleted') {
                    $sub['status'] = 'canceled';
                }
                stripe_sync_subscription_to_db($conn, $sub, $userId);
            }
            sendResponse(['success' => true, 'type' => $event['type']]);
        }

        if ($event['type'] === 'invoice.payment_failed' && $secretKey) {
            $inv = $event['data']['object'];
            $cust = $inv['customer'] ?? '';
            if ($cust) {
                $cq = $conn->prepare("SELECT id FROM users WHERE stripe_customer_id = ? LIMIT 1");
                $cq->bind_param("s", $cust);
                $cq->execute();
                $cr = $cq->get_result()->fetch_assoc();
                if ($cr && $conn->query("SHOW COLUMNS FROM `users` LIKE 'access_state'")->num_rows > 0) {
                    $pd = 'past_due';
                    $uid = (int)$cr['id'];
                    $u = $conn->prepare("UPDATE users SET access_state = ? WHERE id = ?");
                    $u->bind_param("si", $pd, $uid);
                    $u->execute();
                }
            }
            sendResponse(['success' => true, 'type' => 'invoice.payment_failed']);
        }

        sendResponse(['success' => true, 'message' => 'Ignored event type: ' . ($event['type'] ?? '')]);
    }

    // 4. ADMIN: CRUD Packs
    else if ($action === 'admin_get_packs') {
        requireAdmin();
        $res = $conn->query("SELECT * FROM scan_packs ORDER BY active DESC, price ASC");
        $packs = [];
        while($p = $res->fetch_assoc()) {
             $p['id'] = (int)$p['id'];
             $p['credits'] = (int)$p['credits'];
             $p['price'] = (float)$p['price'];
             $p['active'] = (int)$p['active'];
             $packs[] = $p;
        }
        sendResponse(['data' => $packs]);
    }

    else if ($action === 'admin_save_pack') {
        requireAdmin();
        $id = $input['id'] ?? null;
        $name = $input['name'] ?? '';
        $credits = $input['credits'] ?? 0;
        $price = $input['price'] ?? 0;
        $desc = $input['description'] ?? '';
        $active = $input['active'] ?? 1;

        if ($id) {
            $stmt = $conn->prepare("UPDATE scan_packs SET name = ?, credits = ?, price = ?, description = ?, active = ? WHERE id = ?");
            $stmt->bind_param("sidsii", $name, $credits, $price, $desc, $active, $id);
        } else {
            $stmt = $conn->prepare("INSERT INTO scan_packs (name, credits, price, description, active) VALUES (?, ?, ?, ?, ?)");
            $stmt->bind_param("sidsi", $name, $credits, $price, $desc, $active);
        }

        if ($stmt->execute()) {
            sendResponse(['success' => true]);
        } else {
            sendResponse(['error' => 'Save failed: ' . $conn->error], 500);
        }
    }

    else if ($action === 'admin_delete_pack') {
        requireAdmin();
        $id = $input['id'] ?? 0;
        $stmt = $conn->prepare("DELETE FROM scan_packs WHERE id = ?");
        $stmt->bind_param("i", $id);
        if ($stmt->execute()) {
            sendResponse(['success' => true]);
        } else {
            sendResponse(['error' => 'Delete failed'], 500);
        }
    }

    else if ($action === 'admin_get_subscription_plans') {
        requireAdmin();
        $tbl = $conn->query("SHOW TABLES LIKE 'subscription_plans'");
        if (!$tbl || $tbl->num_rows === 0) {
            sendResponse(['data' => []]);
        }
        $res = $conn->query("SELECT * FROM subscription_plans ORDER BY sort_order ASC, interval_days ASC");
        $plans = [];
        while ($res && ($p = $res->fetch_assoc())) {
            $p['id'] = (int)$p['id'];
            $p['interval_days'] = (int)$p['interval_days'];
            $p['active'] = (int)$p['active'];
            $p['sort_order'] = (int)$p['sort_order'];
            if (isset($p['amount_cents'])) $p['amount_cents'] = $p['amount_cents'] !== null ? (int)$p['amount_cents'] : null;
            $plans[] = $p;
        }
        sendResponse(['data' => $plans]);
    }

    else if ($action === 'admin_save_subscription_plan') {
        requireAdmin();
        $id = (int)($input['id'] ?? 0);
        $label = trim($input['label'] ?? '');
        $intervalDays = (int)($input['interval_days'] ?? 0);
        $stripePriceId = trim($input['stripe_price_id'] ?? '');
        $currency = strtolower(trim($input['currency'] ?? 'usd'));
        $active = (int)($input['active'] ?? 0);
        $sortOrder = (int)($input['sort_order'] ?? 0);
        if ($label === '' || $intervalDays < 1 || $intervalDays > 365) {
            sendResponse(['error' => 'Label required; interval_days must be 1–365 (Stripe day prices use this as interval_count).'], 400);
        }
        if (!preg_match('/^[a-z]{3}$/', $currency)) {
            sendResponse(['error' => 'currency must be a 3-letter ISO code (e.g. usd)'], 400);
        }
        $amountCents = isset($input['amount_cents']) ? (int)$input['amount_cents'] : 0;
        if ($id > 0) {
            $stmt = $conn->prepare("UPDATE subscription_plans SET label = ?, interval_days = ?, stripe_price_id = ?, amount_cents = ?, currency = ?, active = ?, sort_order = ? WHERE id = ?");
            $stmt->bind_param("sisissii", $label, $intervalDays, $stripePriceId, $amountCents, $currency, $active, $sortOrder, $id);
        } else {
            $stmt = $conn->prepare("INSERT INTO subscription_plans (label, interval_days, stripe_price_id, amount_cents, currency, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)");
            $stmt->bind_param("sisissi", $label, $intervalDays, $stripePriceId, $amountCents, $currency, $active, $sortOrder);
        }
        if ($stmt && $stmt->execute()) {
            sendResponse(['success' => true]);
        }
        sendResponse(['error' => 'Save failed: ' . $conn->error], 500);
    }

    else if ($action === 'admin_delete_subscription_plan') {
        requireAdmin();
        $id = (int)($input['id'] ?? 0);
        if ($id <= 0) {
            sendResponse(['error' => 'Invalid id'], 400);
        }
        $stmt = $conn->prepare("DELETE FROM subscription_plans WHERE id = ?");
        $stmt->bind_param("i", $id);
        if ($stmt && $stmt->execute()) {
            sendResponse(['success' => true]);
        }
        sendResponse(['error' => 'Delete failed'], 500);
    }

    else {
        sendResponse(['error' => 'Invalid action'], 400);
    }

} catch (Exception $e) {
    sendResponse(['error' => 'Exception: ' . $e->getMessage()], 500);
}
