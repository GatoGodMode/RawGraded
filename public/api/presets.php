<?php
require_once('db.php');

// Prevent caching
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');
header('Content-Type: application/json');

// Ensure user is logged in
$user = requireAuth();
$userId = $user['id'];

// CRUD Operations
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Fetch all presets for this user
    $stmt = $conn->prepare("SELECT * FROM acquisition_presets WHERE user_id = ? ORDER BY created_at DESC");
    $stmt->bind_param("s", $userId);
    $stmt->execute();
    $result = $stmt->get_result();
    $presets = $result->fetch_all(MYSQLI_ASSOC);
    echo json_encode(['presets' => $presets]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid input']);
        exit;
    }
    $name = $input['name'] ?? 'Untitled Preset';
    $packType = $input['pack_type'] ?? '';
    $packAmount = intval($input['pack_amount'] ?? 0);
    $packCost = floatval($input['pack_cost'] ?? 0.00);
    $tax = floatval($input['tax'] ?? 0.00);
    $shipping = floatval($input['shipping'] ?? 0.00);
    $source = $input['source'] ?? '';
    
    // Save to user_id (always use user_id for personal presets)
    $stmt = $conn->prepare("INSERT INTO acquisition_presets (user_id, name, pack_type, pack_amount, pack_cost, tax, shipping, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->bind_param("sssiddds", $userId, $name, $packType, $packAmount, $packCost, $tax, $shipping, $source);
    
    if ($stmt->execute()) {
        echo json_encode(['status' => 'success', 'id' => $conn->insert_id]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to save preset: ' . $conn->error]);
    }
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $id = intval($_GET['id'] ?? 0);
    
    if (!$id) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing ID']);
        exit;
    }
    
    // Ensure ownership
    $stmt = $conn->prepare("DELETE FROM acquisition_presets WHERE id = ? AND user_id = ?");
    $stmt->bind_param("is", $id, $userId);
    
    if ($stmt->execute()) {
        if ($stmt->affected_rows > 0) {
             echo json_encode(['status' => 'success']);
        } else {
             http_response_code(404);
             echo json_encode(['error' => 'Preset not found or ownership mismatch']);
        }
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to delete preset']);
    }
    exit;
}
?>
