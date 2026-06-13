<?php
// plugin_collect_only.php
// -----------------------
// Collect Only Mode:
// - Charges 1 free credit for 1 card submission
// - Charges 1 pro credit for up to 10 card submissions
// - Inserts certificates with NO numeric grades/subgrades/defects
// - Uses AI identification text as the certificate reasoning display

require_once('db.php');
require_once(__DIR__ . '/membership.php');

$user = require_active_platform_membership($conn);
$userId = (string)$user['id'];
$isAdmin = ($user['role'] ?? 'user') === 'admin';

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$creditMode = $input['credit_mode'] ?? 'free'; // 'free' | 'paid'
$creditMode = ($creditMode === 'paid') ? 'paid' : 'free';
$cards = $input['cards'] ?? [];

if (!is_array($cards) || count($cards) < 1) {
    sendResponse(['error' => 'Missing cards array'], 400);
}

$cardsCount = count($cards);
$maxCards = ($creditMode === 'paid') ? 10 : 1;
if ($cardsCount > $maxCards) {
    sendResponse([
        'error' => "Too many cards for credit_mode={$creditMode}. Max={$maxCards}."
    ], 400);
}

// --- Credit charge (unless admin) ---
if (!$isAdmin) {
    $stmt = $conn->prepare("SELECT role, scan_limit, bonus_scans, paid_credits, scans_this_week, scan_reset_date FROM users WHERE id = ?");
    if (!$stmt) sendResponse(['error' => 'Prepare failed'], 500);
    $stmt->bind_param("s", $userId);
    $stmt->execute();
    $u = $stmt->get_result()->fetch_assoc();
    if (!$u) sendResponse(['error' => 'User not found'], 404);

    $scanLimit = (int)($u['scan_limit'] ?? 0);
    $bonusScans = (int)($u['bonus_scans'] ?? 0);
    $paidCredits = (int)($u['paid_credits'] ?? 0);
    $scansThisWeek = (int)($u['scans_this_week'] ?? 0);
    $resetDate = $u['scan_reset_date'] ?? null;

    // Weekly reset if needed
    if ($resetDate) {
        $now = new DateTime();
        $reset = new DateTime($resetDate);
        if ($now > $reset) {
            $newReset = (new DateTime())->modify('+7 days')->format('Y-m-d H:i:s');
            $stmtR = $conn->prepare("UPDATE users SET scans_this_week = 0, scan_reset_date = ? WHERE id = ?");
            $stmtR->bind_param("ss", $newReset, $userId);
            $stmtR->execute();
            $scansThisWeek = 0;
        }
    }

    if ($creditMode === 'paid') {
        if ($paidCredits < 1) sendResponse(['error' => 'Insufficient Pro Credits'], 402);
        $upd = $conn->prepare("UPDATE users SET paid_credits = paid_credits - 1 WHERE id = ? AND paid_credits > 0");
        $upd->bind_param("s", $userId);
        $upd->execute();
        if ($conn->affected_rows === 0) sendResponse(['error' => 'Pro credit could not be applied'], 402);
    } else {
        $freeRemaining = max(0, $scanLimit - $scansThisWeek);
        $bonusLeft = max(0, $bonusScans);

        if ($freeRemaining > 0) {
            $upd = $conn->prepare("UPDATE users SET scans_this_week = scans_this_week + 1 WHERE id = ? AND scans_this_week < ?");
            $upd->bind_param("si", $userId, $scanLimit);
            $upd->execute();
            if ($conn->affected_rows === 0) sendResponse(['error' => 'Free credit could not be applied'], 403);
        } else if ($bonusLeft > 0) {
            $upd = $conn->prepare("UPDATE users SET bonus_scans = bonus_scans - 1 WHERE id = ? AND bonus_scans > 0");
            $upd->bind_param("s", $userId);
            $upd->execute();
            if ($conn->affected_rows === 0) sendResponse(['error' => 'Bonus free credit could not be applied'], 403);
        } else {
            sendResponse(['error' => 'No free credits remaining.'], 403);
        }
    }
}

