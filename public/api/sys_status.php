<?php
require_once __DIR__ . '/db.php';
requireAdmin();

if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

// api/sys_status.php
// Returns JSON with connectivity status and recent log entries

header('Content-Type: application/json');

$response = [
    'status' => 'ok',
    'timestamp' => date('c'),
    'checks' => [
        'local_db' => false,
        'remote_db' => false
    ],
    'logs' => []
];

// 1. Check Local DB (Grader)
if ($conn && !$conn->connect_error) {
    $response['checks']['local_db'] = true;
}

try {
    [$pokeConn, $mpError] = openMarketplaceConnection();
    if ($pokeConn) {
        $response['checks']['remote_db'] = true;
        $pokeConn->close();
    } else {
        $response['checks']['remote_db_error'] = $mpError;
    }
} catch (Exception $e) {
    $response['checks']['remote_db_error'] = $e->getMessage();
}

// 3. Read Logs
$logFile = __DIR__ . '/../../sync_error.log'; // Stored one level above public or in root
if (file_exists($logFile)) {
    // Read last 50 lines
    $lines = file($logFile);
    if ($lines !== false) {
        $response['logs'] = array_slice($lines, -50);
    }
}

// Determine overall status
if (!$response['checks']['local_db'] || !$response['checks']['remote_db']) {
    $response['status'] = 'error';
}

echo json_encode($response);
?>
