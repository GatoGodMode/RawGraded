<?php
// plugin_psa_vault.php
require_once('db.php');

$user = requireAuth();
$userId = $user['id'];

$action = $_GET['action'] ?? '';
$input = json_decode(file_get_contents('php://input'), true) ?? [];

// Helper to auto-create the table
function ensureSlabsTable($conn) {
    $sql = "CREATE TABLE IF NOT EXISTS `psa_slabs` (
        `id` int(11) NOT NULL AUTO_INCREMENT,
        `user_id` int(11) NOT NULL,
        `cert_id` varchar(50) DEFAULT NULL,
        `grader` varchar(10) DEFAULT 'PSA',
        `psa_serial` varchar(50) NOT NULL,
        `psa_grade` varchar(20) DEFAULT NULL,
        `psa_grade_desc` varchar(100) DEFAULT NULL,
        `card_name` varchar(255) DEFAULT NULL,
        `card_set` varchar(255) DEFAULT NULL,
        `card_year` varchar(10) DEFAULT NULL,
        `card_number` varchar(50) DEFAULT NULL,
        `front_img_url` text DEFAULT NULL,
        `psa_raw_json` longtext DEFAULT NULL,
        `acq_price` decimal(10,2) DEFAULT NULL,
        `acq_grading_fee` decimal(10,2) DEFAULT NULL,
        `acq_shipping` decimal(10,2) DEFAULT NULL,
        `acq_date` date DEFAULT NULL,
        `acq_source` varchar(255) DEFAULT NULL,
        `user_notes` text DEFAULT NULL,
        `status` varchar(20) DEFAULT 'active',
        `sold_price` decimal(10,2) DEFAULT NULL,
        `transfer_from_user_id` int(11) DEFAULT NULL,
        `added_at` datetime DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (`id`),
        KEY `idx_user` (`user_id`),
        KEY `idx_cert` (`cert_id`),
        KEY `idx_serial` (`psa_serial`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";
    $conn->query($sql);
    
    // Add columns if they missed the initial auto-create, one by one so existing columns don't abort the rest
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

// Fetch from PSA Public API (operator key in settings table)
function fetchPsaCert($conn, $serial) {
    require_once __DIR__ . '/settings_util.php';
    $apiKey = readSetting($conn, 'psa_public_api_key');
    if ($apiKey === '') {
        return null;
    }
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, "https://api.psacard.com/publicapi/cert/GetByCertNumber/" . urlencode($serial));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Authorization: bearer " . $apiKey,
        "Accept: application/json"
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode !== 200 || !$response) {
        return null;
    }
    return json_decode($response, true);
}

// ─────────────────────────────────────────────────────────
// Support functions for BGS/CGC lookups via CardHedger
// ─────────────────────────────────────────────────────────
function plugin_vault_getCardHedgerKey($conn) {
    $row = $conn->query("SELECT `value` FROM settings WHERE `key` = 'cardhedger_api_key' LIMIT 1")->fetch_assoc();
    return $row['value'] ?? '';
}

function plugin_vault_fetchCardHedgerCert($conn, $serial, $grader) {
    $apiKey = plugin_vault_getCardHedgerKey($conn);
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
    
    return $data; // Raw output from CardHedger
}

// Ensure table exists for ANY action
ensureSlabsTable($conn);

