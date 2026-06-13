<?php
// public/api/plugin_merge_save.php
ob_start();
require_once(__DIR__ . '/db.php');



header('Content-Type: application/json');

// 1. Auth Check
$user = requireAuth();
$userId = $user['id'];

// 2. Input Validation
$input = json_decode(file_get_contents('php://input'), true);
if (!$input) sendResponse(['error' => 'Invalid input'], 400);

// Extract Data
$newCert = $input['certificate'] ?? null;
$mergedIds = $input['merged_ids'] ?? [];



if (empty($newCert) || empty($mergedIds)) {

    sendResponse(['error' => 'Missing certificate data or merge IDs'], 400);
}

// 3. Validate Ownership of Merged IDs
if (count($mergedIds) > 0) {
    $placeholders = implode(',', array_fill(0, count($mergedIds), '?'));
    $types = str_repeat('s', count($mergedIds));
    $stmt = $conn->prepare("SELECT count(*) as c FROM certificates WHERE user_id = ? AND id IN ($placeholders)");
    
    // Bind: userId first, then all mergedIds
    $params = array_merge([$userId], $mergedIds);
    $stmt->bind_param("s" . $types, ...$params);
    $stmt->execute();
    $res = $stmt->get_result();
    if ($res === false) {

        sendResponse(['error' => 'Database error during ownership validation'], 500);
    }
    $resAssoc = $res->fetch_assoc();
    $count = $resAssoc['c'] ?? 0;
    
    if ($count != count($mergedIds)) {
        sendResponse(['error' => 'Security Violation: One or more certificates do not belong to you or do not exist.'], 403);
    }
}

// 4. Verify Credits (Cost: 1)
$cost = 1;
$isAdmin = ($user['role'] ?? 'user') === 'admin';

if (!$isAdmin && ($user['scan_limit'] + $user['bonus_scans']) - $user['scans_this_week'] < $cost) {
     sendResponse(['error' => 'Insufficient credits. You need 1 credit to perform a Re-assessment.'], 402);
}

// 5. ATOMIC OPERATION START ===================================================
// NOTE: MyISAM doesn't support transactions, but we try to be ordered correctly.
// Ideally usage of InnoDB allows: $conn->begin_transaction();

// A. Insert New Certificate
$id = $newCert['id'] ?? uniqid('CERT-'); 

// Prepare variables for binding (Standard Save Logic)
$parentId = null; // Merged certs start a new tree, or maintain the oldest parent?
// User request: "The new final score will be created... linked to new certificates". 
// It effectively replaces the chain. So parent_id is NULL or arguably the parent of the OLDEST cert?
// Request says: "The new certificate must still be able to be linked to NEW certificates".
// It implies this is a fresh start. Let's keep parent_id NULL unless specified.

$frontHash = $newCert['frontHash'] ?? null;
$backHash = $newCert['backHash'] ?? null;
$meta = $newCert['metadata'] ?? [];
$grade = $newCert['userGrade'] ?? [];
$defects = json_encode($grade['defects'] ?? []);

// Metadata
$name = $meta['name'] ?? 'Unknown';
$set = $meta['set'] ?? 'Unknown';
$char = $meta['character'] ?? '';
$year = $meta['year'] ?? '';
$ed = $meta['edition'] ?? '';
$num = $meta['cardNumber'] ?? '';
$artist = $meta['artist'] ?? '';
$estVal = $meta['estimated_value'] ?? 0;

// Grade
$overall = $grade['overall'] ?? 0;
$center = $grade['centering'] ?? 0;
$corner = $grade['corners'] ?? 0;
$edges = $grade['edges'] ?? 0;
$surface = $grade['surface'] ?? 0;
$reason = $grade['reasoning'] ?? '';

// Images
$frontUrl = $newCert['frontCropped'] ?? '';
$backUrl = $newCert['backCropped'] ?? '';
$frontThumb = $newCert['front_thumb'] ?? null;
$backThumb = $newCert['back_thumb'] ?? null;

// User Data
$twitter = $newCert['userTwitter'] ?? '';
$notes = $newCert['user_notes'] ?? '';
// Acquisition Data extraction with Fallback
$acq_price = ($newCert['acqPrice'] ?? $newCert['acq_price'] ?? '') === '' ? null : (float)($newCert['acqPrice'] ?? $newCert['acq_price']);
$acq_tax = ($newCert['acqTax'] ?? $newCert['acq_tax'] ?? '') === '' ? null : (float)($newCert['acqTax'] ?? $newCert['acq_tax']);
$acq_shipping = ($newCert['acqShipping'] ?? $newCert['acq_shipping'] ?? '') === '' ? null : (float)($newCert['acqShipping'] ?? $newCert['acq_shipping']);
$acqDate = $newCert['acqDate'] ?? $newCert['acq_date'] ?? null;
$acqSource = $newCert['acqSource'] ?? $newCert['acq_source'] ?? null;
$acqCity = $newCert['acqCity'] ?? $newCert['acq_city'] ?? null;
$acqState = $newCert['acqState'] ?? $newCert['acq_state'] ?? null;

