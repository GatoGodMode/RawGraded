<?php
// plugin_appraise_list.php

function log_sync_error($message) {
    $logFile = __DIR__ . '/../../sync_error.log';
    $timestamp = date('[Y-m-d H:i:s] ');
    file_put_contents($logFile, $timestamp . $message . PHP_EOL, FILE_APPEND);
}

require_once('db.php');

// CORS Headers (Already handled in db.php but good to be explicit for new endpoints)
// db.php handles the OPTION check and initial headers

$input = json_decode(file_get_contents('php://input'), true);

if (!$input) {
    sendResponse(['error' => 'Invalid input'], 400);
}

// 1. Validate Input
$certId = $input['certificate_id'] ?? null;

// SECURITY: Enforce session auth
$user = requireAuth();
$userId = $user['id']; 

$priceUsd = $input['price_usd'] ?? null;
$valuationData = $input['valuation_data'] ?? [];
$certificateImage = $input['certificate_image'] ?? null; // Base64 encoded certificate image

if (!$certId || !$priceUsd) {
    sendResponse(['error' => 'Missing required fields: certificate_id, price_usd'], 400);
}

// 2. Verify Certificate Exists (local grader DB via db.php)
$stmt = $conn->prepare("SELECT * FROM certificates WHERE id = ?");
$stmt->bind_param("s", $certId);
$stmt->execute();
$result = $stmt->get_result();
$certData = $result->fetch_assoc();

if (!$certData) {
    sendResponse(['error' => 'Certificate not found'], 404);
}

// Get Local User Data (moved up for role check)
$stmtUser = $conn->prepare("SELECT role, marketplace_user_id FROM users WHERE id = ?");
$stmtUser->bind_param("i", $userId);
$stmtUser->execute();
$resUser = $stmtUser->get_result();
$localUser = $resUser->fetch_assoc();

// 3. Verify Ownership (Security Requirement)
// User must be the original scanner (owner of the certificate) OR an Admin
$isAdmin = ($localUser && $localUser['role'] === 'admin');

if ((string)$certData['user_id'] !== (string)$userId && !$isAdmin) {
    log_sync_error("Security Warning: User $userId attempted to list User {$certData['user_id']}'s card (Cert: $certId)");
    sendResponse(['error' => 'Unauthorized: You can only list cards that you originally scanned.'], 403);
}

// 4. Prepare Data for Marketplace
// Sync Check: Ensure local user is linked to a Marketplace account
$marketplaceUserId = null;

if ($localUser && !empty($localUser['marketplace_user_id'])) {
    $marketplaceUserId = $localUser['marketplace_user_id'];
} else {
    // NOT LINKED: Return specific error to trigger UI prompt
    log_sync_error("Sync Required: User $userId attempted to list without linking account.");
    sendResponse(['error' => 'Account Sync Required', 'code' => 'SYNC_REQUIRED'], 403);
}

[$pokeConn, $mpError] = openMarketplaceConnection();
if (!$pokeConn) {
    sendResponse(['error' => 'Marketplace DB Connection failed: ' . $mpError], 500);
}

$listingId = 'listing-' . uniqid();

// Construct Images Array for Marketplace (JSON)
// We use the Base64 images directly as Marketplace supports them (per verification in previous steps/schema check)
// Logic: If existing logic uses filenames, we might need to adjust. 
// Assuming Marketplace `listings.images` is LONGTEXT and supports standard JSON array of strings.

$images = [];
if (!empty($certData['front_img'])) $images[] = $certData['front_img'];
if (!empty($certData['back_img'])) $images[] = $certData['back_img'];

$imagesJson = json_encode($images);

// Process Certificate Image (if provided)
$certificateImageUrl = null;
if ($certificateImage) {
    // Extract base64 data (remove data:image/png;base64, prefix if present)
    $imageData = $certificateImage;
    if (preg_match('/^data:image\/(\w+);base64,/', $imageData, $type)) {
        $imageData = substr($imageData, strpos($imageData, ',') + 1);
        $type = strtolower($type[1]); // jpg, png, gif
        
        // SECURITY: Whitelist extensions to prevent RCE
        $allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        if (!in_array($type, $allowed)) {
             log_sync_error("Security Block: Invalid file type ($type) uploaded by User $userId");
             sendResponse(['error' => 'Invalid image format'], 400);
        }
    } else {
        $type = 'png'; // default
    }
    
    $imageData = base64_decode($imageData);
    
    if ($imageData !== false) {
        // Save to certificates directory
        $filename = 'cert_' . $certId . '_' . time() . '.' . $type;
        $targetPath = '../../public/certificates/' . $filename;
        $fullPath = __DIR__ . '/' . $targetPath;
        
        if (file_put_contents($fullPath, $imageData)) {
            // Construct the public URL
            $certificateImageUrl = 'https://rawgraded.com/certificates/' . $filename;
        } else {
            log_sync_error("Failed to save certificate image for cert $certId");
        }
    }
}

// 5. Insert Listing
// Schema: id, seller_id, listing_type, name, set, rarity, is_graded, grade_value, grading_company, price_usd, images ...
$listingType = 'buy_now';
$name = $certData['name'] ?? 'Unknown Card';
$set = $certData['card_set'] ?? 'Unknown Set';
$rarity = 'Unknown'; // We don't have this in cert data usually
$isGraded = 1;
$gradeValue = $certData['overall_grade'];
$gradingCompany = 'RawGraded AI';

// Other defaults
$stock = 1;
$isDraft = 0;
$shippingMethod = 'crypto'; // Default

$stmtPoke = $pokeConn->prepare("INSERT INTO listings (
    id, seller_id, listing_type, name, `set`, rarity, is_graded, grade_value, grading_company, 
    price_usd, images, stock, is_draft, shipping_method, certificate_image_url, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())");

if (!$stmtPoke) {
     sendResponse(['error' => 'Prepare failed: ' . $pokeConn->error], 500);
}

// NOTE: using $marketplaceUserId here!
$stmtPoke->bind_param("ssssssissssiyss", 
    $listingId, $marketplaceUserId, $listingType, $name, $set, $rarity, 
    $isGraded, $gradeValue, $gradingCompany, 
    $priceUsd, $imagesJson, $stock, $isDraft, $shippingMethod, $certificateImageUrl
);

if ($stmtPoke->execute()) {
    // 6. Success
    sendResponse([
        'success' => true,
        'listing_id' => $listingId,
        'message' => 'Listing created successfully on RawGraded Marketplace'
    ]);
} else {
    sendResponse(['error' => 'Failed to create listing: ' . $stmtPoke->error], 500);
}

$pokeConn->close();
?>
