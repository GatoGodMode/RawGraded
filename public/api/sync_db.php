<?php
/**
 * Redacted — schema migration/sync is not published in this showcase repository.
 *
 * Production operators run database migrations from private release artifacts,
 * not from this public source tree.
 */
header('Content-Type: application/json');
http_response_code(403);
echo json_encode([
    'status' => 'redacted',
    'message' => 'Database schema sync removed from public showcase.',
]);
exit;
