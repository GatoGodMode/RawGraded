<?php
// ai.php - AI job queue (submit + poll). Admin priority; jobs never dropped.
ob_start();

require_once('db.php');
require_once(__DIR__ . '/membership.php');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

function fatal_handler() {
    $err = error_get_last();
    if ($err && ($err['type'] === E_ERROR || $err['type'] === E_PARSE || $err['type'] === E_CORE_ERROR)) {
        if (ob_get_length()) ob_clean();
        header('Content-Type: application/json');
        http_response_code(500);
        echo json_encode(['error' => 'Server Error']);
        exit;
    }
}
register_shutdown_function('fatal_handler');

try {
    $action = $_GET['action'] ?? '';
    $userId = null;
    $isAdmin = false;
    $priority = 1;
    $debugUser = null; // set after requireAuth() so catch can show detail to admin only

    // Worker secret: from DB (set by sync_db) so one run is enough; fallback to env
    $workerSecret = '';
    $stmtSecret = $conn->prepare("SELECT `value` FROM settings WHERE `key` = 'ai_worker_secret'");
    if ($stmtSecret && $stmtSecret->execute()) {
        $r = $stmtSecret->get_result()->fetch_assoc();
        if ($r && $r['value'] !== '') $workerSecret = $r['value'];
    }
    if ($workerSecret === '') $workerSecret = getenv('AI_WORKER_SECRET') ?: '';
    $reqSecret = $_GET['secret'] ?? $_SERVER['HTTP_X_WORKER_SECRET'] ?? '';
    $isWorker = ($workerSecret !== '' && $reqSecret === $workerSecret);

    // Localhost-only: return secret + Gemini key so worker needs zero config
    if ($action === 'worker_config') {
        $remote = $_SERVER['REMOTE_ADDR'] ?? '';
        $local = ($remote === '127.0.0.1' || $remote === '::1' || $remote === 'localhost');
        if (!$local) sendResponse(['error' => 'Forbidden'], 403);
        $stmtGemini = $conn->prepare("SELECT `value` FROM settings WHERE `key` = 'gemini_api_key'");
        $geminiKey = '';
        if ($stmtGemini && $stmtGemini->execute()) {
            $gr = $stmtGemini->get_result()->fetch_assoc();
            if ($gr && $gr['value'] !== '') $geminiKey = $gr['value'];
        }
        sendResponse(['ai_worker_secret' => $workerSecret, 'gemini_api_key' => $geminiKey]);
    }

    if ($action === 'worker_poll') {
        if (!$isWorker) sendResponse(['error' => 'Unauthorized'], 403);
        $stmt = $conn->query("SELECT id, payload, phase FROM ai_jobs WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1");
        $job = $stmt ? $stmt->fetch_assoc() : null;
        if (!$job) {
            sendResponse(['job_id' => null]);
        }
        $jid = (int) $job['id'];
        $conn->query("UPDATE ai_jobs SET status = 'processing' WHERE id = $jid AND status = 'pending'");
        if ($conn->affected_rows === 0) {
            sendResponse(['job_id' => null]);
        }
        $payloadDecoded = json_decode($job['payload'], true);
        sendResponse(['job_id' => $jid, 'phase' => $job['phase'] ?? null, 'payload' => is_array($payloadDecoded) ? $payloadDecoded : []]);
    }

    if ($action === 'worker_complete') {
        if (!$isWorker) sendResponse(['error' => 'Unauthorized'], 403);
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $jobId = (int) ($input['job_id'] ?? 0);
        $result = $input['result'] ?? null;
        $errorMsg = $input['error_msg'] ?? null;
        if ($jobId <= 0) sendResponse(['error' => 'Missing job_id'], 400);
        $status = ($errorMsg !== null && $errorMsg !== '') ? 'failed' : 'done';
        $stmt = $conn->prepare("UPDATE ai_jobs SET status = ?, result = ?, error_msg = ? WHERE id = ? AND status = 'processing'");
        $resultJson = $result !== null ? json_encode($result) : '';
        $errStr = $errorMsg !== null ? (string) $errorMsg : '';
        $stmt->bind_param('sssi', $status, $resultJson, $errStr, $jobId);
        $stmt->execute();
        sendResponse(['success' => true]);
    }

    // User endpoints: require auth + active trial or subscription
    $user = require_active_platform_membership($conn);
    $debugUser = $user;
    $userId = $user['id'];
    $isAdmin = (isset($user['role']) && $user['role'] === 'admin');
    if ($isAdmin) {
        $priority = 2;
    } else {
        // Paid bypass only for remaining purchased scans (same notion as save.php)
        $stmtU = $conn->prepare("SELECT scan_limit, bonus_scans, scans_this_week, scan_reset_date FROM users WHERE id = ?");
        $stmtU->bind_param('s', $userId);
        $stmtU->execute();
        $u = $stmtU->get_result()->fetch_assoc();
        $scanLimit = (int) ($u['scan_limit'] ?? 0);
        $bonusScans = (int) ($u['bonus_scans'] ?? 0);
        $scansThisWeek = (int) ($u['scans_this_week'] ?? 0);
        $resetDate = $u['scan_reset_date'] ?? null;
        if ($resetDate) {
            $now = new DateTime();
            $reset = new DateTime($resetDate);
            if ($now > $reset) {
                $newReset = (new DateTime())->modify('+7 days')->format('Y-m-d H:i:s');
                $stmtReset = $conn->prepare("UPDATE users SET scans_this_week = 0, scan_reset_date = ? WHERE id = ?");
                $stmtReset->bind_param('ss', $newReset, $userId);
                $stmtReset->execute();
                $scansThisWeek = 0;
            }
        }
        $remaining = $scanLimit + $bonusScans - $scansThisWeek;
        $stmtPaid = $conn->prepare("SELECT 1 FROM scan_transactions WHERE user_id = ? AND status = 'paid' LIMIT 1");
        $stmtPaid->bind_param('s', $userId);
        $stmtPaid->execute();
        $hasPaid = (bool) $stmtPaid->get_result()->fetch_assoc();
        $priority = ($hasPaid && $remaining > 0) ? 1 : 0;
    }

    // Submit job: enqueue for worker. Never drop.
    if ($action === 'submit') {
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $front = $input['front'] ?? '';
        $back = $input['back'] ?? '';
        $frames = $input['frames'] ?? [];
        $category = $input['category'] ?? 'Pokemon';
        $phase = $input['phase'] ?? 'full_analysis';
        if (!is_string($phase)) $phase = 'full_analysis';
        if (!in_array($phase, ['full_analysis', 'micro_relief'], true)) $phase = 'full_analysis';
        if ($front === '' || $back === '') {
            sendResponse(['error' => 'Missing front or back image'], 400);
        }
        // Optional: use a paid credit to bypass queue (requires paid_credits > 0)
        $usePaidCredit = isset($input['use_paid_credit']) && $input['use_paid_credit'] === true;
        if (!$isAdmin && $usePaidCredit) {
            $stmtPc = $conn->prepare("SELECT paid_credits FROM users WHERE id = ?");
            $stmtPc->bind_param('s', $userId);
            $stmtPc->execute();
            $pcRow = $stmtPc->get_result()->fetch_assoc();
            if ($pcRow && (int)($pcRow['paid_credits'] ?? 0) > 0) {
                $priority = 1;
            }
        }
        $payload = json_encode([
            'front' => $front,
            'back' => $back,
            'frames' => is_array($frames) ? $frames : [],
            'category' => $category,
            'size' => $input['size'] ?? null,
        ], JSON_UNESCAPED_SLASHES);
        if (strlen($payload) > 10 * 1024 * 1024) sendResponse(['error' => 'Payload too large'], 400);
        // Free users: only "hit" queue if a scan was active in last 30s (count before we insert)
        $recentCount = 0;
        if ($priority === 0) {
            $res = $conn->query("SELECT COUNT(*) AS c FROM ai_jobs WHERE created_at >= NOW() - INTERVAL 30 SECOND");
            if ($res) {
                $row = $res->fetch_assoc();
                $recentCount = (int) ($row['c'] ?? 0);
            }
        }
        $stmt = $conn->prepare("INSERT INTO ai_jobs (user_id, priority, status, phase, payload) VALUES (?, ?, 'pending', ?, ?)");
        $stmt->bind_param('siss', $userId, $priority, $phase, $payload);
        if (!$stmt->execute()) {
            $errMsg = $isAdmin ? ('Failed to enqueue job: ' . $conn->error) : 'Server Error';
            sendResponse(['error' => $errMsg], 500);
        }
        $jobId = (int) $conn->insert_id;
        $out = ['job_id' => $jobId];
        if ($priority === 0) {
            $out['must_wait'] = $recentCount > 0;
            $out['wait_seconds'] = 45;
            $out['upsell_message'] = 'Buy Pro Credits to Bypass Wait Time';
        }
        sendResponse($out);
    }

    // Poll job: return status and result when done. Only own jobs.
    if ($action === 'poll') {
        $jobId = isset($_GET['job_id']) ? (int) $_GET['job_id'] : 0;
        if ($jobId <= 0) sendResponse(['error' => 'Invalid job_id'], 400);
        $stmt = $conn->prepare("SELECT status, result, error_msg, phase FROM ai_jobs WHERE id = ? AND user_id = ?");
        $stmt->bind_param('is', $jobId, $userId);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        if (!$row) sendResponse(['error' => 'Job not found'], 404);
        $out = ['status' => $row['status']];
        if (isset($row['phase'])) $out['phase'] = $row['phase'];
        if ($row['status'] === 'done' && $row['result'] !== null && $row['result'] !== '') {
            $decoded = json_decode($row['result'], true);
            if (is_array($decoded)) $out['result'] = $decoded;
        }
        if ($row['status'] === 'failed' && $row['error_msg'] !== null) {
            $out['error_msg'] = $row['error_msg'];
        }
        sendResponse($out);
    }

    sendResponse(['error' => 'Invalid action'], 400);

} catch (Exception $e) {
    $msg = ($debugUser && ($debugUser['role'] ?? '') === 'admin') ? $e->getMessage() : 'Server Error';
    sendResponse(['error' => $msg], 500);
}
