<?php
require_once('db.php');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}



$id = $_GET['id'] ?? '';
$imageOnly = $_GET['image'] ?? '';

if (!$id) {
    sendResponse(['error' => 'No ID provided'], 400);
}

// Optional: return only front or back image (same visibility as full verify — by cert id only).
if ($imageOnly === 'front' || $imageOnly === 'back') {
    $col = $imageOnly === 'front' ? 'front_img' : 'back_img';
    $thumbCol = $imageOnly === 'front' ? 'front_thumb' : 'back_thumb';
    $imgStmt = $conn->prepare("SELECT $col, $thumbCol FROM certificates WHERE id = ?");
    $imgStmt->bind_param("s", $id);
    $imgStmt->execute();
    $imgRes = $imgStmt->get_result();
    $imgRow = $imgRes->fetch_assoc();
    if ($imgRow) {
        $b64 = !empty($imgRow[$thumbCol]) ? $imgRow[$thumbCol] : ($imgRow[$col] ?? '');
        if ($b64 !== '') {
            // Ensure client always receives a valid data URL (forensics/EvidenceCrop require it)
            if (strpos($b64, 'data:') !== 0) {
                $b64 = 'data:image/jpeg;base64,' . $b64;
            }
            sendResponse(['data' => $b64]);
        }
    }
    sendResponse(['error' => 'Image not found'], 404);
    exit;
}

// Direct link by id (e.g. QR scan): always return cert for verification; do not filter by is_hidden.
$stmt = $conn->prepare("SELECT c.*, u.username, u.x_username, u.is_alliance, u.is_pck, u.role as user_role 
                        FROM certificates c 
                        LEFT JOIN users u ON c.user_id = u.id 
                        WHERE c.id = ?");
$stmt->bind_param("s", $id);
$stmt->execute();
$result = $stmt->get_result();
$cert = $result->fetch_assoc();

if ($cert) {
    // --- PRIVATE DATA PROTECTION ---
    // Ensure acquisition data and private notes NEVER leak to the browser 
    // unless the requester is the exact owner of the card.
    $is_owner = false;
    if (isset($_SESSION['user']) && isset($_SESSION['user']['id'])) {
        if ((string)$_SESSION['user']['id'] === (string)$cert['user_id']) {
            $is_owner = true;
        }
    }

    if (!$is_owner) {
        unset($cert['acq_price']);
        unset($cert['acq_tax']);
        unset($cert['acq_shipping']);
        unset($cert['acq_date']);
        unset($cert['acq_source']);
        unset($cert['acq_city']);
        unset($cert['acq_state']);
        unset($cert['tracking_number']);
        unset($cert['order_id']);
        unset($cert['user_notes']);
        unset($cert['envelope_receipt_img']);
    }
    // -------------------------------

    // Decode JSON fields
    // NOTE: defects_json is stored as LZString base64 (not plain JSON) — pass as raw string
    // so that App.tsx can call LZString.decompressFromBase64() on it correctly.
    // Only decode video_frames_json and predicted_grades which are stored as plain JSON arrays.
    $cert['video_frames_json'] = json_decode($cert['video_frames_json'] ?? '[]', true);
    $cert['predicted_grades'] = $cert['predicted_grades'] ? json_decode($cert['predicted_grades'], true) : null;
    
    // Fetch Scan Chain (History)
    // 1. Get ancestors
    $history = [];
    $current_parent = $cert['parent_id'];
    while ($current_parent) {
        $p_stmt = $conn->prepare("SELECT id, name, overall_grade, estimated_value, date_scanned FROM certificates WHERE id = ?");
        $p_stmt->bind_param("s", $current_parent);
        $p_stmt->execute();
        $p_res = $p_stmt->get_result();
        $parent = $p_res->fetch_assoc();
        if ($parent) {
            array_unshift($history, $parent); // Add to beginning to keep chronological order
            $current_parent = $parent['parent_id'] ?? null;
        } else {
            break;
        }
    }
    
    // 2. Get descendants
    $descendants = [];
    $d_stmt = $conn->prepare("SELECT id, name, overall_grade, estimated_value, date_scanned FROM certificates WHERE parent_id = ? ORDER BY date_scanned ASC");
    $d_stmt->bind_param("s", $id);
    $d_stmt->execute();
    $d_res = $d_stmt->get_result();
    while ($row = $d_res->fetch_assoc()) {
        $descendants[] = $row;
    }
    
    $cert['history'] = $history;
    $cert['descendants'] = $descendants;
    
    // 3. Find Similar Scans (Same card, different scans)
    $cert['similar_scans'] = findSimilarScans(
        $conn, 
        $cert['name'], 
        $cert['card_set'], 
        $cert['year'], 
        $cert['front_hash'] ?? null, 
        $id, // Exclude self
        6
    );

    sendResponse($cert);
} else {
    sendResponse(['error' => 'Certificate not found'], 404);
}
?>