// --- Insert certificates (gradeless / defects-less) ---
// NOTE: keep grading columns NULL so the UI can infer collect-only.
$co_hp_col = defined('HAS_HOLO_PATTERN_COL') && HAS_HOLO_PATTERN_COL;
$co_hp_insert_col = $co_hp_col ? ', holo_pattern' : '';
$co_hp_insert_val = $co_hp_col ? ', ?' : '';
$co_hp_update     = $co_hp_col ? ', holo_pattern=VALUES(holo_pattern)' : '';

    $overallGrade = isset($c['grades']['overall']) ? (float)$c['grades']['overall'] : null;
    $centering = isset($c['grades']['centering']) ? (float)$c['grades']['centering'] : null;
    $corners = isset($c['grades']['corners']) ? (float)$c['grades']['corners'] : null;
    $edges = isset($c['grades']['edges']) ? (float)$c['grades']['edges'] : null;
    $surface = isset($c['grades']['surface']) ? (float)$c['grades']['surface'] : null;

    $stmtIns = $conn->prepare("
        INSERT INTO certificates (
            id, user_id, parent_id, front_hash, back_hash,
            name, card_category, card_set, character_name, year, edition, card_number, artist,
            overall_grade, centering, corners, edges, surface, reasoning, defects_json, video_frames_json, predicted_grades,
            front_img, back_img, front_thumb, back_thumb, x_username, user_notes, estimated_value,
            acq_price, acq_tax, acq_shipping, acq_date, acq_source, acq_city, acq_state,
            tracking_number, order_id, is_first_edition, is_holographic, rarity, vault_copy, market_price_unlocked{$co_hp_insert_col}
        ) VALUES (
            ?, ?, NULL, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            NULL, NULL, NULL,
            ?, ?, ?, ?,
            ?, NULL, 0,
            NULL, NULL, NULL, NULL, NULL, NULL, NULL,
            NULL, NULL, ?, ?, ?,
            NULL, 0{$co_hp_insert_val}
        )
        ON DUPLICATE KEY UPDATE
            name=VALUES(name), card_category=VALUES(card_category), card_set=VALUES(card_set), character_name=VALUES(character_name),
            year=VALUES(year), edition=VALUES(edition), card_number=VALUES(card_number), artist=VALUES(artist),
            overall_grade=VALUES(overall_grade), centering=VALUES(centering), corners=VALUES(corners), edges=VALUES(edges), surface=VALUES(surface),
            reasoning=VALUES(reasoning),
            front_img=VALUES(front_img), back_img=VALUES(back_img), front_thumb=VALUES(front_thumb), back_thumb=VALUES(back_thumb),
            x_username=VALUES(x_username), user_notes=VALUES(user_notes), estimated_value=VALUES(estimated_value),
            defects_json=NULL, video_frames_json=NULL, predicted_grades=NULL,
            is_first_edition=VALUES(is_first_edition), is_holographic=VALUES(is_holographic), rarity=VALUES(rarity),
            vault_copy=NULL, market_price_unlocked=0{$co_hp_update}
    ");

if (!$stmtIns) {
    sendResponse(['error' => 'Prepare insert failed: ' . $conn->error], 500);
}

$insertedIds = [];

foreach ($cards as $idx => $c) {
    $id = trim((string)($c['id'] ?? ''));
    if ($id === '') sendResponse(['error' => "Missing card id at index {$idx}"], 400);

    $frontImg = $c['front_img'] ?? null;
    if (!is_string($frontImg) || trim($frontImg) === '') {
        sendResponse(['error' => "Missing front_img at index {$idx}"], 400);
    }
    $backImg = $c['back_img'] ?? null;
    if (!is_string($backImg) || trim($backImg) === '') {
        // Front-only submission: mirror front to keep certificate display consistent.
        $backImg = $frontImg;
    }

    $frontHash = $c['front_hash'] ?? null;
    $backHash = $c['back_hash'] ?? null;
    if (!is_string($frontHash) || trim($frontHash) === '') $frontHash = null;
    if (!is_string($backHash) || trim($backHash) === '') $backHash = $frontHash;

    $meta = $c['metadata'] ?? [];
    if (!is_array($meta)) $meta = [];

    $name = trim((string)($meta['name'] ?? ''));
    $cardCategory = trim((string)($meta['category'] ?? $meta['card_category'] ?? 'Pokemon'));
    $cardSet = trim((string)($meta['set'] ?? $meta['card_set'] ?? ''));
    $characterName = trim((string)($meta['character'] ?? $meta['character_name'] ?? ''));
    $year = trim((string)($meta['year'] ?? ''));
    $edition = trim((string)($meta['edition'] ?? ''));
    $cardNumber = trim((string)($meta['number'] ?? $meta['card_number'] ?? ''));
    $artist = trim((string)($meta['artist'] ?? ''));

    // Collect Only should be resilient: require the minimum identity fields needed
    // to keep the vault entry useful, while allowing year/edition/character to be
    // empty if the AI couldn’t read them confidently.
    if ($name === '' || $cardSet === '' || $cardNumber === '') {
        sendResponse(['error' => "Missing minimum metadata fields at index {$idx}"], 400);
    }

    $isFirstEd = isset($meta['is_first_edition']) ? (int)$meta['is_first_edition'] : 0;
    $isHolo = isset($meta['is_holographic']) ? (int)$meta['is_holographic'] : 0;
    $holoPattern = $meta['holo_pattern'] ?? ($meta['holoPattern'] ?? 'none');
    $rarity = $meta['rarity'] ?? null;
    if ($rarity !== null && $rarity !== '') $rarity = trim((string)$rarity); else $rarity = null;

    $aiDescription = trim((string)($c['ai_description'] ?? $c['reasoning'] ?? ''));
    if ($aiDescription === '') $aiDescription = 'Identification complete.';

    $overallGrade = isset($c['grades']['overall']) ? (float)$c['grades']['overall'] : null;
    $centering = isset($c['grades']['centering']) ? (float)$c['grades']['centering'] : null;
    $corners = isset($c['grades']['corners']) ? (float)$c['grades']['corners'] : null;
    $edges = isset($c['grades']['edges']) ? (float)$c['grades']['edges'] : null;
    $surface = isset($c['grades']['surface']) ? (float)$c['grades']['surface'] : null;

    $xUsername = $user['x_username'] ?? null;

    // Store thumbs as the same payload (collect-only is simpler than full crop pipelines)
    $frontThumb = $frontImg;
    $backThumb = $backImg;

    // Changed bind types: 13 strings + 5 doubles + 1 string (description) + 4 strings + 1 string (username) + 2 ints + 1 string
    // Types trace:
    // s (id) s (user) s (fronthash) s (backhash) - 4
    // s (name) s (category) s (set) s (character) s (year) s (edition) s (number) s (artist) - 8
    // d (overall) d (center) d (corners) d (edges) d (surface) - 5
    // s (reasoning/desc) - 1
    // s (frontimg) s (backimg) s (frontthumb) s (backthumb) - 4
    // s (x_username) - 1
    // i (is_first) i (is_holo) s (rarity) - 3
    // total = 4+8+5+1+4+1+3 = 26 params.
    $types = "ssssssssssssdddddssssssiis";
    $bindParams = [
        $id, $userId, $frontHash, $backHash,
        $name, $cardCategory, $cardSet, $characterName, $year, $edition, $cardNumber, $artist,
        $overallGrade, $centering, $corners, $edges, $surface, $aiDescription,
        $frontImg, $backImg, $frontThumb, $backThumb,
        $xUsername,
        $isFirstEd, $isHolo, $rarity
    ];
    if ($co_hp_col) {
        $types .= 's';
        $bindParams[] = $holoPattern;
    }
    $stmtIns->bind_param($types, ...$bindParams
    );

    if (!$stmtIns->execute()) {
        sendResponse(['error' => 'Insert failed at index ' . $idx . ': ' . $stmtIns->error], 500);
    }

    $insertedIds[] = $id;
}

// Badge / credits side effects (optional but keeps stats aligned)
if (!$isAdmin) {
    try {
        require_once('badges_lib.php');
        checkAndAwardBadges($conn, $userId);
    } catch (Throwable $e) {
        // Non-fatal: collect-only should still succeed.
    }
}

// --- Credits remaining for UI sync ---
$creditsRemaining = null;
if (!$isAdmin) {
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

sendResponse([
    'success' => true,
    'inserted_ids' => $insertedIds,
    'credits_remaining' => $creditsRemaining
]);

?>