if ($action === 'list') {
    // GET list of slabs
    $stmt = $conn->prepare("
        SELECT s.*, c.overall_grade as rg_grade, c.name as rg_cert_name, 
               u_req.username as req_username,
               c.front_thumb as rg_front_thumb, c.front_img as rg_front_img, c.id as rg_cert_id,
               sc.id as auth_check_id, sc.authenticity_score, sc.verdict
        FROM psa_slabs s
        LEFT JOIN certificates c ON c.id = s.cert_id AND c.user_id = s.user_id
        LEFT JOIN users u_req ON u_req.id = s.transfer_requested_by
        LEFT JOIN (
            SELECT id, psa_slab_id, authenticity_score, verdict
            FROM slab_checks
            WHERE id IN (
                SELECT MAX(id) FROM slab_checks GROUP BY psa_slab_id
            )
        ) sc ON sc.psa_slab_id = s.id
        WHERE s.user_id = ? OR (s.transfer_from_user_id = ? AND s.status = 'pending_transfer')
        ORDER BY s.added_at DESC
    ");
    $stmt->bind_param("ii", $userId, $userId);
    $stmt->execute();
    $res = $stmt->get_result();
    $slabs = [];
    while ($row = $res->fetch_assoc()) {
        // Parse numerics
        foreach(['acq_price', 'acq_grading_fee', 'acq_shipping'] as $field) {
            if ($row[$field] !== null) $row[$field] = (float)$row[$field];
        }
        if ($row['rg_grade'] !== null) $row['rg_grade'] = (float)$row['rg_grade'];
        if ($row['auth_check_id'] !== null) $row['auth_check_id'] = (int)$row['auth_check_id'];
        if ($row['authenticity_score'] !== null) $row['authenticity_score'] = (int)$row['authenticity_score'];
        $slabs[] = $row;
    }
    sendResponse($slabs);
}

// GET: lookup — preview slab cert data from grading API without saving to DB
if ($action === 'lookup') {
    $serial = trim($_GET['serial'] ?? '');
    $grader = strtoupper(trim($_GET['grader'] ?? 'PSA'));
    if (!$serial) sendResponse(['error' => 'Missing serial number'], 400);

    $gradeNumStr = null; $gradeDesc = null; $cardName = null;
    $cardSet = null; $cardYear = null; $cardNumber = null;
    $frontImg = null;

    if ($grader === 'PSA') {
        $psaRaw = fetchPsaCert($conn, $serial);
        if (!$psaRaw || empty($psaRaw['PSACert'])) {
            sendResponse(['error' => 'Could not fetch data for this serial from PSA API.'], 404);
        }
        $certData = $psaRaw['PSACert'];
        $gradeDesc = $certData['GradeDescription'] ?? null;
        if ($gradeDesc && preg_match('/(?:^|\s)(10|[1-9](?:\.5)?)(?:$|\s)/', $gradeDesc, $m)) {
            $gradeNumStr = $m[1];
        } else if (isset($certData['CardGrade'])) {
            $gradeNumStr = $certData['CardGrade'];
        }
        $cardName = $certData['Subject'] ?? null;
        $cardSet = $certData['CardSet'] ?? null;
        $cardYear = $certData['Year'] ?? null;
        $cardNumber = $certData['CardNumber'] ?? null;
        $frontImg = $certData['FrontImageURL'] ?? null;
    } else {
        $chData = plugin_vault_fetchCardHedgerCert($conn, $serial, $grader);
        if (!$chData || empty($chData['cert_info'])) {
            sendResponse(['error' => "Could not fetch data for this serial from CardHedger {$grader} API."], 404);
        }
        $ci = $chData['cert_info'];
        $card = $chData['card'] ?? [];
        $gradeDesc = $ci['grade'] ?? null;
        if ($gradeDesc && preg_match('/([0-9]+(?:\.[0-9]+)?)\s*$/', $gradeDesc, $m)) {
            $gradeNumStr = $m[1];
        }
        $cardName = $ci['description'] ?? ($card['description'] ?? null);
        $cardSet = $card['set'] ?? null;
        $cardNumber = $card['number'] ?? null;
        if (!empty($card['image'])) {
            $frontImg = strpos($card['image'], 'http') === 0 ? $card['image'] : 'https:' . $card['image'];
        }
    }

    // Check if user already has this slab
    $existCheck = $conn->prepare("SELECT id FROM psa_slabs WHERE psa_serial = ? AND grader = ? AND user_id = ? AND status = 'active'");
    $existCheck->bind_param("ssi", $serial, $grader, $userId);
    $existCheck->execute();
    $alreadyExists = $existCheck->get_result()->num_rows > 0;

    sendResponse([
        'success' => true,
        'already_in_vault' => $alreadyExists,
        'slab' => [
            'psa_serial' => $serial,
            'grader' => $grader,
            'psa_grade' => $gradeNumStr,
            'psa_grade_desc' => $gradeDesc,
            'card_name' => $cardName,
            'card_set' => $cardSet,
            'card_year' => $cardYear,
            'card_number' => $cardNumber,
            'front_img_url' => $frontImg,
        ]
    ]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if ($action === 'add') {
        $serial = trim($input['psa_serial'] ?? '');
        $grader = strtoupper(trim($input['grader'] ?? 'PSA'));
        if (!in_array($grader, ['PSA', 'BGS', 'CGC', 'SGC', 'CSG', 'HGA'])) $grader = 'PSA';
        if (!$serial) sendResponse(['error' => "Missing {$grader} serial number"], 400);

        // Prevent dupes and check for transfers
        $checkStmt = $conn->prepare("SELECT id, user_id, status FROM psa_slabs WHERE psa_serial = ? AND grader = ? AND status IN ('active', 'pending_transfer')");
        $checkStmt->bind_param("ss", $serial, $grader);
        $checkStmt->execute();
        $existingRows = $checkStmt->get_result()->fetch_all(MYSQLI_ASSOC);
        
        $transferFromUserId = null;
        $status = 'active';

        foreach ($existingRows as $row) {
            if ((int)$row['user_id'] === (int)$userId) {
                if ($row['status'] === 'active') {
                    sendResponse(['error' => 'Slab with this cert is already active in your vault.'], 400);
                } else if ($row['status'] === 'pending_transfer') {
                    sendResponse(['error' => 'You already have a pending transfer request for this slab.'], 400);
                }
            } else {
                if ($row['status'] === 'active') {
                    $transferFromUserId = $row['user_id'];
                    $status = 'pending_transfer';
                }
            }
        }

        // Initialize variables that will hold the universal parsed data
        $gradeNumStr = null;
        $gradeDesc = null;
        $cardName = null;
        $cardSet = null;
        $cardYear = null;
        $cardNumber = null;
        $frontImg = null;
        $rawJson = null;

        if ($grader === 'PSA') {
            // Native PSA lookup
            $psaRaw = fetchPsaCert($conn, $serial);
            if (!$psaRaw || empty($psaRaw['PSACert'])) {
                sendResponse(['error' => 'Could not fetch data for this serial from PSA API.'], 404);
            }
            $certData = $psaRaw['PSACert'];
            $gradeDesc = $certData['GradeDescription'] ?? null;
            if ($gradeDesc && preg_match('/(?:^|\s)(10|[1-9](?:\.5)?)(?:$|\s)/', $gradeDesc, $m)) {
                $gradeNumStr = $m[1];
            } else if (isset($certData['CardGrade'])) {
                $gradeNumStr = $certData['CardGrade'];
            }
            $cardName = $certData['Subject'] ?? null;
            $cardSet = $certData['CardSet'] ?? null;
            $cardYear = $certData['Year'] ?? null;
            $cardNumber = $certData['CardNumber'] ?? null;
            $frontImg = $certData['FrontImageURL'] ?? null;
            $rawJson = json_encode($psaRaw);

        } else {
            // CardHedger lookup for BGS/CGC
            $chData = plugin_vault_fetchCardHedgerCert($conn, $serial, $grader);
            if (!$chData || empty($chData['cert_info'])) {
                sendResponse(['error' => "Could not fetch data for this serial from CardHedger {$grader} API."], 404);
            }
            $ci = $chData['cert_info'];
            $card = $chData['card'] ?? [];
            $gradeDesc = $ci['grade'] ?? null;
            if ($gradeDesc && preg_match('/([0-9]+(?:\.[0-9]+)?)\s*$/', $gradeDesc, $m)) {
                $gradeNumStr = $m[1];
            }
            $cardName = $ci['description'] ?? ($card['description'] ?? null);
            $cardSet = $card['set'] ?? null;
            $cardNumber = $card['number'] ?? null;
            if (!empty($card['image'])) {
                $frontImg = strpos($card['image'], 'http') === 0 ? $card['image'] : 'https:' . $card['image'];
            }
            $rawJson = json_encode($chData);
        }

        $price = isset($input['acq_price']) ? (float)$input['acq_price'] : null;
        $grading = isset($input['acq_grading_fee']) ? (float)$input['acq_grading_fee'] : null;
        $shipping = isset($input['acq_shipping']) ? (float)$input['acq_shipping'] : null;
        $source = $input['acq_source'] ?? null;
        $date = $input['acq_date'] ?? null;

        $stmt = $conn->prepare("INSERT INTO psa_slabs 
            (user_id, grader, psa_serial, psa_grade, psa_grade_desc, card_name, card_set, card_year, card_number, front_img_url, psa_raw_json, acq_price, acq_grading_fee, acq_shipping, acq_source, acq_date, status, transfer_from_user_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        
        $stmt->bind_param("isssssssssssdddsssi", 
            $userId, $grader, $serial, $gradeNumStr, $gradeDesc, $cardName, $cardSet, $cardYear, $cardNumber, $frontImg, $rawJson,
            $price, $grading, $shipping, $source, $date, $status, $transferFromUserId
        );

        if ($stmt->execute()) {
            $newId = $stmt->insert_id;
            // Fetch back
            $sel = $conn->query("SELECT * FROM psa_slabs WHERE id = $newId");
            sendResponse([
                'success' => true,
                'slab' => $sel->fetch_assoc()
            ]);
        } else {
            sendResponse(['error' => 'Database error: ' . $stmt->error], 500);
        }
    }

    if ($action === 'link') {
        $slabId = (int)($input['slab_id'] ?? 0);
        $certId = $input['cert_id'] ?? '';
        if (!$slabId || !$certId) sendResponse(['error' => 'Missing ID'], 400);

        // Verify cert ownership
        $certStmt = $conn->prepare("SELECT id FROM certificates WHERE id = ? AND user_id = ?");
        $certStmt->bind_param("si", $certId, $userId);
        $certStmt->execute();
        if ($certStmt->get_result()->num_rows === 0) {
            sendResponse(['error' => 'Certificate not found or unauthorized'], 403);
        }

        $stmt = $conn->prepare("UPDATE psa_slabs SET cert_id = ? WHERE id = ? AND user_id = ?");
        $stmt->bind_param("sii", $certId, $slabId, $userId);
        $stmt->execute();
        if ($stmt->affected_rows > 0) {
            sendResponse(['success' => true]);
        } else {
            sendResponse(['error' => 'Update failed or unauthorized'], 400);
        }
    }

    if ($action === 'unlink') {
        $slabId = (int)($input['slab_id'] ?? 0);
        if (!$slabId) sendResponse(['error' => 'Missing ID'], 400);
        
        $stmt = $conn->prepare("UPDATE psa_slabs SET cert_id = NULL WHERE id = ? AND user_id = ?");
        $stmt->bind_param("ii", $slabId, $userId);
        if ($stmt->execute()) {
            sendResponse(['success' => true]);
        } else {
            sendResponse(['error' => 'Update failed'], 400);
        }
    }

    if ($action === 'update_acq') {
        $slabId = (int)($input['slab_id'] ?? 0);
        if (!$slabId) sendResponse(['error' => 'Missing ID'], 400);

        $price = isset($input['acq_price']) ? (float)$input['acq_price'] : null;
        $grading = isset($input['acq_grading_fee']) ? (float)$input['acq_grading_fee'] : null;
        $shipping = isset($input['acq_shipping']) ? (float)$input['acq_shipping'] : null;
        $source = $input['acq_source'] ?? null;
        $date = $input['acq_date'] ?? null;
        $notes = $input['user_notes'] ?? null;

        $stmt = $conn->prepare("UPDATE psa_slabs SET acq_price=?, acq_grading_fee=?, acq_shipping=?, acq_source=?, acq_date=?, user_notes=? WHERE id=? AND user_id=?");
        $stmt->bind_param("dddsssii", $price, $grading, $shipping, $source, $date, $notes, $slabId, $userId);
        if ($stmt->execute()) {
            sendResponse(['success' => true]);
        } else {
            sendResponse(['error' => 'Update failed'], 400);
        }
    }

    if ($action === 'delete') {
        $slabId = (int)($input['slab_id'] ?? 0);
        if (!$slabId) sendResponse(['error' => 'Missing ID'], 400);
        
        $stmt = $conn->prepare("DELETE FROM psa_slabs WHERE id = ? AND user_id = ?");
        $stmt->bind_param("ii", $slabId, $userId);
        if ($stmt->execute()) {
            sendResponse(['success' => true]);
        } else {
            sendResponse(['error' => 'Delete failed'], 400);
        }
    }

    if ($action === 'upload_image') {
        $slabId = (int)($input['slab_id'] ?? 0);
        $side = $input['side'] ?? 'front';
        $b64 = $input['b64'] ?? '';
        
        if (!$slabId || !$b64 || !in_array($side, ['front', 'back'])) {
            sendResponse(['error' => 'Invalid or missing fields'], 400);
        }

        $col = $side === 'back' ? 'local_back_img' : 'local_front_img';

        $stmt = $conn->prepare("UPDATE psa_slabs SET $col = ? WHERE id = ? AND user_id = ?");
        $stmt->bind_param("sii", $b64, $slabId, $userId);
        if ($stmt->execute() && $stmt->affected_rows > 0) {
            sendResponse(['success' => true]);
        } else {
            sendResponse(['error' => 'Upload failed or unauthorized'], 400);
        }
    }

    if ($action === 'resolve_transfer') {
        $slabId = (int)($input['slab_id'] ?? 0);
        $resolution = $input['resolution'] ?? 'decline'; // 'accept', 'decline', 'dispute'
        if (!$slabId || !in_array($resolution, ['accept', 'decline', 'dispute'])) {
            sendResponse(['error' => 'Invalid parameters'], 400);
        }

        // Verify ownership and get requester
        $pStmt = $conn->prepare("SELECT transfer_requested_by FROM psa_slabs WHERE id = ? AND user_id = ? AND transfer_status = 'pending'");
        $pStmt->bind_param("ii", $slabId, $userId);
        $pStmt->execute();
        $pRes = $pStmt->get_result();
        if ($pRes->num_rows === 0) sendResponse(['error' => 'Pending transfer request not found or unauthorized'], 403);
        $row = $pRes->fetch_assoc();
        
        if ($resolution === 'accept') {
            $newUserId = (int)$row['transfer_requested_by'];
            $upd = $conn->prepare("UPDATE psa_slabs SET user_id = ?, transfer_requested_by = NULL, transfer_status = NULL, for_sale = 0 WHERE id = ?");
            $upd->bind_param("ii", $newUserId, $slabId);
            if ($upd->execute()) {
                sendResponse(['success' => true]);
            } else {
                sendResponse(['error' => 'Failed to transfer ownership'], 500);
            }
        } else {
            // decline or dispute
            $upd = $conn->prepare("UPDATE psa_slabs SET transfer_status = ? WHERE id = ?");
            $upd->bind_param("si", $resolution, $slabId);
            if ($upd->execute()) {
                sendResponse(['success' => true]);
            } else {
                sendResponse(['error' => 'Failed to resolve request'], 500);
            }
        }
    }

    if ($action === 'toggle_sale') {
        $slabId = (int)($input['slab_id'] ?? 0);
        $forSale = !empty($input['for_sale']) ? 1 : 0;
        $saleLink = trim($input['sale_link'] ?? '');
        
        if (!$slabId) sendResponse(['error' => 'Missing ID'], 400);

        $stmt = $conn->prepare("UPDATE psa_slabs SET for_sale = ?, sale_link = ? WHERE id = ? AND user_id = ?");
        $stmt->bind_param("isii", $forSale, $saleLink, $slabId, $userId);
        if ($stmt->execute()) {
            sendResponse(['success' => true]);
        } else {
            sendResponse(['error' => 'Failed to update sale status'], 500);
        }
    }

    if ($action === 'update_notes') {
        $slabId = (int)($input['slab_id'] ?? 0);
        $notes = trim($input['notes'] ?? '');
        if (!$slabId) sendResponse(['error' => 'Missing ID'], 400);

        $stmt = $conn->prepare("UPDATE psa_slabs SET user_notes = ? WHERE id = ? AND user_id = ?");
        $stmt->bind_param("sii", $notes, $slabId, $userId);
        if ($stmt->execute()) {
            sendResponse(['success' => true]);
        } else {
            sendResponse(['error' => 'Update failed'], 400);
        }
    }
}

sendResponse(['error' => 'Invalid action'], 400);
