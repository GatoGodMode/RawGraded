<?php
// drafts.php - Save/load analysis-screen draft (paid or admin only)
set_time_limit(60);
require_once('db.php');
require_once(__DIR__ . '/membership.php');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

try {
    $user = require_active_platform_membership($conn);
    $userId = $user['id'];
    $isAdmin = (isset($user['role']) && $user['role'] === 'admin');

    $action = $_GET['action'] ?? '';
    if ($action !== 'save' && $action !== 'get' && $action !== 'delete') {
        sendResponse(['error' => 'Invalid action'], 400);
    }

    // Delete (discard) draft
    if ($action === 'delete') {
        $stmt = $conn->prepare("DELETE FROM scan_drafts WHERE user_id = ?");
        $stmt->bind_param('s', $userId);
        $stmt->execute();
        sendResponse(['success' => true]);
    }

    // Save draft: only when this is a pro run (1 locked-in credit) or admin. No extra credit taken here; no free draft saves.
    if ($action === 'save') {
        $raw = file_get_contents('php://input');
        $payload = $raw !== false ? $raw : '';
        if (strlen($payload) > 5 * 1024 * 1024) {
            sendResponse(['error' => 'Draft too large'], 400);
        }
        $decoded = json_decode($payload, true);
        if (strlen(trim($payload)) > 0 && $decoded === null && json_last_error() !== JSON_ERROR_NONE) {
            sendResponse(['error' => 'Invalid JSON'], 400);
        }
        $isProDraft = is_array($decoded) && isset($decoded['_draftMeta']['credit_type']) && $decoded['_draftMeta']['credit_type'] === 'paid';
        if (!$isAdmin && !$isProDraft) {
            sendResponse(['error' => 'Pro run required to save draft'], 403);
        }
        $stmt = $conn->prepare("INSERT INTO scan_drafts (user_id, payload) VALUES (?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP");
        $stmt->bind_param('ss', $userId, $payload);
        if (!$stmt->execute()) {
            sendResponse(['error' => 'Failed to save draft'], 500);
        }
        $out = ['success' => true];
        if (!$isAdmin) {
            $cr = $conn->prepare("SELECT paid_credits FROM users WHERE id = ?");
            $cr->bind_param('s', $userId);
            $cr->execute();
            $r = $cr->get_result()->fetch_assoc();
            if ($r !== null) {
                $out['paid_credits'] = (int)($r['paid_credits'] ?? 0);
            }
        }
        sendResponse($out);
    }

    // Get draft
    if ($action === 'get') {
        $stmt = $conn->prepare("SELECT payload FROM scan_drafts WHERE user_id = ?");
        $stmt->bind_param('s', $userId);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        if (!$row || $row['payload'] === '' || $row['payload'] === null) {
            sendResponse(['draft' => null]);
        }
        sendResponse(['draft' => $row['payload']]);
    }
} catch (Throwable $e) {
    sendResponse(['error' => 'Server Error'], 500);
}
