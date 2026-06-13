<?php
/**
 * Public reference repository — schema migration endpoints are out of band.
 *
 * Database evolution runs through controlled release channels, not this publication.
 */
header('Content-Type: application/json');
http_response_code(403);
echo json_encode([
    'status' => 'unavailable',
    'message' => 'Schema migration endpoints are not published in this repository.',
]);
exit;
