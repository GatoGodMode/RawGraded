<?php
require_once('db.php');

// Simple CORS for development
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed_origins = [
    'https://rawgraded.com',
    'https://www.rawgraded.com',
    'http://localhost:5173',
    'http://localhost:3000'
];

if (in_array($origin, $allowed_origins)) {
    header("Access-Control-Allow-Origin: $origin");
} else {
    header("Access-Control-Allow-Origin: https://rawgraded.com");
}

header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-User-ID");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Credentials: true");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

// SECURITY: Enforce session-based identity
$user = requireAuth();
$user_id = $user['id'];

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) sendResponse(['error' => 'Invalid input'], 400);
$cert_id = $input['id'] ?? '';
$archive = isset($input['archive']) ? (int)$input['archive'] : 1; // 1 to archive, 0 to restore

if (!$cert_id) {
    sendResponse(['error' => 'Certificate ID is required'], 400);
}

// SURGICAL UPDATE: Toggle is_archived state for the owner
$stmt = $conn->prepare("UPDATE certificates SET is_archived = ? WHERE id = ? AND user_id = ?");
$stmt->bind_param("isi", $archive, $cert_id, $user_id);

if ($stmt->execute()) {
    if ($stmt->affected_rows > 0) {
        sendResponse([
            'success' => true, 
            'message' => $archive ? 'Certificate archived successfully' : 'Certificate restored successfully',
            'is_archived' => $archive
        ]);
    } else {
        sendResponse(['error' => 'Certificate not found or unauthorized'], 404);
    }
} else {
    sendResponse(['error' => 'Database error: ' . $conn->error], 500);
}
?>
