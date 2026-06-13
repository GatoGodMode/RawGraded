<?php
ini_set('memory_limit', '512M');
set_time_limit(120);
require_once('db.php');
require_once(__DIR__ . '/membership.php');

$rawInput = file_get_contents('php://input');
if ($rawInput === false || $rawInput === '') {
    sendResponse(['error' => 'Request body too large or empty. Try Save draft first, then Issue Certificate, or try on a stronger connection.'], 400);
}
$input = json_decode($rawInput, true);
if (!$input) sendResponse(['error' => 'Invalid input'], 400);

// SECURITY
$user = require_active_platform_membership($conn);
$userId = $user['id'];

try {
    $id = $input['id'] ?? uniqid('CERT-');
    
    // Scan Limit Logic
    $usedPaidCredit = false;
    $stmt = $conn->prepare("SELECT role, scan_limit, bonus_scans, paid_credits, scans_this_week, scan_reset_date FROM users WHERE id = ?");
    $stmt->bind_param("s", $userId);
    $stmt->execute();
    $u = $stmt->get_result()->fetch_assoc();
    
    if ($u && $u['role'] !== 'admin') {
        $now = new DateTime();
        $reset = new DateTime($u['scan_reset_date'] ?? 'now');
        if ($now > $reset) {
            $newReset = (new DateTime())->modify('+7 days')->format('Y-m-d H:i:s');
            $stmt = $conn->prepare("UPDATE users SET scans_this_week = 0, scan_reset_date = ? WHERE id = ?");
            $stmt->bind_param("ss", $newReset, $userId);
            $stmt->execute();
            $u['scans_this_week'] = 0;
        }
        $scanLimit = (int) ($u['scan_limit'] ?? 0);
        $paidCredits = (int) ($u['paid_credits'] ?? 0);
        $scansThisWeek = (int) ($u['scans_this_week'] ?? 0);
        $freeRemaining = max(0, $scanLimit - $scansThisWeek);
        $paidRemaining = max(0, $paidCredits);
        if ($freeRemaining <= 0 && $paidRemaining <= 0) {
            sendResponse(['error' => 'No credits remaining. Free weekly scans and paid credits are exhausted.'], 403);
        }
        $useFreeCredit = isset($input['use_free_credit']) && filter_var($input['use_free_credit'], FILTER_VALIDATE_BOOLEAN);
        if ($useFreeCredit) {
            if ($freeRemaining <= 0) sendResponse(['error' => 'No free credits left this week.'], 403);
            $stmt = $conn->prepare("UPDATE users SET scans_this_week = scans_this_week + 1 WHERE id = ? AND scans_this_week < ?");
            $stmt->bind_param("si", $userId, $scanLimit);
            $stmt->execute();
            if ($conn->affected_rows === 0) sendResponse(['error' => 'Free credit could not be applied.'], 403);
        } else {
            if ($paidRemaining > 0) {
                $stmt = $conn->prepare("UPDATE users SET paid_credits = paid_credits - 1 WHERE id = ? AND paid_credits > 0");
                $stmt->bind_param("s", $userId);
                $stmt->execute();
                if ($conn->affected_rows === 0) sendResponse(['error' => 'Paid credit could not be applied.'], 403);
                $usedPaidCredit = true;
            } else {
                if ($freeRemaining <= 0) sendResponse(['error' => 'No credits remaining.'], 403);
                $stmt = $conn->prepare("UPDATE users SET scans_this_week = scans_this_week + 1 WHERE id = ? AND scans_this_week < ?");
                $stmt->bind_param("si", $userId, $scanLimit);
                $stmt->execute();
                if ($conn->affected_rows === 0) sendResponse(['error' => 'Free credit could not be applied.'], 403);
            }
        }
    }

    $metadata = $input['metadata'] ?? [];
    $userGrade = $input['userGrade'] ?? [];
    // Handle forensic defects: frontend may send LZString base64 (string) or plain array (legacy)
    $rawDefects = $userGrade['defects'] ?? [];
    $defects = is_string($rawDefects)
        ? $rawDefects
        : json_encode($rawDefects);
    $predictedGrades = json_encode($userGrade['predictedGrades'] ?? null);
    $videoFrames = json_encode($input['video_frames_json'] ?? []);
    
    $acq_price = ($input['acqPrice'] ?? $input['acq_price'] ?? '') === '' ? null : (float)($input['acqPrice'] ?? $input['acq_price']);
    $acq_tax = ($input['acqTax'] ?? $input['acq_tax'] ?? '') === '' ? null : (float)($input['acqTax'] ?? $input['acq_tax']);
    $acq_shipping = ($input['acqShipping'] ?? $input['acq_shipping'] ?? '') === '' ? null : (float)($input['acqShipping'] ?? $input['acq_shipping']);

    $metaCategory = $metadata['category'] ?? 'Pokemon';
    $metaName = $metadata['name'] ?? 'Unknown';
    $metaSet = $metadata['set'] ?? 'Unknown';
    $metaYear = $metadata['year'] ?? '';

    // --- ISOLATED AUTO-NUMERATION LOGIC ---
    // We only automatically assign a copy number if the user has already established a numbered sequence for this exact card.
    $vaultCopy = null;
    try {
        if (!empty($metaName) && !empty($metaSet)) {
            $copyStmt = $conn->prepare("SELECT MAX(vault_copy) as max_copy FROM certificates WHERE user_id = ? AND name = ? AND card_set = ? AND year = ? AND vault_copy IS NOT NULL");
            $copyStmt->bind_param("ssss", $userId, $metaName, $metaSet, $metaYear);
            $copyStmt->execute();
            $copyRes = $copyStmt->get_result()->fetch_assoc();
            if ($copyRes && (int)$copyRes['max_copy'] > 0) {
                $vaultCopy = (int)$copyRes['max_copy'] + 1;
            }
            $copyStmt->close();
        }
    } catch (Throwable $e) {
        // Silently fail to protect the billion-dollar save process
        error_log("Auto-numeration failed for ID $id: " . $e->getMessage());
    }
    // ----------------------------------------

    $hp_col = defined('HAS_HOLO_PATTERN_COL') && HAS_HOLO_PATTERN_COL;
    $hp_insert_col = $hp_col ? ', holo_pattern' : '';
    $hp_insert_val = $hp_col ? ', ?' : '';
    $hp_update     = $hp_col ? ', holo_pattern=VALUES(holo_pattern)' : '';

    $stmt = $conn->prepare("INSERT INTO certificates (
        id, user_id, parent_id, front_hash, back_hash, name, card_category, card_set, character_name, year, edition, card_number, artist, 
        overall_grade, centering, corners, edges, surface, reasoning, defects_json, video_frames_json, predicted_grades,
        front_img, back_img, front_thumb, back_thumb, x_username, user_notes, estimated_value,
        acq_price, acq_tax, acq_shipping, acq_date, acq_source, acq_city, acq_state, tracking_number, order_id, is_first_edition, is_holographic, rarity, vault_copy, market_price_unlocked{$hp_insert_col}
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?{$hp_insert_val})
    ON DUPLICATE KEY UPDATE 
        name=VALUES(name), card_category=VALUES(card_category), card_set=VALUES(card_set), character_name=VALUES(character_name), 
        overall_grade=VALUES(overall_grade), centering=VALUES(centering), corners=VALUES(corners), edges=VALUES(edges), surface=VALUES(surface),
        reasoning=VALUES(reasoning), defects_json=VALUES(defects_json), video_frames_json=VALUES(video_frames_json), predicted_grades=VALUES(predicted_grades),
        front_img=VALUES(front_img), back_img=VALUES(back_img), front_thumb=VALUES(front_thumb), back_thumb=VALUES(back_thumb),
        user_notes=VALUES(user_notes), estimated_value=VALUES(estimated_value),
        acq_price=VALUES(acq_price), acq_tax=VALUES(acq_tax), acq_shipping=VALUES(acq_shipping), acq_date=VALUES(acq_date), 
        acq_source=VALUES(acq_source), acq_city=VALUES(acq_city), acq_state=VALUES(acq_state), tracking_number=VALUES(tracking_number), order_id=VALUES(order_id),
        is_first_edition=VALUES(is_first_edition), is_holographic=VALUES(is_holographic), rarity=VALUES(rarity), vault_copy=VALUES(vault_copy), market_price_unlocked=VALUES(market_price_unlocked){$hp_update}");

    // Prepare variables for binding (mysqli requires references)
    $parentId = $input['parent_id'] ?? null;
    $frontHash = $input['frontHash'] ?? null;
    $backHash = $input['backHash'] ?? null;
    $metaChar = $metadata['character'] ?? '';
    $metaEd = $metadata['edition'] ?? '';
    $metaNum = $metadata['cardNumber'] ?? '';
    $metaArtist = $metadata['artist'] ?? '';
    $gradeOverall = $userGrade['overall'] ?? 0;
    $gradeCenter = $userGrade['centering'] ?? 0;
    $gradeCorner = $userGrade['corners'] ?? 0;
    $gradeEdges = $userGrade['edges'] ?? 0;
    $gradeSurface = $userGrade['surface'] ?? 0;
    $gradeReason = $userGrade['reasoning'] ?? '';
    $frontCropped = $input['frontCropped'] ?? '';
    $backCropped = $input['backCropped'] ?? '';
    $frontThumb = $input['front_thumb'] ?? null;
    $backThumb = $input['back_thumb'] ?? null;
    // Debug: confirm whether images are present in payload (for forensics troubleshooting)
    error_log(sprintf('[save.php] cert %s front_len=%d back_len=%d defects_len=%d', $id, strlen((string)$frontCropped), strlen((string)$backCropped), strlen((string)$defects)));
    $userTwitter = $input['userTwitter'] ?? '';
    $userNotes = $input['user_notes'] ?? '';
    $estValue = $metadata['estimated_value'] ?? 0;
    $acqDate = $input['acqDate'] ?? $input['acq_date'] ?? null;
    $acqSource = $input['acqSource'] ?? $input['acq_source'] ?? null;
    $acqCity = $input['acqCity'] ?? $input['acq_city'] ?? null;
    $acqState = $input['acqState'] ?? $input['acq_state'] ?? null;
    $trackingNum = $input['tracking_number'] ?? null;
    $orderId = $input['order_id'] ?? null;
    $isFirstEd = isset($metadata['is_first_edition']) ? (int)$metadata['is_first_edition'] : 0;
    $isHolo = isset($metadata['is_holographic']) ? (int)$metadata['is_holographic'] : 0;
    $rarity = $metadata['rarity'] === '' ? null : ($metadata['rarity'] ?? null);
    $holoPattern = $metadata['holo_pattern'] ?? ($metadata['holoPattern'] ?? 'none');
    
    $marketPriceUnlocked = $usedPaidCredit ? 1 : 0;

    $bindTypes = "sssssssssssssdddddssssssssssddddssssssiisii";
    $bindParams = [
        $id, $userId, $parentId, $frontHash, $backHash, 
        $metaName, $metaCategory, $metaSet, $metaChar, $metaYear, 
        $metaEd, $metaNum, $metaArtist,
        $gradeOverall, $gradeCenter, $gradeCorner, $gradeEdges, $gradeSurface, 
        $gradeReason, $defects, $videoFrames, $predictedGrades,
        $frontCropped, $backCropped, $frontThumb, $backThumb, 
        $userTwitter, $userNotes, $estValue,
        $acq_price, $acq_tax, $acq_shipping, $acqDate, 
        $acqSource, $acqCity, $acqState, $trackingNum, $orderId,
        $isFirstEd, $isHolo, $rarity, $vaultCopy, $marketPriceUnlocked
    ];
    if ($hp_col) {
        $bindTypes .= 's';
        $bindParams[] = $holoPattern;
    }
    $stmt->bind_param($bindTypes, ...$bindParams);

    if ($stmt->execute()) {
        file_put_contents('debug_save.log', date('[Y-m-d H:i:s] ') . "Insert successful for ID: $id\n", FILE_APPEND);
        
        if ($usedPaidCredit && !empty($metaName) && !empty($metaSet)) {
            require_once dirname(__FILE__) . '/market_helper.php';
            fetchMarketData($conn, $id, $metaName, $metaSet, (float)$gradeOverall);
        }
        
        // Increment Stats
        $stmt = $conn->prepare("UPDATE users SET total_scans = total_scans + 1 WHERE id = ?");
        $stmt->bind_param("s", $userId);
        $stmt->execute();
        
        // Trigger badge check
        try {
            file_put_contents('debug_save.log', date('[Y-m-d H:i:s] ') . "Starting badge check...\n", FILE_APPEND);
            require_once('badges_lib.php');
            checkAndAwardBadges($conn, $userId);
            file_put_contents('debug_save.log', date('[Y-m-d H:i:s] ') . "Badge check complete.\n", FILE_APPEND);
        } catch (Throwable $e) {
            // Log badge error but don't fail the save
            file_put_contents('debug_save.log', date('[Y-m-d H:i:s] ') . "BADGE ERROR: " . $e->getMessage() . "\n", FILE_APPEND);
        }
        
        // Return updated credit counts so frontend can stay in sync
        $creditsRemaining = null;
        if ($u && $u['role'] !== 'admin') {
            $cr = $conn->prepare("SELECT scan_limit, paid_credits, scans_this_week FROM users WHERE id = ?");
            $cr->bind_param("s", $userId);
            $cr->execute();
            $crRow = $cr->get_result()->fetch_assoc();
            if ($crRow) {
                $creditsRemaining = [
                    'free' => max(0, (int)$crRow['scan_limit'] - (int)$crRow['scans_this_week']),
                    'paid' => max(0, (int)($crRow['paid_credits'] ?? 0)),
                ];
            }
        }
        sendResponse(['success' => true, 'id' => $id, 'credits_remaining' => $creditsRemaining]);
    } else {
        $error = $stmt->error;
        file_put_contents('debug_save.log', date('[Y-m-d H:i:s] ') . "Save failed: $error\n", FILE_APPEND);
        sendResponse(['error' => 'Save failed: ' . $error], 500);
    }

} catch (Exception $e) { 
    file_put_contents('debug_save.log', date('[Y-m-d H:i:s] ') . "EXCEPTION: " . $e->getMessage() . "\n", FILE_APPEND);
    sendResponse(['error' => $e->getMessage()], 500); 
} catch (Throwable $t) {
    file_put_contents('debug_save.log', date('[Y-m-d H:i:s] ') . "FATAL ERROR: " . $t->getMessage() . "\n", FILE_APPEND);
    sendResponse(['error' => 'Critical error: ' . $t->getMessage()], 500);
}
?>
