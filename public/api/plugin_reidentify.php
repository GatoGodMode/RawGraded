<?php
// plugin_reidentify.php
// Charges 1 credit, re-identifies a card via Phase 1 AI results, wipes cached market data.

require_once('db.php');
$user = requireAuth();

$input   = json_decode(file_get_contents('php://input'), true);
$cert_id = trim($input['cert_id'] ?? '');

if (!$cert_id) {
    sendResponse(['error' => 'Missing cert_id'], 400);
}

// 1. Verify the cert exists and is owned by this user
$stmt = $conn->prepare("SELECT user_id FROM certificates WHERE id = ?");
if (!$stmt) {
    sendResponse(['error' => 'Prepare failed: ' . $conn->error], 500);
}
$stmt->bind_param("s", $cert_id);
$stmt->execute();
$certResult = $stmt->get_result();
if ($certResult->num_rows === 0) {
    sendResponse(['error' => 'Certificate not found'], 404);
}
$cert = $certResult->fetch_assoc();

if ($user['role'] !== 'admin' && (string)$cert['user_id'] !== (string)$user['id']) {
    sendResponse(['error' => 'Unauthorized'], 403);
}

// 2. Charge 1 credit (admin bypasses)
if ($user['role'] !== 'admin') {
    $uid = (string)$user['id'];

    $uStmt = $conn->prepare("SELECT scan_limit, scans_this_week, bonus_scans, paid_credits FROM users WHERE id = ?");
    $uStmt->bind_param("s", $uid);
    $uStmt->execute();
    $userData = $uStmt->get_result()->fetch_assoc();

    if (!$userData) {
        sendResponse(['error' => 'User not found'], 404);
    }

    $freeLeft  = max(0, (int)$userData['scan_limit'] - (int)$userData['scans_this_week']);
    $bonusLeft = max(0, (int)$userData['bonus_scans']);
    $paidLeft  = max(0, (int)$userData['paid_credits']);

    if ($freeLeft > 0) {
        $d = $conn->prepare("UPDATE users SET scans_this_week = scans_this_week + 1 WHERE id = ?");
        $d->bind_param("s", $uid);
        $d->execute();
    } elseif ($bonusLeft > 0) {
        $d = $conn->prepare("UPDATE users SET bonus_scans = bonus_scans - 1 WHERE id = ?");
        $d->bind_param("s", $uid);
        $d->execute();
    } elseif ($paidLeft > 0) {
        $d = $conn->prepare("UPDATE users SET paid_credits = paid_credits - 1 WHERE id = ?");
        $d->bind_param("s", $uid);
        $d->execute();
    } else {
        sendResponse(['error' => 'No scan credits remaining. Please purchase more credits.'], 402);
    }
}

// 3. Persist to flat columns + clear market_price cache
$newMeta         = $input['metadata'] ?? [];
$predictedGrades = $input['predicted_grades'] ?? null;

$name      = $newMeta['name']      ?? null;
$card_set  = $newMeta['set']       ?? null;
$year      = $newMeta['year']      ?? null;
$number    = $newMeta['number']    ?? null;
$edition   = $newMeta['edition']   ?? null;
$character = $newMeta['character'] ?? null;
$artist    = $newMeta['artist']    ?? null;
$isFirstEd = isset($newMeta['is_first_edition']) ? (int)$newMeta['is_first_edition'] : 0;
$isHolo    = isset($newMeta['is_holographic']) ? (int)$newMeta['is_holographic'] : 0;
$holoPattern = $newMeta['holo_pattern'] ?? ($newMeta['holoPattern'] ?? 'none');
$pgJson    = $predictedGrades ? json_encode($predictedGrades) : null;

$updateSql = "UPDATE certificates
     SET name = ?, card_set = ?, year = ?, card_number = ?, edition = ?,
         character_name = ?, artist = ?, predicted_grades = ?, 
         is_first_edition = ?,
         market_price_unlocked = 1, market_price_json = NULL";

if (defined('HAS_HOLOGRAPHIC_COL') && HAS_HOLOGRAPHIC_COL) {
    $updateSql .= ", is_holographic = ?";
}
if (defined('HAS_HOLO_PATTERN_COL') && HAS_HOLO_PATTERN_COL) {
    $updateSql .= ", holo_pattern = ?";
}

$updateSql .= " WHERE id = ?";

$upd = $conn->prepare($updateSql);

if (!$upd) {
    sendResponse(['error' => 'Prepare update failed: ' . $conn->error], 500);
}

$bindTypes = "ssssssssi";
$bindParams = [$name, $card_set, $year, $number, $edition, $character, $artist, $pgJson, $isFirstEd];

if (defined('HAS_HOLOGRAPHIC_COL') && HAS_HOLOGRAPHIC_COL) {
    $bindTypes .= "i";
    $bindParams[] = $isHolo;
}
if (defined('HAS_HOLO_PATTERN_COL') && HAS_HOLO_PATTERN_COL) {
    $bindTypes .= "s";
    $bindParams[] = $holoPattern;
}
$bindTypes .= "s";
$bindParams[] = $cert_id;
$upd->bind_param($bindTypes, ...$bindParams);

if ($upd->execute()) {
    require_once dirname(__FILE__) . '/market_helper.php';
    if (!empty($name) && !empty($card_set)) {
        fetchMarketData($conn, $cert_id, $name, $card_set, (float)($cert['overall_grade'] ?? 0));
    }
    sendResponse(['success' => true, 'message' => 'Card re-identified and market stats updated.']);
} else {
    sendResponse(['error' => 'Database update failed: ' . $conn->error], 500);
}
