<?php
require_once('db.php');

// Prevent caching
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');
header('Content-Type: application/json');

// 1. AUTHENTICATION (Admin Only)
$user = requireAuth();
if (($user['role'] ?? 'user') !== 'admin') {
    sendResponse(['error' => 'Unauthorized Access'], 403);
}

// 2. CHECK FILE UPLOAD
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendResponse(['error' => 'Method Not Allowed'], 405);
}

if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    sendResponse(['error' => 'No file uploaded or upload error occurred.'], 400);
}

$file = $_FILES['file'];

// 3. SECURITY VALIDATION
// Allowed MIME types
$allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
$finfo = new finfo(FILEINFO_MIME_TYPE);
$mimeType = $finfo->file($file['tmp_name']);

if (!in_array($mimeType, $allowedTypes)) {
    sendResponse(['error' => 'Invalid file type. Only JPG, PNG, GIF, and WEBP are allowed.'], 400);
}

// Max size: 2MB
if ($file['size'] > 2 * 1024 * 1024) {
    sendResponse(['error' => 'File too large. Maximum size is 2MB.'], 400);
}

// 4. STORAGE
$targetDir = '../assets/badges/';
if (!is_dir($targetDir)) {
    if (!mkdir($targetDir, 0755, true)) {
        sendResponse(['error' => 'Failed to create upload directory.'], 500);
    }
}

// Generate unique safe filename
$extension = pathinfo($file['name'], PATHINFO_EXTENSION);
$filename = 'badge_' . uniqid() . '.' . $extension;
$targetPath = $targetDir . $filename;

if (move_uploaded_file($file['tmp_name'], $targetPath)) {
    // Return the public URL
    // Assuming relative path from API is correct for frontend usage
    // public/api/../assets/badges/ -> public/assets/badges/
    // The frontend should construct the full URL or use the relative path
    // Let's return the absolute-like path that the frontend expects
    $publicUrl = '/assets/badges/' . $filename;
    sendResponse(['success' => true, 'url' => $publicUrl]);
} else {
    sendResponse(['error' => 'Failed to save file.'], 500);
}
?>
