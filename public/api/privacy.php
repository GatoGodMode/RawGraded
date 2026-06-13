<?php
require_once('db.php');

// SECURITY: Enforce session-based identity
$user = requireAuth();
$user_id = $user['id'];

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $_GET['action'] ?? ($input['action'] ?? 'get_privacy_mode');

if ($action === 'get_privacy_mode') {
    // Get user's global privacy mode
    try {
        $stmt = $conn->prepare("SELECT privacy_mode FROM users WHERE id = ?");
        $stmt->bind_param("s", $user_id);
        $stmt->execute();
        $result = $stmt->get_result()->fetch_assoc();
        sendResponse(['privacy_mode' => $result['privacy_mode'] ?? 'public']);
    } catch (Exception $e) {
        // Column doesn't exist yet (run sync_db.php) — default to public
        sendResponse(['privacy_mode' => 'public', 'needs_sync' => true]);
    }

} elseif ($action === 'set_privacy_mode') {
    // Set user's global privacy mode
    $mode = $input['privacy_mode'] ?? 'public';
    if (!in_array($mode, ['public', 'private'])) {
        sendResponse(['error' => 'Invalid privacy mode'], 400);
    }
    
    try {
        $stmt = $conn->prepare("UPDATE users SET privacy_mode = ? WHERE id = ?");
        $stmt->bind_param("ss", $mode, $user_id);
        
        if ($stmt->execute()) {
            try {
                if ($mode === 'private') {
                    $conn->query("UPDATE certificates SET is_hidden = 1 WHERE user_id = '$user_id'");
                } else {
                    $conn->query("UPDATE certificates SET is_hidden = 0 WHERE user_id = '$user_id'");
                }
            } catch (Exception $e) {
                // is_hidden column doesn't exist yet
            }
            sendResponse(['success' => true, 'privacy_mode' => $mode]);
        } else {
            sendResponse(['error' => $stmt->error], 500);
        }
    } catch (Exception $e) {
        sendResponse(['error' => 'Privacy columns not created. Run api/sync_db.php first.', 'details' => $e->getMessage()], 500);
    }

} elseif ($action === 'toggle_hide') {
    // Toggle hide status for a single certificate
    $cert_id = $input['id'] ?? '';
    if (!$cert_id) sendResponse(['error' => 'ID required'], 400);
    
    // Get current state
    $stmt = $conn->prepare("SELECT is_hidden FROM certificates WHERE id = ? AND user_id = ?");
    $stmt->bind_param("ss", $cert_id, $user_id);
    $stmt->execute();
    $res = $stmt->get_result()->fetch_assoc();
    
    if (!$res) sendResponse(['error' => 'Certificate not found'], 404);
    
    $new_state = $res['is_hidden'] ? 0 : 1;
    $stmt = $conn->prepare("UPDATE certificates SET is_hidden = ? WHERE id = ? AND user_id = ?");
    $stmt->bind_param("iss", $new_state, $cert_id, $user_id);
    
    if ($stmt->execute()) {
        sendResponse(['success' => true, 'is_hidden' => $new_state]);
    } else {
        sendResponse(['error' => $stmt->error], 500);
    }

} elseif ($action === 'bulk_hide') {
    // Bulk hide/show certificates
    $ids = $input['ids'] ?? [];
    $hide = $input['hide'] ?? 1; // 1 = hide, 0 = show
    
    if (!is_array($ids) || empty($ids)) sendResponse(['error' => 'IDs array required'], 400);
    
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $conn->prepare("UPDATE certificates SET is_hidden = ? WHERE id IN ($placeholders) AND user_id = ?");
    
    $types = 'i' . str_repeat('s', count($ids)) . 's';
    $params = array_merge([$hide], $ids, [$user_id]);
    $stmt->bind_param($types, ...$params);
    
    if ($stmt->execute()) {
        sendResponse(['success' => true, 'affected' => $stmt->affected_rows]);
    } else {
        sendResponse(['error' => $stmt->error], 500);
    }

} elseif ($action === 'admin_set_all_private') {
    // ADMIN ONLY: Set all users to private mode
    if (($user['role'] ?? 'user') !== 'admin') {
        sendResponse(['error' => 'Unauthorized. Admin only.'], 403);
    }
    
    try {
        $conn->query("UPDATE users SET privacy_mode = 'private'");
        $conn->query("UPDATE certificates SET is_hidden = 1");
        sendResponse(['success' => true, 'message' => 'All users set to private mode, all certificates hidden']);
    } catch (Exception $e) {
        sendResponse(['error' => $e->getMessage()], 500);
    }

} elseif ($action === 'admin_set_user_privacy') {
    // ADMIN ONLY: Set privacy mode for a specific user
    if (($user['role'] ?? 'user') !== 'admin') {
        sendResponse(['error' => 'Unauthorized. Admin only.'], 403);
    }
    
    $target_user_id = $input['user_id'] ?? '';
    $mode = $input['privacy_mode'] ?? 'public';
    
    if (!$target_user_id) sendResponse(['error' => 'user_id required'], 400);
    if (!in_array($mode, ['public', 'private'])) sendResponse(['error' => 'Invalid privacy mode'], 400);
    
    try {
        $stmt = $conn->prepare("UPDATE users SET privacy_mode = ? WHERE id = ?");
        $stmt->bind_param("ss", $mode, $target_user_id);
        $stmt->execute();
        
        // Update all certs for this user
        if ($mode === 'private') {
            $conn->query("UPDATE certificates SET is_hidden = 1 WHERE user_id = '$target_user_id'");
        } else {
            $conn->query("UPDATE certificates SET is_hidden = 0 WHERE user_id = '$target_user_id'");
        }
        
        sendResponse(['success' => true, 'user_id' => $target_user_id, 'privacy_mode' => $mode]);
    } catch (Exception $e) {
        sendResponse(['error' => $e->getMessage()], 500);
    }

} else {
    sendResponse(['error' => 'Invalid action'], 400);
}
?>