// AUTO-CARRY OVER: If main acquisition data (price/source) is missing, try to fill from the most recent merged certificate
if ((is_null($acq_price) || empty($acqSource)) && count($mergedIds) > 0) {
    // Find the most recent scan among the merged IDs to inherit from
    $placeholders = implode(',', array_fill(0, count($mergedIds), '?'));
    $types = str_repeat('s', count($mergedIds));
    // We want the ONE most recent scan that actually has data
    $fetchSql = "SELECT acq_price, acq_tax, acq_shipping, acq_date, acq_source, acq_city, acq_state 
                 FROM certificates 
                 WHERE id IN ($placeholders) AND user_id = ? 
                 AND (acq_price IS NOT NULL OR acq_source IS NOT NULL)
                 ORDER BY date_scanned DESC LIMIT 1";
                 
    $fetchStmt = $conn->prepare($fetchSql);
    if ($fetchStmt) {
        $params = array_merge($mergedIds, [$userId]);
        $fetchStmt->bind_param($types . "s", ...$params);
        $fetchStmt->execute();
        $res = $fetchStmt->get_result();
        if ($res && $row = $res->fetch_assoc()) {
            if (is_null($acq_price)) $acq_price = $row['acq_price'];
            if (is_null($acq_tax)) $acq_tax = $row['acq_tax'];
            if (is_null($acq_shipping)) $acq_shipping = $row['acq_shipping'];
            if (empty($acqDate)) $acqDate = $row['acq_date'];
            if (empty($acqSource)) $acqSource = $row['acq_source'];
            if (empty($acqCity)) $acqCity = $row['acq_city'];
            if (empty($acqState)) $acqState = $row['acq_state'];
        }
    }
}

$isFirstEd = isset($meta['is_first_edition']) ? (int)$meta['is_first_edition'] : 0;
$isHolo = isset($meta['is_holographic']) ? (int)$meta['is_holographic'] : 0;
$holoPattern = $meta['holo_pattern'] ?? ($meta['holoPattern'] ?? 'none');
$rarity = $meta['rarity'] === '' ? null : ($meta['rarity'] ?? null);

$mergedIdsJson = json_encode($mergedIds);

// 5A. PREPARE INSERT (Resilient Version)
$cols = "id, user_id, parent_id, front_hash, back_hash, name, card_set, character_name, year, edition, card_number, artist, overall_grade, centering, corners, edges, surface, reasoning, defects_json, front_img, back_img, front_thumb, back_thumb, x_username, user_notes, estimated_value, acq_price, acq_tax, acq_shipping, acq_date, acq_source, acq_city, acq_state, is_first_edition, is_holographic, rarity";
$vals = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
$types = "ssssssssssss ddddd ssssssss d dddssss i i s";

if (defined('HAS_HOLO_PATTERN_COL') && HAS_HOLO_PATTERN_COL) {
    $cols .= ", holo_pattern";
    $vals .= ", ?";
    $types .= "s";
}

// Add merged_certificate_ids if it exists
if (HAS_MERGED_IDS_COL) {
    $cols .= ", merged_certificate_ids";
    $vals .= ", ?";
    $types .= "s";
}

$stmt = $conn->prepare("INSERT INTO certificates ($cols) VALUES ($vals)");

if (!$stmt) {

    sendResponse(['error' => 'Database Schema Error: Insert Prepare failed. Detail: ' . $conn->error], 500);
}

// 5B. BIND & EXECUTE INSERT
$params = [
    $id, $userId, $parentId,
    $frontHash, $backHash, 
    $name, $set, $char, $year, $ed, $num, $artist,
    $overall, $center, $corner, $edges, $surface, $reason, $defects,
    $frontUrl, $backUrl, $frontThumb, $backThumb,
    $twitter, $notes, $estVal,
    $acq_price, $acq_tax, $acq_shipping, $acqDate, $acqSource, $acqCity, $acqState,
    $isFirstEd, $isHolo, $rarity
];
if (defined('HAS_HOLO_PATTERN_COL') && HAS_HOLO_PATTERN_COL) {
    $params[] = $holoPattern;
}
if (HAS_MERGED_IDS_COL) {
    $params[] = $mergedIdsJson;
}

// Remove spaces from types string for bind_param
$types = str_replace(' ', '', $types);
$stmt->bind_param($types, ...$params);

if ($stmt->execute()) {
    // B. Deduct Credit
    $deduct = $conn->prepare("UPDATE users SET scans_this_week = scans_this_week + ? WHERE id = ?");
    $deduct->bind_param("is", $cost, $userId);
    $deduct->execute();

    // C. Mark Old Certificates as Merged (Hide them)
    if (HAS_MERGED_COL) {
        $delPlaceholders = implode(',', array_fill(0, count($mergedIds), '?'));
        $delTypes = str_repeat('s', count($mergedIds));
        
        $hideStmt = $conn->prepare("UPDATE certificates SET is_merged = 1 WHERE id IN ($delPlaceholders) AND user_id = ?");
        if ($hideStmt) {
            $delParams = array_merge($mergedIds, [$userId]);
            $hideStmt->bind_param($delTypes . "s", ...$delParams);
            $hideStmt->execute();
        }
    }
    
    // D. Return Success
    sendResponse(['success' => true, 'id' => $id, 'message' => 'Merge successful.']);

} else {
    sendResponse(['error' => 'Merge failed during insert: ' . $stmt->error], 500);
}
?>
