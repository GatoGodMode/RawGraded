<?php
/**
 * Public reference repository — operator configuration is out of band.
 *
 * Production deployments load credentials from a private config.php maintained
 * outside this publication boundary (MySQL, OAuth, application URL, signing material).
 */
header('Content-Type: application/json');
http_response_code(403);
echo json_encode([
    'status' => 'unavailable',
    'message' => 'Operator configuration is not published in this repository.',
]);
exit;
