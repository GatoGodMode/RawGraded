<?php
require_once __DIR__ . '/db.php';
requireAdmin();

if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

// api/sys_status.php
// Returns JSON with connectivity status (admin-only).

header('Content-Type: application/json');

$response = [
    'status' => 'ok',
    'timestamp' => date('c'),
    'checks' => [
        'local_db' => false,
        'remote_db' => false
    ],
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

// Determine overall status
if (!$response['checks']['local_db'] || !$response['checks']['remote_db']) {
    $response['status'] = 'error';
}

echo json_encode($response);
?>
