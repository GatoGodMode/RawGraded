<?php
// invoices.php - User purchase history and invoice download (Option B, censored)
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
        echo json_encode(['error' => 'Server Error']);
        exit;
    }
}
register_shutdown_function('fatal_handler');

/**
 * Censor name: first and last letter only (e.g. John Doe -> J***n D**e).
 * Maximum security for invoice/API output.
 */
function censorName($s) {
    if ($s === null || $s === '') return '';
    $s = trim((string) $s);
    $parts = preg_split('/\s+/', $s, -1, PREG_SPLIT_NO_EMPTY);
    $out = [];
    foreach ($parts as $p) {
        $len = strlen($p);
        if ($len <= 2) {
            $out[] = str_repeat('*', $len);
        } else {
            $out[] = $p[0] . str_repeat('*', $len - 2) . $p[$len - 1];
        }
    }
    return implode(' ', $out);
}

/**
 * Censor email: first and last letter of local part and of domain name (e.g. john@example.com -> j***n@e***e.com).
 */
function censorEmail($s) {
    if ($s === null || $s === '') return '';
    $s = trim((string) $s);
    $at = strpos($s, '@');
    if ($at === false) return str_repeat('*', min(strlen($s), 8));
    $local = substr($s, 0, $at);
    $domain = substr($s, $at + 1);
    $lenL = strlen($local);
    $localC = $lenL <= 2 ? str_repeat('*', $lenL) : $local[0] . str_repeat('*', $lenL - 2) . $local[$lenL - 1];
    $dot = strrpos($domain, '.');
    $domainLabel = $dot === false ? $domain : substr($domain, 0, $dot);
    $tld = $dot === false ? '' : substr($domain, $dot);
    $lenD = strlen($domainLabel);
    $domainC = $lenD <= 2 ? str_repeat('*', $lenD) : $domainLabel[0] . str_repeat('*', $lenD - 2) . $domainLabel[$lenD - 1];
    return $localC . '@' . $domainC . $tld;
}

/**
 * Card: only last 4 digits ever shown. If value is full number, mask to ****last4.
 */
function censorCard($last4Only) {
    if ($last4Only === null || $last4Only === '') return '';
    $s = preg_replace('/\D/', '', (string) $last4Only);
    if (strlen($s) > 4) return '****' . substr($s, -4);
    return strlen($s) === 4 ? '****' . $s : '';
}

try {
    $action = $_GET['action'] ?? '';
    $user = requireAuth();
    $userId = $user['id'];

    // List current user's paid transactions (for profile invoices section)
    if ($action === 'list') {
        $stmt = $conn->prepare("
            SELECT t.id, t.amount_paid, t.created_at, t.receipt_url,
                   p.name AS pack_name, p.credits, p.price
            FROM scan_transactions t
            JOIN scan_packs p ON t.pack_id = p.id
            WHERE t.user_id = ? AND t.status = 'paid'
            ORDER BY t.created_at DESC
        ");
        $stmt->bind_param('s', $userId);
        $stmt->execute();
        $res = $stmt->get_result();
        $list = [];
        while ($row = $res->fetch_assoc()) {
            $list[] = [
                'id' => (int) $row['id'],
                'amount_paid' => (float) $row['amount_paid'],
                'created_at' => $row['created_at'],
                'receipt_url' => (isset($row['receipt_url']) && $row['receipt_url'] !== '') ? $row['receipt_url'] : null,
                'pack_name' => $row['pack_name'],
                'credits' => (int) $row['credits'],
                'price' => (float) $row['price'],
            ];
        }
        sendResponse(['data' => $list]);
    }

    // Download invoice as HTML (Option B). Censored name/email; card only last 4 if ever present.
    if ($action === 'download') {
        $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
        if ($id <= 0) sendResponse(['error' => 'Invalid invoice id'], 400);

        $stmt = $conn->prepare("SELECT t.*, p.name AS pack_name, p.credits, p.price FROM scan_transactions t JOIN scan_packs p ON t.pack_id = p.id WHERE t.id = ? AND t.user_id = ? AND t.status = 'paid'");
        $stmt->bind_param('is', $id, $userId);
        $stmt->execute();
        $trans = $stmt->get_result()->fetch_assoc();
        if (!$trans) sendResponse(['error' => 'Invoice not found'], 404);

        $ustmt = $conn->prepare("SELECT username, email FROM users WHERE id = ?");
        $ustmt->bind_param('s', $userId);
        $ustmt->execute();
        $u = $ustmt->get_result()->fetch_assoc();
        $displayName = censorName($u !== null ? ($u['username'] ?? '') : '');
        $displayEmail = censorEmail($u !== null ? ($u['email'] ?? '') : '');

        $date = date('F j, Y', strtotime($trans['created_at']));
        $packName = htmlspecialchars($trans['pack_name']);
        $amount = number_format((float) $trans['amount_paid'], 2);
        $credits = (int) $trans['credits'];

        $html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice #' . (int)$trans['id'] . '</title></head><body style="font-family:sans-serif;max-width:560px;margin:2em auto;padding:1em;">';
        $html .= '<h1 style="border-bottom:2px solid #333;">Invoice #' . (int)$trans['id'] . '</h1>';
        $html .= '<p><strong>Date:</strong> ' . htmlspecialchars($date) . '</p>';
        $html .= '<p><strong>Customer:</strong> ' . htmlspecialchars($displayName) . '</p>';
        $html .= '<p><strong>Email:</strong> ' . htmlspecialchars($displayEmail) . '</p>';
        $html .= '<table style="width:100%;border-collapse:collapse;margin:1em 0;">';
        $html .= '<tr style="background:#eee;"><th style="text-align:left;padding:8px;">Item</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Amount</th></tr>';
        $html .= '<tr><td style="padding:8px;">' . $packName . ' (' . $credits . ' credits)</td><td style="text-align:right;">1</td><td style="text-align:right;">$' . $amount . '</td><td style="text-align:right;">$' . $amount . '</td></tr>';
        $html .= '</table>';
        $html .= '<p style="margin-top:1.5em;"><strong>Total paid:</strong> $' . $amount . '</p>';
        $html .= '<p style="margin-top:2em;font-size:0.9em;color:#666;">RawGraded — Credit purchase. Card details never stored; only last 4 digits permitted if shown.</p>';
        $html .= '</body></html>';

        if (ob_get_length()) ob_clean();
        header('Content-Type: text/html; charset=UTF-8');
        header('Content-Disposition: attachment; filename="invoice-' . (int)$trans['id'] . '.html"');
        echo $html;
        exit;
    }

    sendResponse(['error' => 'Invalid action'], 400);

} catch (Exception $e) {
    $msg = (($user['role'] ?? '') === 'admin') ? $e->getMessage() : 'Server Error';
    sendResponse(['error' => $msg], 500);
}
