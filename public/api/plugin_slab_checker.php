<?php
// plugin_slab_checker.php — Graded Slab Authenticity Checker
// Requires 1 Pro Credit. No free credit usage allowed.
ini_set('memory_limit', '512M');
set_time_limit(120);
require_once('db.php');

$user = requireAuth();
$userId = (int)$user['id'];

$action = $_GET['action'] ?? '';
$rawBody = file_get_contents('php://input');
if ($rawBody === false || $rawBody === '') {
    // Only fail for POST requests that need a body
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        sendResponse(['error' => 'Request body too large or empty. post_max_size=' . ini_get('post_max_size')], 400);
    }
    $rawBody = '';
}
$input = json_decode($rawBody, true) ?? [];

// ─────────────────────────────────────────────────────────
// Schema bootstrap
// ─────────────────────────────────────────────────────────
function ensureSlabChecksTable($conn) {
    $sql = "CREATE TABLE IF NOT EXISTS `slab_checks` (
        `id`                 INT AUTO_INCREMENT PRIMARY KEY,
        `user_id`            INT NOT NULL,
        `psa_slab_id`        INT DEFAULT NULL,
        `grading_house`      VARCHAR(10) NOT NULL DEFAULT 'PSA',
        `authenticity_score` TINYINT DEFAULT NULL,
        `verdict`            VARCHAR(20) DEFAULT NULL,
        `ai_reasoning`       TEXT DEFAULT NULL,
        `checks_json`        LONGTEXT DEFAULT NULL,
        `front_img`          LONGTEXT DEFAULT NULL,
        `back_img`           LONGTEXT DEFAULT NULL,
        `serial_detected`    VARCHAR(30) DEFAULT NULL,
        `card_name_detected` VARCHAR(255) DEFAULT NULL,
        `psa_cert_mismatch`  TINYINT(1) DEFAULT 0,
        `video_frames_json`  LONGTEXT DEFAULT NULL,
        `created_at`         DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY `idx_user` (`user_id`),
        KEY `idx_slab` (`psa_slab_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";
    $conn->query($sql);
    
    // Auto-patch psa_slabs if it exists but is missing columns
    // The user might authenticate a slab before ever opening the Vault Plugin
    try { $conn->query("ALTER TABLE `psa_slabs` ADD COLUMN `status` VARCHAR(20) DEFAULT 'active'"); } catch (Exception $e) {}
    try { $conn->query("ALTER TABLE `psa_slabs` ADD COLUMN `sold_price` DECIMAL(10,2) DEFAULT NULL"); } catch (Exception $e) {}
    try { $conn->query("ALTER TABLE `psa_slabs` ADD COLUMN `transfer_from_user_id` INT(11) DEFAULT NULL"); } catch (Exception $e) {}
    try { $conn->query("ALTER TABLE `psa_slabs` ADD COLUMN `local_front_img` LONGTEXT DEFAULT NULL"); } catch (Exception $e) {}
    try { $conn->query("ALTER TABLE `psa_slabs` ADD COLUMN `local_back_img` LONGTEXT DEFAULT NULL"); } catch (Exception $e) {}
    try { $conn->query("ALTER TABLE `psa_slabs` ADD COLUMN `grader` VARCHAR(10) DEFAULT 'PSA' AFTER `cert_id`"); } catch (Exception $e) {}
    try { $conn->query("ALTER TABLE `psa_slabs` ADD COLUMN `for_sale` TINYINT(1) DEFAULT 0"); } catch (Exception $e) {}
    try { $conn->query("ALTER TABLE `psa_slabs` ADD COLUMN `sale_link` VARCHAR(255) DEFAULT NULL"); } catch (Exception $e) {}
    try { $conn->query("ALTER TABLE `psa_slabs` ADD COLUMN `transfer_requested_by` INT(11) DEFAULT NULL"); } catch (Exception $e) {}
    try { $conn->query("ALTER TABLE `psa_slabs` ADD COLUMN `transfer_status` VARCHAR(50) DEFAULT NULL"); } catch (Exception $e) {}
}

ensureSlabChecksTable($conn);

// ─────────────────────────────────────────────────────────
// CardHedger API helper — supports PSA, BGS, CGC, SGC, etc.
// ─────────────────────────────────────────────────────────
function getCardHedgerKey($conn) {
    $row = $conn->query("SELECT `value` FROM settings WHERE `key` = 'cardhedger_api_key' LIMIT 1")->fetch_assoc();
    return $row['value'] ?? '';
}

/**
 * Fetch cert info + card details from CardHedger.
 * Returns a normalised array:
 *   [ found, grader, grade, grade_desc, card_name, card_set, card_year, card_number, front_img_url, raw_response ]
 * or null on failure.
 */
function fetchCardHedgerCert($conn, $serial, $grader = 'PSA') {
    $apiKey = getCardHedgerKey($conn);
    if (!$apiKey) return null;

    $payload = json_encode(['cert' => $serial, 'grader' => strtoupper($grader), 'days' => 1]);

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, 'https://api.cardhedger.com/v1/cards/prices-by-cert');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 12);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'X-API-Key: ' . $apiKey,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200 || !$response) return null;
    $data = json_decode($response, true);
    if (empty($data['cert_info'])) return null;

    $ci   = $data['cert_info'];
    $card = $data['card'] ?? [];

    // Normalise grade — CardHedger returns e.g. "PSA 10", "BGS 9.5"
    $gradeLabel = $ci['grade'] ?? '';
    $gradeNum   = null;
    if (preg_match('/([0-9]+(?:\.[0-9]+)?)\s*$/', $gradeLabel, $m)) {
        $gradeNum = $m[1];
    }

    return [
        'found'         => true,
        'grader'        => strtoupper($ci['grader'] ?? $grader),
        'grade'         => $gradeNum,
        'grade_desc'    => $gradeLabel,
        'card_name'     => $ci['description'] ?? ($card['description'] ?? null),
        'card_set'      => $card['set'] ?? null,
        'card_year'     => null, // not returned by CardHedger
        'card_number'   => $card['number'] ?? null,
        'front_img_url' => !empty($card['image']) ? (strpos($card['image'], 'http') === 0 ? $card['image'] : 'https:' . $card['image']) : null,
        'raw_response'  => $data,
    ];
}

// ─────────────────────────────────────────────────────────
// PSA API helper (fallback for PSA when CardHedger has no key)
// ─────────────────────────────────────────────────────────
function fetchPsaCertForCheck($conn, $serial) {
    require_once __DIR__ . '/settings_util.php';
    $apiKey = readSetting($conn, 'psa_public_api_key');
    if ($apiKey === '') {
        return null;
    }
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, "https://api.psacard.com/publicapi/cert/GetByCertNumber/" . urlencode($serial));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Authorization: bearer " . $apiKey,
        "Accept: application/json"
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($httpCode !== 200 || !$response) return null;
    return json_decode($response, true);
}

/** Unified cert lookup — prefers CardHedger, falls back to PSA direct API for PSA. */
function lookupCert($conn, $serial, $grader = 'PSA') {
    // Try CardHedger first for all graders
    $ch = fetchCardHedgerCert($conn, $serial, $grader);
    if ($ch) return $ch;

    // PSA fallback via PSA direct API
    if (strtoupper($grader) === 'PSA') {
        $psaData = fetchPsaCertForCheck($conn, $serial);
        if ($psaData && !empty($psaData['PSACert'])) {
            $cert = $psaData['PSACert'];
            $gd   = $cert['GradeDescription'] ?? null;
            $gn   = null;
            if ($gd && preg_match('/([0-9]+(?:\.[0-9]+)?)\s*$/', $gd, $m)) $gn = $m[1];
            return [
                'found'         => true,
                'grader'        => 'PSA',
                'grade'         => $gn,
                'grade_desc'    => $gd,
                'card_name'     => $cert['Subject'] ?? null,
                'card_set'      => $cert['CardSet'] ?? null,
                'card_year'     => $cert['Year'] ?? null,
                'card_number'   => $cert['CardNumber'] ?? null,
                'front_img_url' => $cert['FrontImageURL'] ?? null,
                'raw_response'  => $psaData,
            ];
        }
    }

    return null;
}


// ─────────────────────────────────────────────────────────
// Credit deduction helper
// ─────────────────────────────────────────────────────────
function deductPaidCredit($conn, $userId) {
    // Atomic decrement only if > 0
    $stmt = $conn->prepare("UPDATE users SET paid_credits = paid_credits - 1 WHERE id = ? AND paid_credits > 0");
    $stmt->bind_param("i", $userId);
    $stmt->execute();
    return $stmt->affected_rows > 0;
}

// ─────────────────────────────────────────────────────────
// GET: verify_cert — cross-check any serial against CardHedger (PSA/BGS/CGC)
// Legacy alias: verify_psa → same endpoint
// ─────────────────────────────────────────────────────────
if ($action === 'verify_cert' || $action === 'verify_psa') {
    $serial = trim($_GET['serial'] ?? '');
    $grader = strtoupper(trim($_GET['grader'] ?? 'PSA'));
    if (!in_array($grader, ['PSA', 'BGS', 'CGC', 'SGC', 'CSG', 'HGA'])) $grader = 'PSA';
    if (!$serial) sendResponse(['error' => 'Missing serial'], 400);

    $certData = lookupCert($conn, $serial, $grader);
    if (!$certData) {
        sendResponse(['found' => false, 'error' => "Serial not found in {$grader} database (checked CardHedger + direct API)"]);
    }

    sendResponse([
        'found'         => true,
        'grader'        => $certData['grader'],
        'card_name'     => $certData['card_name'],
        'card_set'      => $certData['card_set'],
        'card_year'     => $certData['card_year'],
        'card_number'   => $certData['card_number'],
        'grade_desc'    => $certData['grade_desc'],
        'front_img_url' => $certData['front_img_url'],
    ]);
}

// ─────────────────────────────────────────────────────────
// POST: save — persist check result, link/create psa_slab
// ─────────────────────────────="────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'save') {
    // DEBUG: Log what PHP actually received
    $rawLen = strlen($rawBody);
    $inputEmpty = empty($input);
    $debugInfo = [
        'raw_body_length' => $rawLen,
        'input_empty' => $inputEmpty,
        'json_last_error' => json_last_error_msg(),
        'has_grading_house' => isset($input['grading_house']),
        'has_front_img' => isset($input['front_img']),
        'has_checks' => isset($input['checks']),
        'has_checks_json' => isset($input['checks_json']),
        'content_type' => $_SERVER['CONTENT_TYPE'] ?? 'unknown',
        'post_max_size' => ini_get('post_max_size'),
        'memory_limit' => ini_get('memory_limit'),
    ];
    error_log('[SlabChecker Save] Debug: ' . json_encode($debugInfo));

    // If raw body is empty or input failed to parse, fail early with debug info
    if ($rawLen === 0) {
        sendResponse(['error' => 'Empty request body received by server. post_max_size=' . ini_get('post_max_size'), 'debug' => $debugInfo], 400);
    }
    if ($inputEmpty) {
        sendResponse(['error' => 'Failed to parse JSON body. json_error=' . json_last_error_msg() . ' raw_length=' . $rawLen, 'debug' => $debugInfo], 400);
    }

    $gradingHouse   = $input['grading_house'] ?? 'PSA';
    $score          = isset($input['authenticity_score']) ? (int)$input['authenticity_score'] : null;
    $verdict        = $input['verdict'] ?? null;
    $reasoning      = $input['ai_reasoning'] ?? null;
    // checks may arrive as array (JSON body)
    $checksRaw      = $input['checks_json'] ?? ($input['checks'] ?? null);
    $checksJson     = is_string($checksRaw) ? $checksRaw : (is_array($checksRaw) ? json_encode($checksRaw) : null);
    $frontImg       = $input['front_img'] ?? null;
    $backImg        = $input['back_img'] ?? null;
    $serialDetected = $input['serial_detected'] ?? null;
    $cardName       = $input['card_name_detected'] ?? null;
    $certMismatch   = !empty($input['psa_cert_mismatch']) ? 1 : 0;
    // video_frames may arrive as array (JSON body)
    $framesRaw      = $input['video_frames_json'] ?? ($input['video_frames'] ?? null);
    $framesJson     = is_string($framesRaw) ? $framesRaw : (is_array($framesRaw) ? json_encode($framesRaw) : null);
    $psaSlabId      = isset($input['psa_slab_id']) ? (int)$input['psa_slab_id'] : null;

    // ---- Credit gate: Pro Credit only ----
    $creditCheck = $conn->prepare("SELECT paid_credits, role FROM users WHERE id = ?");
    $creditCheck->bind_param("i", $userId);
    $creditCheck->execute();
    $creditUser = $creditCheck->get_result()->fetch_assoc();

    $isAdmin = ($creditUser['role'] ?? '') === 'admin';
    if (!$isAdmin) {
        $paid = (int)($creditUser['paid_credits'] ?? 0);
        if ($paid < 1) {
            sendResponse(['error' => 'This feature requires 1 Pro Credit. Free credits are not eligible.'], 402);
        }
        if (!deductPaidCredit($conn, $userId)) {
            sendResponse(['error' => 'Failed to deduct credit. Please try again.'], 500);
        }
    }

    // ---- Insert slab_checks record ----
    $stmt = $conn->prepare("INSERT INTO slab_checks
        (user_id, psa_slab_id, grading_house, authenticity_score, verdict, ai_reasoning, checks_json,
         front_img, back_img, serial_detected, card_name_detected, psa_cert_mismatch, video_frames_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->bind_param("iisisssssssis",
        $userId, $psaSlabId, $gradingHouse, $score, $verdict, $reasoning, $checksJson,
        $frontImg, $backImg, $serialDetected, $cardName, $certMismatch, $framesJson
    );

    if (!$stmt->execute()) {
        sendResponse(['error' => 'DB error: ' . $stmt->error], 500);
    }
    $checkId = $stmt->insert_id;

    // ---- Always create/link a psa_slabs vault entry ----
    $newSlabId = null;
    $conflictRow = null;
    if (!$psaSlabId) {
        // Check if ANY active slab already exists (by serial + grader)
        $existingRow = null;
        if ($serialDetected) {
            $existing = $conn->prepare("SELECT id, user_id FROM psa_slabs WHERE psa_serial = ? AND grader = ? AND status = 'active'");
            $existing->bind_param("ss", $serialDetected, $gradingHouse);
            $existing->execute();
            $result = $existing->get_result();
            if ($row = $result->fetch_assoc()) {
                if ((int)$row['user_id'] === $userId) {
                    $existingRow = $row;
                } else {
                    $conflictRow = $row;
                }
            }
        }

        if ($existingRow) {
            $newSlabId = $existingRow['id'];
            if ($frontImg || $backImg) {
                $updImgs = $conn->prepare("UPDATE psa_slabs SET local_front_img = COALESCE(?, local_front_img), local_back_img = COALESCE(?, local_back_img) WHERE id = ?");
                $updImgs->bind_param("ssi", $frontImg, $backImg, $newSlabId);
                $updImgs->execute();
            }
        } else if ($conflictRow) {
            // Anti-Piracy Ownership Conflict
            $newSlabId = $conflictRow['id'];
            $upd = $conn->prepare("UPDATE slab_checks SET psa_slab_id = ? WHERE id = ?");
            $upd->bind_param("ii", $newSlabId, $checkId);
            $upd->execute();
            
            $cr = $conn->query("SELECT paid_credits FROM users WHERE id = $userId")->fetch_assoc();
            sendResponse([
                'success'         => true,
                'status'          => 'ownership_conflict',
                'check_id'        => $checkId,
                'psa_slab_id'     => $newSlabId,
                'credits_remaining' => (int)($cr['paid_credits'] ?? 0),
            ]);
        } else {
            // Create new vault entry — do cert lookup if serial exists
            $gradeDesc = null; $gradeNum = null; $sCardName = $cardName;
            $sCardSet = null; $sCardYear = null; $sCardNum = null;
            $sFrontImg = null; $sRawJson = null;

            if ($serialDetected) {
                $certLookup = lookupCert($conn, $serialDetected, $gradingHouse);
                $gradeDesc  = $certLookup['grade_desc'] ?? null;
                $gradeNum   = $certLookup['grade'] ?? null;
                $sCardName  = $certLookup['card_name'] ?? $cardName;
                $sCardSet   = $certLookup['card_set'] ?? null;
                $sCardYear  = $certLookup['card_year'] ?? null;
                $sCardNum   = $certLookup['card_number'] ?? null;
                $sFrontImg  = $certLookup['front_img_url'] ?? null;
                $sRawJson   = $certLookup ? json_encode($certLookup['raw_response'] ?? []) : null;
            }

            $useSerial = $serialDetected ?: ('AUTH-' . $checkId);
            $status    = 'active';

            $ins = $conn->prepare("INSERT INTO psa_slabs
                (user_id, psa_serial, grader, psa_grade, psa_grade_desc, card_name, card_set, card_year, card_number,
                 front_img_url, psa_raw_json, local_front_img, local_back_img, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $ins->bind_param("isssssssssssss",
                $userId, $useSerial, $gradingHouse, $gradeNum, $gradeDesc, $sCardName, $sCardSet, $sCardYear, $sCardNum,
                $sFrontImg, $sRawJson, $frontImg, $backImg, $status
            );
            if ($ins->execute()) {
                $newSlabId = $ins->insert_id;
                // Back-link the check record
                $upd = $conn->prepare("UPDATE slab_checks SET psa_slab_id = ? WHERE id = ?");
                $upd->bind_param("ii", $newSlabId, $checkId);
                $upd->execute();
            }
        }
    } else {
        $newSlabId = $psaSlabId;
        if ($frontImg || $backImg) {
            $updImgs = $conn->prepare("UPDATE psa_slabs SET local_front_img = COALESCE(?, local_front_img), local_back_img = COALESCE(?, local_back_img) WHERE id = ?");
            $updImgs->bind_param("ssi", $frontImg, $backImg, $newSlabId);
            $updImgs->execute();
        }
        // Back-link the check record
        $upd = $conn->prepare("UPDATE slab_checks SET psa_slab_id = ? WHERE id = ?");
        $upd->bind_param("ii", $newSlabId, $checkId);
        $upd->execute();
    }

    // Return remaining credits
    $remaining = null;
    if (!$isAdmin) {
        $cr = $conn->query("SELECT paid_credits FROM users WHERE id = $userId")->fetch_assoc();
        $remaining = (int)($cr['paid_credits'] ?? 0);
    }

    sendResponse([
        'success'         => true,
        'check_id'        => $checkId,
        'psa_slab_id'     => $newSlabId ?? $psaSlabId,
        'credits_remaining' => $remaining,
    ]);
}

// ─────────────────────────────────────────────────────────
// GET: list — recent checks for this user
// ─────────────────────────────────────────────────────────
if ($action === 'list') {
    $stmt = $conn->prepare("
        SELECT sc.id, sc.grading_house, sc.authenticity_score, sc.verdict,
               sc.serial_detected, sc.card_name_detected, sc.psa_cert_mismatch, sc.created_at,
               sc.psa_slab_id, sc.checks_json, sc.ai_reasoning
        FROM slab_checks sc
        WHERE sc.user_id = ?
        ORDER BY sc.created_at DESC
        LIMIT 50
    ");
    $stmt->bind_param("i", $userId);
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    foreach ($rows as &$r) {
        $r['authenticity_score'] = $r['authenticity_score'] !== null ? (int)$r['authenticity_score'] : null;
        $r['psa_cert_mismatch']  = (bool)$r['psa_cert_mismatch'];
        if ($r['checks_json']) $r['checks'] = json_decode($r['checks_json'], true);
        unset($r['checks_json']);
    }
    sendResponse($rows);
}

// ─────────────────────────────────────────────────────────
// GET: get_auth_cert — single certificate lookup
// ─────────────────────────────────────────────────────────
if ($action === 'get_auth_cert') {
    $checkId = isset($_GET['check_id']) ? (int)$_GET['check_id'] : 0;
    if (!$checkId) sendResponse(['error' => 'Missing check_id'], 400);

    $stmt = $conn->prepare("
        SELECT sc.*, p.front_img_url as psa_front_img, p.local_front_img as psa_local_front, p.local_back_img as psa_local_back
        FROM slab_checks sc
        LEFT JOIN psa_slabs p ON sc.psa_slab_id = p.id
        WHERE sc.id = ? AND sc.user_id = ?
    ");
    $stmt->bind_param("ii", $checkId, $userId);
    $stmt->execute();
    $res = $stmt->get_result();
    $cert = $res->fetch_assoc();
    if (!$cert) sendResponse(['error' => 'Certificate not found'], 404);

    sendResponse(['success' => true, 'cert' => $cert]);
}

// ─────────────────────────────────────────────────────────
// POST: request_transfer — explicitly request ownership of a slab
// ─────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'request_transfer') {
    $psaSlabId = isset($input['psa_slab_id']) ? (int)$input['psa_slab_id'] : 0;
    if (!$psaSlabId) sendResponse(['error' => 'Missing slab ID'], 400);

    $chk = $conn->prepare("SELECT user_id FROM psa_slabs WHERE id = ?");
    $chk->bind_param("i", $psaSlabId);
    $chk->execute();
    $slabRow = $chk->get_result()->fetch_assoc();
    
    if (!$slabRow) sendResponse(['error' => 'Slab not found'], 404);
    if ((int)$slabRow['user_id'] === $userId) sendResponse(['error' => 'You already own this slab'], 400);

    $upd = $conn->prepare("UPDATE psa_slabs SET transfer_requested_by = ?, transfer_status = 'pending' WHERE id = ?");
    $upd->bind_param("ii", $userId, $psaSlabId);
    
    if ($upd->execute()) {
        sendResponse(['success' => true]);
    } else {
        sendResponse(['error' => 'Database error'], 500);
    }
}

sendResponse(['error' => 'Invalid action'], 400);

