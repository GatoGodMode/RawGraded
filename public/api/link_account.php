<?php
// link_account.php
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

function log_sync_error($message) {
    $logFile = __DIR__ . '/../../sync_error.log';
    $timestamp = date('[Y-m-d H:i:s] ');
    file_put_contents($logFile, $timestamp . $message . PHP_EOL, FILE_APPEND);
}

require_once('db.php');

// link_account.php
// Handles linking Grader account to Marketplace account (and vice-versa logic if called from there)

// Input: { action: 'link_marketplace', marketplace_email, marketplace_password, user_id }
// Or authenticated session

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    sendResponse(['error' => 'Invalid input'], 400);
}
$action = $input['action'] ?? '';

// SECURITY: Enforce session-based identity
$user = requireAuth();
$localUserId = $user['id'];


if ($action === 'link_marketplace') {
    $mpEmail = $input['marketplace_email'] ?? '';
    $mpPass = $input['marketplace_password'] ?? '';

    if (!$mpEmail || !$mpPass) {
        sendResponse(['error' => 'Email and Password required'], 400);
    }

    [$pokeConn, $mpError] = openMarketplaceConnection();
    if (!$pokeConn) {
         sendResponse(['error' => 'Marketplace DB Connection Failed: ' . $mpError], 500);
    }

    $stmt = $pokeConn->prepare("SELECT id, password_hash, grader_user_id FROM users WHERE email = ?");
    $stmt->bind_param("s", $mpEmail);
    $stmt->execute();
    $res = $stmt->get_result();
    $mpUser = $res->fetch_assoc();

    $mpUserId = null;
    $shouldLink = false;

    if ($mpUser) {
        // User exists - Verify Creds
        if (password_verify($mpPass, $mpUser['password_hash'])) {
            $mpUserId = $mpUser['id'];
            $shouldLink = true;
        } else {
             sendResponse(['error' => 'Invalid Marketplace credentials'], 401);
        }
    } else {
        // User does NOT exist - Auto-Create
        // Schema: id, username, email, password_hash, store_settings... from router.php analysis
        // Marketplace ID uses 'user-uniqid' format
        $mpUserId = 'user-' . uniqid();
        $randomPass = bin2hex(random_bytes(10)); // Safe random password
        $hashed = password_hash($randomPass, PASSWORD_DEFAULT);
        // Use Grader username or email part as username
        // We don't have local username handy here easily unless we fetch it, 
        // but typically input might include it or we use email prefix.
        // Let's fetch local username to be safe/consistent.
        $uStmt = $conn->prepare("SELECT username FROM users WHERE id = ?");
        $uStmt->bind_param("i", $localUserId);
        $uStmt->execute();
        $uRes = $uStmt->get_result();
        $localUser = $uRes->fetch_assoc();
        $mpUsername = $localUser['username'] ?? explode('@', $mpEmail)[0];

        $defaultSettings = json_encode(['defaultAcceptedTokens' => [], 'defaultShippingCost' => 5, 'defaultShippingMethod' => 'crypto']);
        
        $insStmt = $pokeConn->prepare("INSERT INTO users (id, username, email, password_hash, store_settings, grader_user_id) VALUES (?, ?, ?, ?, ?, ?)");
        // grader_user_id set at creation
        $insStmt->bind_param("ssssss", $mpUserId, $mpUsername, $mpEmail, $hashed, $defaultSettings, $localUserId);
        
        if ($insStmt->execute()) {
            $shouldLink = true;
            // No need to update remote logic below if we inserted it here, but strict flow is fine
        } else {
            sendResponse(['error' => 'Failed to auto-create Marketplace account: ' . $pokeConn->error], 500);
        }
    }

    if ($shouldLink && $mpUserId) {
        // 3. Update Local (Grader) DB
        $updGrader = $conn->prepare("UPDATE users SET marketplace_user_id = ? WHERE id = ?");
        $updGrader->bind_param("si", $mpUserId, $localUserId);
        $updGrader->execute();

        // 4. Update Remote (Marketplace) DB (Two-way link)
        // If we just created it, it's already set. If we linked existing, we update it.
        // Re-running update is safe.
        $updPoke = $pokeConn->prepare("UPDATE users SET grader_user_id = ? WHERE id = ?");
        $updPoke->bind_param("ss", $localUserId, $mpUserId);
        $updPoke->execute();

        sendResponse(['success' => true, 'marketplace_user_id' => $mpUserId, 'is_new_account' => !$mpUser]);

    } else {
        // Fallback (Should be caught by Invalid Creds above)
        sendResponse(['error' => 'Unknown State'], 500);
    }
} else {
    sendResponse(['error' => 'Invalid action'], 400);
}
?>
