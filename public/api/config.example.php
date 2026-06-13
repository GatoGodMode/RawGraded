<?php
/**
 * Redacted — production config.php is not published in this showcase repository.
 *
 * Deployed environments load operator credentials from a private config.php
 * (MySQL, OAuth client ID, app URL, TOTP secret). That file is gitignored and
 * maintained outside public git history.
 */
header('Content-Type: application/json');
http_response_code(403);
echo json_encode([
    'status' => 'redacted',
    'message' => 'Configuration template removed from public showcase.',
]);
exit;
