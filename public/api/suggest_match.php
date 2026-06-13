<?php
require_once('db.php');

requireAuth();

$input = json_decode(file_get_contents('php://input'), true);

if (!$input) {
    sendResponse(['error' => 'Invalid input'], 400);
}

$name = $input['metadata']['name'] ?? '';
$set = $input['metadata']['set'] ?? '';
$cardNumber = $input['metadata']['cardNumber'] ?? '';
$year = $input['metadata']['year'] ?? '';
$frontHash = $input['hashes']['front'] ?? '';
$backHash = $input['hashes']['back'] ?? '';

// Use shared logic
$matches = findSimilarScans($conn, $name, $set, $year, $frontHash, null, 5, $cardNumber);

sendResponse($matches);
?>
