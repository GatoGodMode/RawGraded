<?php
ob_start();
require_once('db.php');
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

function fatal_handler() {
    $err = error_get_last();
    if ($err && ($err['type'] === E_ERROR || $err['type'] === E_PARSE || $err['type'] === E_CORE_ERROR)) {
        if (ob_get_length()) ob_clean();
        header('Content-Type: application/json');
        http_response_code(500);
        echo json_encode(['error' => 'Server Error: ' . $err['message']]);
        exit;
    }
}
register_shutdown_function('fatal_handler');

/**
 * Hybrid: default auto_cleared; route to manual review for edge cases.
 */
function applications_evaluate_status(array $answers) {
    $usage = isset($answers['usage_intent']) ? (string)$answers['usage_intent'] : '';
    if (strlen($usage) > 800) {
        return 'pending_review';
    }
    if (preg_match('#https?://#i', $usage)) {
        return 'pending_review';
    }
    $biz = isset($answers['business_or_individual']) ? strtolower((string)$answers['business_or_individual']) : '';
    if ($biz === 'business') {
        return 'pending_review';
    }
    return 'auto_cleared';
}

try {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $action = $_GET['action'] ?? '';

    if ($action === 'submit_application') {
        $email = trim($input['email'] ?? '');
        $answers = $input['answers'] ?? null;
        if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            sendResponse(['error' => 'Valid email is required'], 400);
        }
        if (!is_array($answers) || count($answers) < 1) {
            sendResponse(['error' => 'Questionnaire answers are required'], 400);
        }

        $tbl = $conn->query("SHOW TABLES LIKE 'membership_applications'");
        if (!$tbl || $tbl->num_rows === 0) {
            sendResponse(['error' => 'Applications not configured. Run sync_db.'], 503);
        }

        $status = applications_evaluate_status($answers);
        $token = bin2hex(random_bytes(32));
        $json = json_encode($answers, JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            sendResponse(['error' => 'Invalid questionnaire data'], 400);
        }

        $stmt = $conn->prepare("INSERT INTO membership_applications (email, answers, status, application_token) VALUES (?, ?, ?, ?)");
        $stmt->bind_param("ssss", $email, $json, $status, $token);
        if (!$stmt->execute()) {
            sendResponse(['error' => 'Could not save application'], 500);
        }
        $id = $stmt->insert_id;

        sendResponse([
            'data' => [
                'application_id' => (int)$id,
                'application_token' => $token,
                'status' => $status,
                'can_register' => ($status === 'auto_cleared' || $status === 'approved'),
            ],
        ]);
    }

    else if ($action === 'validate_token') {
        $token = trim($input['application_token'] ?? $_GET['token'] ?? '');
        if (strlen($token) !== 64) {
            sendResponse(['error' => 'Invalid token'], 400);
        }
        $stmt = $conn->prepare("SELECT id, email, status, linked_user_id FROM membership_applications WHERE application_token = ? LIMIT 1");
        $stmt->bind_param("s", $token);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        if (!$row) {
            sendResponse(['error' => 'Application not found'], 404);
        }
        $ok = in_array($row['status'], ['auto_cleared', 'approved'], true) && empty($row['linked_user_id']);
        sendResponse([
            'data' => [
                'application_id' => (int)$row['id'],
                'email' => $row['email'],
                'status' => $row['status'],
                'can_register' => $ok,
            ],
        ]);
    }

    else if ($action === 'admin_list_pending') {
        requireAdmin();
        $stmt = $conn->query("SELECT id, email, status, created_at, resolved_at, linked_user_id FROM membership_applications WHERE status = 'pending_review' ORDER BY created_at ASC LIMIT 200");
        $rows = [];
        while ($stmt && ($r = $stmt->fetch_assoc())) {
            $rows[] = $r;
        }
        sendResponse(['data' => $rows]);
    }

    else if ($action === 'admin_resolve') {
        requireAdmin();
        $id = (int)($input['id'] ?? 0);
        $decision = $input['decision'] ?? '';
        $notes = trim($input['review_notes'] ?? '');
        if (!$id || !in_array($decision, ['approved', 'rejected'], true)) {
            sendResponse(['error' => 'Invalid request'], 400);
        }
        $adminId = (int)($_SESSION['user']['id'] ?? 0);
        $newStatus = $decision === 'approved' ? 'approved' : 'rejected';
        $stmt = $conn->prepare("UPDATE membership_applications SET status = ?, review_notes = ?, resolved_at = NOW(), reviewed_by = ? WHERE id = ? AND status = 'pending_review'");
        $stmt->bind_param("ssii", $newStatus, $notes, $adminId, $id);
        if (!$stmt->execute() || $stmt->affected_rows === 0) {
            sendResponse(['error' => 'Update failed or not pending'], 400);
        }
        sendResponse(['success' => true]);
    }

    else {
        sendResponse(['error' => 'Invalid action'], 400);
    }
} catch (Exception $e) {
    sendResponse(['error' => 'Exception: ' . $e->getMessage()], 500);
}
