<?php
// settings.php - API Settings Management (Admin Only)
ob_start();

require_once('db.php');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

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
    // Admin check moved to specific actions
    $action = $_GET['action'] ?? '';

    // Allow ANYONE to get settings (needed for Client-Side AI)
    // Security Note: Since Gemini runs client-side, the key must be exposed to the browser.
    // In a future update, we should move AI calls to the backend to hide the key.
    if ($action === 'get_settings') {
        // Fetch API key from settings table
        $stmt = $conn->prepare("SELECT `value` FROM settings WHERE `key` = 'gemini_api_key'");
        if (!$stmt) {
            sendResponse(['error' => 'Database error: ' . $conn->error], 500);
        }
        
        $stmt->execute();
        $result = $stmt->get_result();
        $row = $result->fetch_assoc();
        
        $apiKey = $row ? $row['value'] : '';
        sendResponse(['data' => ['gemini_api_key' => $apiKey]]);

    } else if ($action === 'get_remove_bg_key') {
        // Read-only: used by Admin Dashboard to display current remove.bg API key.
        $removeBgKey = '';
        try {
            $hasKey = $conn->query("SHOW COLUMNS FROM `settings` LIKE 'key'")->num_rows > 0;
            $hasValue = $conn->query("SHOW COLUMNS FROM `settings` LIKE 'value'")->num_rows > 0;
            if ($hasKey && $hasValue) {
                $stmt = $conn->prepare("SELECT `value` FROM settings WHERE `key` = ? LIMIT 1");
                if ($stmt) {
                    $k = 'REMOVEBG_API_KEY';
                    $stmt->bind_param("s", $k);
                    $stmt->execute();
                    $row = $stmt->get_result()->fetch_assoc();
                    if ($row && !empty($row['value'])) $removeBgKey = $row['value'];
                }
            } else {
                // legacy schema support
                $hasSettingKey = $conn->query("SHOW COLUMNS FROM `settings` LIKE 'setting_key'")->num_rows > 0;
                $hasSettingValue = $conn->query("SHOW COLUMNS FROM `settings` LIKE 'setting_value'")->num_rows > 0;
                if ($hasSettingKey && $hasSettingValue) {
                    $stmt2 = $conn->prepare("SELECT `setting_value` FROM settings WHERE `setting_key` = ? LIMIT 1");
                    if ($stmt2) {
                        $k2 = 'REMOVEBG_API_KEY';
                        $stmt2->bind_param("s", $k2);
                        $stmt2->execute();
                        $row2 = $stmt2->get_result()->fetch_assoc();
                        if ($row2 && !empty($row2['setting_value'])) $removeBgKey = $row2['setting_value'];
                    }
                }
            }
        } catch (Throwable $e) {
            // Non-fatal: return empty key
        }

        sendResponse(['data' => ['removeBgApiKey' => $removeBgKey]]);
        
    } else if ($action === 'update_settings') {
        // Verify admin access for UPDATES only
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized - Admin access required'], 403);
        }

        // Update API keys
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $allowedKeys = ['gemini_api_key', 'stripe_publishable_key', 'stripe_secret_key', 'stripe_webhook_secret', 'cardhedger_api_key'];
        
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
