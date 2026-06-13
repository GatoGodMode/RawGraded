<?php
// settings.php - API Settings Management (Admin Only)
ob_start();

require_once('db.php');
require_once(__DIR__ . '/settings_util.php');

// --- MAIN LOGIC --- (CORS handled in db.php)

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

try {
    $action = $_GET['action'] ?? '';

    if ($action === 'get_settings') {
        requireAuth();
        $apiKey = readSetting($conn, 'gemini_api_key');
        sendResponse(['data' => ['gemini_api_key' => $apiKey]]);

    } else if ($action === 'get_remove_bg_key') {
        requireAdmin();
        $removeBgKey = readSetting($conn, 'REMOVEBG_API_KEY');
        sendResponse(['data' => ['removeBgApiKey' => $removeBgKey]]);
        
    } else if ($action === 'update_settings') {
        requireAdmin();
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $allowedKeys = ['gemini_api_key', 'stripe_publishable_key', 'stripe_secret_key', 'stripe_webhook_secret', 'cardhedger_api_key', 'psa_public_api_key', 'POKEPRICE_API_KEY', 'POKEWALLET_API_KEY', 'REMOVEBG_API_KEY'];
        
        $conn->begin_transaction();
        try {
            foreach ($input as $key => $value) {
                if (in_array($key, $allowedKeys)) {
                    $stmt = $conn->prepare("INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?");
                    $stmt->bind_param("sss", $key, $value, $value);
                    $stmt->execute();
                }
            }
            $conn->commit();
            sendResponse(['success' => true, 'message' => 'Settings updated successfully']);
        } catch (Exception $e) {
            $conn->rollback();
            sendResponse(['error' => 'Failed to update settings: ' . $e->getMessage()], 500);
        }
        
    } else {
        sendResponse(['error' => 'Invalid action'], 400);
    }

} catch (Exception $e) {
    sendResponse(['error' => 'Exception: ' . $e->getMessage()], 500);
} catch (Error $e) {
    sendResponse(['error' => 'Fatal: ' . $e->getMessage()], 500);
}
?>
