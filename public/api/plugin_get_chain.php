<?php
// public/api/plugin_get_chain.php
ob_start();
require_once(__DIR__ . '/db.php');

$logFile = __DIR__ . '/debug_merge.log';
if (!function_exists('debugLog')) {
    function debugLog($msg) {
        global $logFile;
        @file_put_contents($logFile, "[" . date('Y-m-d H:i:s') . "] [CHAIN] " . $msg . "\n", FILE_APPEND);
    }
}

header('Content-Type: application/json');

// 1. Auth Check - Ensure user is logged in
$user = requireAuth();
$userId = $user['id'];
$isAdmin = ($user['role'] ?? 'user') === 'admin';

// 2. Input Validation
$id = $_GET['id'] ?? null;
if (!$id) {
    sendResponse(['error' => 'Missing certificate ID'], 400);
}

debugLog("Chain Fetch Requested for ID: $id (User: $userId, Admin: $isAdmin)");

// 3. Chain Traversal Logic
$chain = [];
$currentId = $id;
$visitedIds = []; // Prevent infinite loops

while ($currentId && !in_array($currentId, $visitedIds)) {
    $visitedIds[] = $currentId;
    
    // We fetch details for each cert in the chain
    // Admins can see any cert, users only their own
    $stmt = $conn->prepare("SELECT id, parent_id, name, overall_grade, reasoning, front_img, back_img, defects_json, date_scanned, 
                                  user_notes, estimated_value, acq_price, acq_tax, acq_shipping, acq_date, acq_source, acq_city, acq_state 
                           FROM certificates WHERE id = ? AND (user_id = ? OR ? = 1)");
    $valAdmin = $isAdmin ? 1 : 0;
    $stmt->bind_param("ssi", $currentId, $userId, $valAdmin);
    
    if (!$stmt->execute()) {
        debugLog("DB Execute Error: " . $conn->error);
        break;
    }
    
    $res = $stmt->get_result();
    if ($res === false) {
        debugLog("DB Get Result Error: " . $conn->error);
        break;
    }
    $cert = $res->fetch_assoc();
    
    if (!$cert) {
        debugLog("Cert not found or access denied: $currentId");
        break;
    }
    
    $chain[] = $cert;
    $currentId = $cert['parent_id'];
}

if (empty($chain)) {
    sendResponse(['error' => 'No chain found or access denied.'], 404);
}

debugLog("Returning chain of " . count($chain) . " certificates.");

// 4. Return Data
// Note: Frontend usually expects Newest -> Oldest, which this is (traversing parent_id up).
sendResponse(['success' => true, 'chain' => $chain]);
?>
