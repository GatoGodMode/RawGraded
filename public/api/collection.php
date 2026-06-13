<?php
require_once('db.php');
require_once(__DIR__ . '/membership.php');

// SECURITY: Enforce session-based identity for all vault operations
$user = require_active_platform_membership($conn);
$user_id = $user['id'];
$session_role = $user['role'] ?? 'user';

// If a specific user_id is requested (e.g. for Admin or specific view), handle validation
if (isset($_GET['user_id'])) {
    $requested_uid = (int)$_GET['user_id'];
    
    // Non-admins can ONLY view their own vault
    if ($requested_uid !== $user_id && $session_role !== 'admin') {
        sendResponse(['error' => 'Unauthorized access to another user\'s vault'], 403);
    }
    
    // If validated or admin, use the requested ID
    $user_id = $requested_uid;
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $_GET['action'] ?? ($input['action'] ?? 'list');

if ($action === 'stats') {
    $merged_filter = HAS_MERGED_COL ? " AND (is_merged = 0 OR is_merged IS NULL)" : "";
    $archive_filter = " AND (is_archived = 0 OR is_archived IS NULL)";
    
    // STATS AGGREGATION: Deduplicate linked certificates
    // Only count "Head" cards (cards that are NOT parents) to avoid double counting value/investment
    // Logic: Sum fields where ID is NOT in the list of parent_ids for this user
    $stmt = $conn->prepare("SELECT 
        COUNT(*) as total_scans,
        COALESCE(SUM(CASE WHEN id NOT IN (SELECT parent_id FROM certificates WHERE user_id = ? AND parent_id IS NOT NULL) THEN estimated_value ELSE 0 END), 0) as total_value,
        COALESCE(SUM(CASE WHEN id NOT IN (SELECT parent_id FROM certificates WHERE user_id = ? AND parent_id IS NOT NULL) THEN (COALESCE(acq_price, 0) + COALESCE(acq_tax, 0) + COALESCE(acq_shipping, 0)) ELSE 0 END), 0) as total_investment,
        COALESCE(SUM(CASE WHEN id NOT IN (SELECT parent_id FROM certificates WHERE user_id = ? AND parent_id IS NOT NULL) THEN COALESCE(acq_price, 0) ELSE 0 END), 0) as total_price,
        COALESCE(SUM(CASE WHEN id NOT IN (SELECT parent_id FROM certificates WHERE user_id = ? AND parent_id IS NOT NULL) THEN COALESCE(acq_tax, 0) ELSE 0 END), 0) as total_tax,
        COALESCE(SUM(CASE WHEN id NOT IN (SELECT parent_id FROM certificates WHERE user_id = ? AND parent_id IS NOT NULL) THEN COALESCE(acq_shipping, 0) ELSE 0 END), 0) as total_shipping,
        COALESCE(AVG(overall_grade), 0) as avg_score,
        COUNT(DISTINCT CASE WHEN id NOT IN (SELECT parent_id FROM certificates WHERE user_id = ? AND parent_id IS NOT NULL) THEN id END) as total_unique_cards,
        COUNT(CASE WHEN vault_copy IS NULL AND id NOT IN (SELECT parent_id FROM certificates WHERE user_id = ? AND parent_id IS NOT NULL) AND EXISTS (SELECT 1 FROM certificates c2 WHERE c2.user_id = ? AND c2.name = certificates.name AND c2.card_set = certificates.card_set AND c2.year = certificates.year AND c2.vault_copy IS NOT NULL) THEN 1 END) as orphaned_copies,
        COUNT(CASE WHEN estimated_value > 0 THEN 1 END) as total_valuations
        FROM certificates WHERE user_id = ?" . $merged_filter . $archive_filter);
    $stmt->bind_param("sssssssss", $user_id, $user_id, $user_id, $user_id, $user_id, $user_id, $user_id, $user_id, $user_id);
    $stmt->execute();
    $stats = $stmt->get_result()->fetch_assoc();
    
    // Format for frontend
    $response = [
        'total_scans' => (int)$stats['total_scans'],
        'total_unique_cards' => (int)$stats['total_unique_cards'],
        'orphaned_copies' => (int)$stats['orphaned_copies'],
        'total_value' => (float)$stats['total_value'],
        'total_investment' => (float)$stats['total_investment'],
        'investment_breakdown' => [
            'price' => (float)$stats['total_price'],
            'tax' => (float)$stats['total_tax'],
            'shipping' => (float)$stats['total_shipping']
        ],
        'avg_score' => round((float)$stats['avg_score'], 1),
        'total_valuations' => (int)$stats['total_valuations']
    ];
    sendResponse($response);

} elseif ($action === 'update_notes') {
    $cert_id = $input['id'] ?? '';
    $notes = $input['notes'] ?? '';
    
    if (!$cert_id) sendResponse(['error' => 'ID required'], 400);
    
    $stmt = $conn->prepare("UPDATE certificates SET user_notes = ? WHERE id = ? AND user_id = ?");
    $stmt->bind_param("sss", $notes, $cert_id, $user_id);
    
    if ($stmt->execute()) {
        sendResponse(['success' => true]);
    } else {
        sendResponse(['error' => $stmt->error], 500);
    }

} elseif ($action === 'update_vault_copies') {
    $ids = $input['ids'] ?? [];
    if (empty($ids) || !is_array($ids)) sendResponse(['error' => 'Invalid sequence array'], 400);

    // Get the name/set of the first ID to wipe existing copies for that set to prevent duplicates
    $first_id = $ids[0];
    $stmt = $conn->prepare("SELECT name, card_set, year FROM certificates WHERE id = ? AND user_id = ?");
    $stmt->bind_param("ss", $first_id, $user_id);
    $stmt->execute();
    $anchor = $stmt->get_result()->fetch_assoc();
    
    if ($anchor) {
        $wipe = $conn->prepare("UPDATE certificates SET vault_copy = NULL WHERE user_id = ? AND name = ? AND card_set = ? AND year = ?");
        $wipe->bind_param("ssss", $user_id, $anchor['name'], $anchor['card_set'], $anchor['year']);
        $wipe->execute();
    }

    $success_count = 0;
    $copy_num = 1;
    $upd = $conn->prepare("UPDATE certificates SET vault_copy = ? WHERE id = ? AND user_id = ?");
    
    foreach ($ids as $cid) {
        $upd->bind_param("iss", $copy_num, $cid, $user_id);
        if ($upd->execute()) {
            $success_count++;
            $copy_num++;
        }
    }
    sendResponse(['success' => true, 'updated' => $success_count]);

} elseif ($action === 'uncount_copy') {
    $cid = $input['id'] ?? '';
    if (!$cid) sendResponse(['error' => 'ID required'], 400);
    
    $stmt = $conn->prepare("UPDATE certificates SET vault_copy = NULL WHERE id = ? AND user_id = ?");
    $stmt->bind_param("ss", $cid, $user_id);
    
    if ($stmt->execute()) sendResponse(['success' => true]);
    else sendResponse(['error' => $stmt->error], 500);

} elseif ($action === 'update_valuation') {
    $cert_id = $input['cert_id'] ?? $input['id'] ?? '';
    $estimated_value = $input['estimated_value'] ?? 0;
    
    // Acquisition Fields
    $acq_price = $input['acq_price'] ?? null;
    $acq_tax = $input['acq_tax'] ?? null;
    $acq_shipping = $input['acq_shipping'] ?? null;
    $acq_date = $input['acq_date'] ?? null;
    $acq_source = $input['acq_source'] ?? null;
    $acq_city = $input['acq_city'] ?? null;
    $acq_state = $input['acq_state'] ?? null;
    $tracking_number = $input['tracking_number'] ?? null;
    $order_id = $input['order_id'] ?? null;
    $envelope_receipt_img = $input['envelope_receipt_img'] ?? null;
    $vault_copy = $input['vault_copy'] ?? null;
    
    $user_notes = $input['user_notes'] ?? null;
    
    if (!$cert_id) sendResponse(['error' => 'ID required'], 400);
    
    // Update valuation and acquisition for the user's card
    $stmt = $conn->prepare("UPDATE certificates SET 
        estimated_value = ?, 
        acq_price = ?, 
        acq_tax = ?, 
        acq_shipping = ?, 
        acq_date = ?, 
        acq_source = ?, 
        acq_city = ?, 
        acq_state = ?,
        tracking_number = ?,
        order_id = ?,
        vault_copy = ?,
        envelope_receipt_img = COALESCE(?, envelope_receipt_img),
        user_notes = COALESCE(?, user_notes)
        WHERE id = ? AND user_id = ?");
    $stmt->bind_param("ddddssssssissss", 
        $estimated_value, 
        $acq_price, 
        $acq_tax, 
        $acq_shipping, 
        $acq_date, 
        $acq_source, 
        $acq_city, 
        $acq_state,
        $tracking_number,
        $order_id,
        $vault_copy,
        $envelope_receipt_img,
        $user_notes,
        $cert_id, 
        $user_id
    );
    
    if ($stmt->execute()) {
        sendResponse(['success' => true]);
    } else {
        sendResponse(['error' => $stmt->error], 500);
    }

} elseif ($action === 'bulk_update') {
    // Expected Payload: { ids: ["id1", "id2"], updates: { is_first_edition: 1, card_set: "New Set Name" } }
    if (empty($input['ids']) || empty($input['updates'])) {
        sendResponse(['error' => 'Invalid bulk update payload'], 400);
    }

    $ids = $input['ids'];
    $updates = $input['updates'];
    $allowed_updates = ['is_first_edition', 'is_holographic', 'holo_pattern', 'card_set', 'year'];
    
    $set_clauses = [];
    $params = [];
    $types = "";

    foreach ($updates as $key => $val) {
        if (in_array($key, $allowed_updates)) {
            $set_clauses[] = "`$key` = ?";
            $params[] = $val;
            $types .= is_int($val) ? "i" : "s";
        }
    }

    if (empty($set_clauses)) {
        sendResponse(['error' => 'No valid fields to update'], 400);
    }

    // Verify ownership for all IDs
    $inKey = str_repeat('?,', count($ids) - 1) . '?';
    $verify_stmt = $conn->prepare("SELECT id FROM certificates WHERE id IN ($inKey) AND user_id = ?");
    
    $verifyParams = $ids;
    $verifyParams[] = $user_id;
    $verifyTypes = str_repeat('s', count($ids)) . 's'; // Standardize to string
    
    $verify_stmt->bind_param($verifyTypes, ...$verifyParams);
    $verify_stmt->execute();
    $result = $verify_stmt->get_result();
    $owned_ids = [];
    while ($row = $result->fetch_assoc()) {
        $owned_ids[] = $row['id'];
    }

    if (count($owned_ids) !== count($ids)) {
        // Strict failure or partial? For data integrity, strictly fail if not fully owned
        sendResponse(['error' => 'Permission denied: Cannot edit one or more of the selected certificates.'], 403);
    }

    // Execute Bulk Update
    $set_str = implode(', ', $set_clauses);
    $update_stmt = $conn->prepare("UPDATE certificates SET $set_str WHERE id IN ($inKey) AND user_id = ?");
    
    $finalParams = array_merge($params, $ids, [$user_id]);
    $finalTypes = $types . $verifyTypes;
    
    $update_stmt->bind_param($finalTypes, ...$finalParams);

    if ($update_stmt->execute()) {
        sendResponse(['success' => true, 'updated_count' => $update_stmt->affected_rows]);
    } else {
        sendResponse(['error' => 'Bulk update failed: ' . $update_stmt->error], 500);
    }

} elseif ($action === 'rename_cert') {
    $cert_id = $input['id'] ?? '';
    $new_name = $input['new_name'] ?? '';
    
    if (!$cert_id || !$new_name) sendResponse(['error' => 'ID and new_name required'], 400);

    // Verify ownership OR admin
    $stmt = $conn->prepare("SELECT id, user_id, name, name_history FROM certificates WHERE id = ?");
    $stmt->bind_param("s", $cert_id);
    $stmt->execute();
    $cert = $stmt->get_result()->fetch_assoc();

    if (!$cert) sendResponse(['error' => 'Certificate not found'], 404);
    if ($cert['user_id'] !== $user_id && $session_role !== 'admin') {
        sendResponse(['error' => 'Unauthorized'], 403);
    }

    $old_name = $cert['name'];
    $history = json_decode($cert['name_history'] ?: '[]', true);
    if (!is_array($history)) $history = [];

    $now = date('Y-m-d H:i:s');
    $updater = $session_role === 'admin' ? "@admin" : "@" . ($user['x_username'] ?? 'owner');

    $history[] = [
        'old_name' => $old_name,
        'new_name' => $new_name,
        'changed_at' => $now,
        'changed_by' => $updater
    ];
    $history_json = json_encode($history);

    $upd = $conn->prepare("UPDATE certificates SET name = ?, name_updated_at = ?, name_updated_by = ?, name_history = ? WHERE id = ?");
    $upd->bind_param("sssss", $new_name, $now, $updater, $history_json, $cert_id);
    
    if ($upd->execute()) {
        sendResponse(['success' => true, 'name_history' => $history]);
    } else {
        sendResponse(['error' => 'Database error: ' . $upd->error], 500);
    }

} elseif ($action === 'clear_valuations') {
    $input = json_decode(file_get_contents('php://input'), true);
    $cert_id = $input['id'] ?? '';
    
    if (!$cert_id) sendResponse(['error' => 'ID required'], 400);
    
    // Clear AI grading data but KEEP metadata and acquisition details
    $stmt = $conn->prepare("UPDATE certificates SET 
        overall_grade = 0, 
        centering = 0, 
        corners = 0, 
        edges = 0, 
        surface = 0, 
        reasoning = '', 
        defects_json = '[]'
        WHERE id = ? AND user_id = ?");
    $stmt->bind_param("ss", $cert_id, $user_id);
    
    if ($stmt->execute()) {
        sendResponse(['success' => true]);
    } else {
        sendResponse(['error' => $stmt->error], 500);
    }

} elseif ($action === 'update_parent') {
    $cert_id = $input['id'] ?? '';
    $parent_id = $input['parent_id'] ?? null;
    
    if (!$cert_id) sendResponse(['error' => 'ID required'], 400);

    // If unlinking (parent_id is null)
    if ($parent_id === null) {
        $stmt = $conn->prepare("UPDATE certificates SET parent_id = NULL WHERE id = ? AND user_id = ?");
        $stmt->bind_param("ss", $cert_id, $user_id);
    } else {
        // Verify parent exists and fetch its acquisition data for carry-over
        $p_stmt = $conn->prepare("SELECT id, acq_price, acq_tax, acq_shipping, acq_date, acq_source, acq_city, acq_state FROM certificates WHERE id = ? AND user_id = ?");
        $p_stmt->bind_param("ss", $parent_id, $user_id);
        $p_stmt->execute();
        $res = $p_stmt->get_result();
        if ($res->num_rows === 0) {
            sendResponse(['error' => 'Parent certificate not found or unauthorized'], 404);
        }
        $parent = $res->fetch_assoc();

        // SURGICAL FIX: Carry over acquisition data if child lines are blank OR zero
        // We use COALESCE(NULLIF(col, ''), parent_val) for strings
        // We use COALESCE(NULLIF(col, 0), parent_val) for numbers to overwrite default 0.00
        $stmt = $conn->prepare("UPDATE certificates SET 
            parent_id = ?,
            acq_price = COALESCE(NULLIF(acq_price, 0), ?),
            acq_tax = COALESCE(NULLIF(acq_tax, 0), ?),
            acq_shipping = COALESCE(NULLIF(acq_shipping, 0), ?),
            acq_date = COALESCE(NULLIF(acq_date, ''), ?),
            acq_source = COALESCE(NULLIF(acq_source, ''), ?),
            acq_city = COALESCE(NULLIF(acq_city, ''), ?),
            acq_state = COALESCE(NULLIF(acq_state, ''), ?)
            WHERE id = ? AND user_id = ?");
            
        $stmt->bind_param("ssssssssss", 
            $parent_id, 
            $parent['acq_price'], 
            $parent['acq_tax'], 
            $parent['acq_shipping'], 
            $parent['acq_date'], 
            $parent['acq_source'], 
            $parent['acq_city'], 
            $parent['acq_state'],
            $cert_id, 
            $user_id
        );
    }
    
    if ($stmt->execute()) {
        sendResponse(['success' => true]);
    } else {
        sendResponse(['error' => $stmt->error], 500);
    }

} elseif ($action === 'admin_reset_links') {
    // SECURITY: Admin only
    $session_role = $_SESSION['user']['role'] ?? 'user';
    if ($session_role !== 'admin') {
        sendResponse(['error' => 'Unauthorized. Admin only.'], 403);
    }

    $cert_id = $input['id'] ?? '';
    $mode = $input['mode'] ?? 'selective'; // 'selective' or 'complete'
    
    if (!$cert_id) sendResponse(['error' => 'ID required'], 400);

    if ($mode === 'complete') {
        // "Dissolve" the entire stack containing this certificate
        // 1. Find the full lineage (everything that belongs to the same chain)
        // We'll use a slightly broader approach: clear all parents where the user_id matches
        // and they are connected to this cert_id in any way.
        // Since it's a linear chain, we find the Head and then clear all children.
        
        // Find the Head
        $current = $cert_id;
        $chain_ids = [$cert_id];
        
        // Walk UP to find head
        while (true) {
            $stmt = $conn->prepare("SELECT parent_id FROM certificates WHERE id = ?");
            $stmt->bind_param("s", $current);
            $stmt->execute();
            $res = $stmt->get_result()->fetch_assoc();
            if ($res && $res['parent_id']) {
                $current = $res['parent_id'];
                $chain_ids[] = $current;
            } else {
                break;
            }
        }
        $head_id = $current;

        // Walk DOWN from head (iteratively find all children)
        $to_process = [$head_id];
        $all_in_chain = [$head_id];
        while (!empty($to_process)) {
            $current_p = array_shift($to_process);
            $stmt = $conn->prepare("SELECT id FROM certificates WHERE parent_id = ?");
            $stmt->bind_param("s", $current_p);
            $stmt->execute();
            $res = $stmt->get_result();
            while ($row = $res->fetch_assoc()) {
                if (!in_array($row['id'], $all_in_chain)) {
                    $all_in_chain[] = $row['id'];
                    $to_process[] = $row['id'];
                }
            }
        }

        // Nuclear reset: Clear parent_id for everything in this chain
        $placeholders = implode(',', array_fill(0, count($all_in_chain), '?'));
        $stmt = $conn->prepare("UPDATE certificates SET parent_id = NULL WHERE id IN ($placeholders)");
        $stmt->bind_param(str_repeat('s', count($all_in_chain)), ...$all_in_chain);
    } else {
        // Selective break: Just clear this specific card's parent
        $stmt = $conn->prepare("UPDATE certificates SET parent_id = NULL WHERE id = ?");
        $stmt->bind_param("s", $cert_id);
    }

    if ($stmt->execute()) {
        sendResponse(['success' => true, 'affected_count' => count($all_in_chain ?? [1])]);
    } else {
        sendResponse(['error' => $stmt->error], 500);
    }

} elseif ($action === 'suggest_parents') {
    $cert_id = $_GET['id'] ?? '';
    if (!$cert_id) sendResponse(['error' => 'Certificate ID required'], 400);

    // Fetch target certificate info
    $stmt = $conn->prepare("SELECT name, card_set, year, front_hash FROM certificates WHERE id = ? AND user_id = ?");
    $stmt->bind_param("ss", $cert_id, $user_id);
    $stmt->execute();
    $cert = $stmt->get_result()->fetch_assoc();

    if (!$cert) sendResponse(['error' => 'Certificate not found'], 404);

    // Use shared logic for fingerprinting (now includes child_count and parent_id)
    $matches = findSimilarScans(
        $conn, 
        $cert['name'], 
        $cert['card_set'], 
        $cert['year'], 
        $cert['front_hash'], 
        $cert_id, // exclude self
        5,
        null, // No card number in this context
        $user_id // STRICT ISOLATION: Only suggest user's own cards
    );

    sendResponse($matches);

} elseif ($action === 'fetch_image') {
    $id = $_GET['id'] ?? '';
    if (!$id) sendResponse(['error' => 'ID required'], 400);

    // We use $user_id which was established at the top via session
    $stmt = $conn->prepare("SELECT front_img, back_img FROM certificates WHERE id = ? AND user_id = ?");
    $stmt->bind_param("ss", $id, $user_id);
    $stmt->execute();
    $res = $stmt->get_result();
    $imgs = $res->fetch_assoc();

    if (!$imgs) {
        sendResponse(['error' => 'Image not found or unauthorized'], 404);
    }

    sendResponse([
        'front' => $imgs['front_img'],
        'back' => $imgs['back_img']
    ]);

} elseif ($action === 'serve_image') {
    $id = $_GET['id'] ?? '';
    $type = $_GET['type'] ?? 'front';
    if (!$id) {
        header("HTTP/1.0 400 Bad Request");
        exit;
    }

    // Determine target column (fallback to HD if thumb requested but missing might be complex, let's keep it simple: grab both and coalesce in PHP)
    $stmt = $conn->prepare("SELECT front_thumb, front_img, back_thumb, back_img FROM certificates WHERE id = ? AND user_id = ?");
    $stmt->bind_param("ss", $id, $user_id);
    $stmt->execute();
    $res = $stmt->get_result();
    $imgs = $res->fetch_assoc();

    if (!$imgs) {
        header("HTTP/1.0 404 Not Found");
        exit;
    }

    $b64 = '';
    if ($type === 'front') {
        $b64 = !empty($imgs['front_thumb']) ? $imgs['front_thumb'] : $imgs['front_img'];
    } else {
        $b64 = !empty($imgs['back_thumb']) ? $imgs['back_thumb'] : $imgs['back_img'];
    }

    if (!$b64) {
        // Return a transparent 1x1 pixel or 404
        header("HTTP/1.0 404 Not Found");
        exit;
    }

    // Usually base64 starts with data:image/jpeg;base64,
    $parts = explode(',', $b64);
    if (count($parts) === 2) {
        $mime = str_replace('data:', '', explode(';', $parts[0])[0]);
        $data = base64_decode($parts[1]);
        
        header("Content-Type: $mime");
        // Thumbs can be updated by features like remove.bg; keep cache very short to reflect changes quickly.
        header("Cache-Control: public, max-age=60");
        echo $data;
    } else {
        header("HTTP/1.0 500 Internal Server Error");
    }
    exit;

} else {
    // List collection with filters - OPTIONAL NDJSON STREAMING
    $q = $_GET['q'] ?? '';
    $sort = $_GET['sort'] ?? 'date_scanned';
    $order = $_GET['order'] ?? 'DESC';
    $stream = isset($_GET['stream']) && $_GET['stream'] === '1';
    
    $allowed_sort = ['date_scanned', 'overall_grade', 'name', 'card_set'];
    if (!in_array($sort, $allowed_sort)) $sort = 'date_scanned';
    $order = ($order === 'ASC') ? 'ASC' : 'DESC';

    if ($stream) {
        // STREAMING HEADER
        header('Content-Type: application/x-ndjson');
        header('Cache-Control: no-cache');
        header('X-Accel-Buffering: no'); // Nginx
        // Attempt to disable compression
        if(function_exists('apache_setenv')){
            @apache_setenv('no-gzip', 1);
        }
        @ini_set('zlib.output_compression', 0);
        @ini_set('implicit_flush', 1);
        
        // Disable output buffering for real-time streaming
        while (ob_get_level()) ob_end_clean();
        
        // Prevent timeout for large collections
        set_time_limit(0);
    } else {
        header('Content-Type: application/json');
    }

    $merged_filter = HAS_MERGED_COL ? " AND (is_merged = 0 OR is_merged IS NULL)" : "";
    
    // BASE QUERY
    $query = "SELECT id, user_id, name, card_set, character_name, year, overall_grade, centering, corners, edges, surface, artist, date_scanned, user_notes, estimated_value, 
              parent_id, reasoning, defects_json, video_frames_json, predicted_grades,
              acq_price, acq_tax, acq_shipping, acq_date, acq_source, acq_city, acq_state,
              tracking_number, order_id, envelope_receipt_img, vault_copy,
              is_first_edition, is_holographic, rarity, name_updated_at, name_updated_by, name_history,
              market_price_unlocked, market_price_json,
              (SELECT COUNT(*) FROM certificates c2 WHERE c2.parent_id = certificates.id) as child_count";
    
    if (!$stream) {
        $query .= ", COALESCE(NULLIF(front_thumb, ''), front_img) as front_thumb, 
                    COALESCE(NULLIF(back_thumb, ''), back_img) as back_thumb, 
                    front_img, back_img";
    } else {
        // Just return a boolean indicating if an image exists 
        $query .= ", CASE WHEN (front_thumb IS NOT NULL AND front_thumb != '') OR (front_img IS NOT NULL AND front_img != '') THEN 1 ELSE 0 END as has_front_img, 
                     CASE WHEN (back_thumb IS NOT NULL AND back_thumb != '') OR (back_img IS NOT NULL AND back_img != '') THEN 1 ELSE 0 END as has_back_img";
    }
              
    $query .= " FROM certificates WHERE user_id = ?" . $merged_filter;
    
    // ARCHIVE FILTER
    $show_archived = isset($_GET['archived']) && $_GET['archived'] === '1';
    if ($show_archived) {
        $query .= " AND is_archived = 1";
    } else {
        $query .= " AND (is_archived = 0 OR is_archived IS NULL)";
    }
    
    $params = [$user_id];
    $types = "s";

    if ($q) {
        // If q matches the UUID format (roughly, 8 chars min), search ID directly first
        if (preg_match('/^[a-zA-Z0-9-]{8,}$/', $q)) {
             $query .= " AND (LOWER(id) LIKE LOWER(?) OR name LIKE ? OR card_set LIKE ? OR character_name LIKE ?)";
             $idSearch = "$q%"; // Prefix search for ID (case-insensitive)
             $search = "%$q%";
             $params[] = $idSearch; $params[] = $search; $params[] = $search; $params[] = $search;
             $types .= "ssss";
        } else {
            $query .= " AND (name LIKE ? OR card_set LIKE ? OR character_name LIKE ?)";
            $search = "%$q%";
            $params[] = $search; $params[] = $search; $params[] = $search;
            $types .= "sss";
        }
    }

    $query .= " ORDER BY $sort $order";
    
    $stmt = $conn->prepare($query);
    $stmt->bind_param($types, ...$params);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($stream) {
        // STREAM ROWS
        while ($row = $result->fetch_assoc()) {
            $json = json_encode($row);
            if ($json === false) {
                // Handle encoding error (e.g. malformed UTF-8) by skipping or logging
                // For now, continue to avoid breaking the stream syntax
                continue;
            }
            echo $json . "\n";
            flush();
        }
    } else {
        // STANDARD JSON RESPONSE
        $collection = [];
        while ($row = $result->fetch_assoc()) {
            $collection[] = $row;
        }
        sendResponse($collection);
    }
}
?>
