<?php
/**
 * Expire local trials and set access_state=lapsed when appropriate.
 * Run daily: php access_refresh_cron.php
 * Or HTTP: /api/access_refresh_cron.php?key=YOUR_ai_worker_secret
 */
require_once(__DIR__ . '/db.php');
require_once(__DIR__ . '/membership.php');

$ok = (php_sapi_name() === 'cli');
if (!$ok) {
    $key = $_GET['key'] ?? '';
    $stmt = $conn->prepare("SELECT `value` FROM settings WHERE `key` = 'ai_worker_secret'");
    if ($stmt && $stmt->execute()) {
        $r = $stmt->get_result()->fetch_assoc();
        $secret = $r['value'] ?? '';
        $ok = ($secret !== '' && hash_equals($secret, $key));
    }
}
if (!$ok) {
    header('Content-Type: application/json');
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

if (!membership_has_columns($conn)) {
    sendResponse(['ok' => true, 'updated' => 0, 'message' => 'No membership columns']);
}

$res = $conn->query("SELECT id FROM users WHERE access_state = 'trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at < NOW()");
$n = 0;
while ($res && ($row = $res->fetch_assoc())) {
    membership_refresh_user_access($conn, (int)$row['id']);
    $n++;
}

header('Content-Type: application/json');
echo json_encode(['ok' => true, 'refreshed_users' => $n]);
