<?php
require_once('db.php');

$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput ?: '{}', true) ?? [];
if (!isset($input['use_free_credit'])) {
    sendResponse(['error' => 'use_free_credit required (true = RawGraded / 1 free credit, false = custom branding / 1 pro credit)'], 400);
}

$user = requireAuth();
$userId = $user['id'];

$useFreeCredit = filter_var($input['use_free_credit'], FILTER_VALIDATE_BOOLEAN);

$stmt = $conn->prepare("SELECT role, scan_limit, bonus_scans, paid_credits, scans_this_week, scan_reset_date FROM users WHERE id = ?");
$stmt->bind_param("s", $userId);
$stmt->execute();
$u = $stmt->get_result()->fetch_assoc();
if (!$u) {
    sendResponse(['error' => 'User not found'], 404);
}

if ($u['role'] === 'admin') {
    $cr = $conn->prepare("SELECT scan_limit, paid_credits, scans_this_week FROM users WHERE id = ?");
    $cr->bind_param("s", $userId);
    $cr->execute();
    $row = $cr->get_result()->fetch_assoc();
    sendResponse([
        'success' => true,
        'credits_remaining' => [
            'free' => max(0, (int)($row['scan_limit'] ?? 0) - (int)($row['scans_this_week'] ?? 0)),
            'paid' => max(0, (int)($row['paid_credits'] ?? 0)),
            'scan_limit' => (int)($row['scan_limit'] ?? 0),
            'scans_this_week' => (int)($row['scans_this_week'] ?? 0)
        ]
    ]);
}

$now = new DateTime();
$reset = new DateTime($u['scan_reset_date'] ?? 'now');
if ($now > $reset) {
    $newReset = (new DateTime())->modify('+7 days')->format('Y-m-d H:i:s');
    $stmt = $conn->prepare("UPDATE users SET scans_this_week = 0, scan_reset_date = ? WHERE id = ?");
    $stmt->bind_param("ss", $newReset, $userId);
    $stmt->execute();
    $u['scans_this_week'] = 0;
}

$scanLimit = (int)($u['scan_limit'] ?? 0);
$paidCredits = (int)($u['paid_credits'] ?? 0);
$scansThisWeek = (int)($u['scans_this_week'] ?? 0);
$freeRemaining = max(0, $scanLimit - $scansThisWeek);
$paidRemaining = max(0, $paidCredits);

if ($freeRemaining <= 0 && $paidRemaining <= 0) {
    sendResponse(['error' => 'No credits remaining. Free weekly scans and paid credits are exhausted.'], 403);
}

if ($useFreeCredit) {
    if ($freeRemaining <= 0) {
        sendResponse(['error' => 'No free credits left this week.'], 403);
    }
    $stmt = $conn->prepare("UPDATE users SET scans_this_week = scans_this_week + 1 WHERE id = ? AND scans_this_week < ?");
    $stmt->bind_param("si", $userId, $scanLimit);
    $stmt->execute();
    if ($conn->affected_rows === 0) {
        sendResponse(['error' => 'Free credit could not be applied.'], 403);
    }
} else {
    if ($paidRemaining > 0) {
        $stmt = $conn->prepare("UPDATE users SET paid_credits = paid_credits - 1 WHERE id = ? AND paid_credits > 0");
        $stmt->bind_param("s", $userId);
        $stmt->execute();
        if ($conn->affected_rows === 0) {
            sendResponse(['error' => 'Paid credit could not be applied.'], 403);
        }
    } else {
        if ($freeRemaining <= 0) {
            sendResponse(['error' => 'No credits remaining.'], 403);
        }
        $stmt = $conn->prepare("UPDATE users SET scans_this_week = scans_this_week + 1 WHERE id = ? AND scans_this_week < ?");
        $stmt->bind_param("si", $userId, $scanLimit);
        $stmt->execute();
        if ($conn->affected_rows === 0) {
            sendResponse(['error' => 'Free credit could not be applied.'], 403);
        }
    }
}

$cr = $conn->prepare("SELECT scan_limit, paid_credits, scans_this_week FROM users WHERE id = ?");
$cr->bind_param("s", $userId);
$cr->execute();
$crRow = $cr->get_result()->fetch_assoc();
$creditsRemaining = [
    'free' => max(0, (int)($crRow['scan_limit'] ?? 0) - (int)($crRow['scans_this_week'] ?? 0)),
    'paid' => max(0, (int)($crRow['paid_credits'] ?? 0)),
    'scan_limit' => (int)($crRow['scan_limit'] ?? 0),
    'scans_this_week' => (int)($crRow['scans_this_week'] ?? 0)
];

sendResponse(['success' => true, 'credits_remaining' => $creditsRemaining]);
