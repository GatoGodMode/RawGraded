<?php
// Global Security Settings & Master Output Guard
register_shutdown_function(function() {
    /* 
    $error = error_get_last();
    if ($error !== NULL && ($error['type'] === E_ERROR || $error['type'] === E_PARSE || $error['type'] === E_COMPILE_ERROR)) {
        while (ob_get_level() > 0) @ob_end_clean();
        if (!headers_sent()) header('Content-Type: application/json');
        echo json_encode(['error' => 'Backend Sanitizer Caught Fatal Error', 'success' => false]);
        exit;
    }
    */
});

ini_set('display_errors', 1);
ini_set('display_startup_errors', 0);
error_reporting(E_ALL);

// Core DB connection with Centralized CORS
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed_origins = [
    'https://rawgraded.com',
    'https://www.rawgraded.com',
    'http://localhost:5173',
    'http://localhost:3000'
];

if (in_array($origin, $allowed_origins)) {
    header("Access-Control-Allow-Origin: $origin");
} else {
    header("Access-Control-Allow-Origin: https://rawgraded.com");
}

header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-User-ID, X-2FA-Token, X-2FA-Remember");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Credentials: true");
header("Access-Control-Max-Age: 86400");

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

// SECURITY: Content Security Policy & HSTS
// Updated: includes Google Auth (accounts.google.com, apis.google.com, oauth2.googleapis.com)
header("Content-Security-Policy: "
    . "default-src 'self'; "
    . "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://esm.sh https://accounts.google.com https://apis.google.com; "
    . "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com https://accounts.google.com; "
    . "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; "
    . "img-src 'self' data: blob: https://*.rawgraded.com https://assets.rawgraded.com https://api.qrserver.com https://lh3.googleusercontent.com; "
    . "connect-src 'self' https://esm.sh https://generativelanguage.googleapis.com https://accounts.google.com https://oauth2.googleapis.com https://api.pokemontcg.io https://api.tcgdex.net; "
    . "frame-src https://accounts.google.com; "
    . "object-src 'none'; "
    . "base-uri 'self'; "
    . "form-action 'self' https://accounts.google.com; "
    . "upgrade-insecure-requests;"
);
header("Strict-Transport-Security: max-age=31536000; includeSubDomains; preload");
header("X-Content-Type-Options: nosniff");
header("X-Frame-Options: SAMEORIGIN");
header("X-XSS-Protection: 1; mode=block");
header("Referrer-Policy: strict-origin-when-cross-origin");


// SECURITY: Harden Session Cookie Parameters
if (php_sapi_name() !== 'cli' && session_status() === PHP_SESSION_NONE) {
    // Session persists 30 days so login survives browser close (clearing cookies still logs out)
    $sessionLifetime = 30 * 24 * 3600; // 30 days
    ini_set('session.gc_maxlifetime', (string)$sessionLifetime);
    ini_set('session.cookie_lifetime', (string)$sessionLifetime);

    $is_secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['SERVER_PORT'] ?? '') == '443';
    $host = isset($_SERVER['HTTP_HOST']) ? explode(':', $_SERVER['HTTP_HOST'])[0] : '';
    $host = strtolower($host);
    // Use root domain so session + 2FA cookie work across www/non-www and survive refresh
    $domain = ($host === 'rawgraded.com' || $host === 'www.rawgraded.com') ? '.rawgraded.com' : $host;

    @session_set_cookie_params([
        'lifetime' => $sessionLifetime,
        'path' => '/',
        'domain' => $domain,
        'secure' => $is_secure,
        'httponly' => true,
        'samesite' => 'Lax'
    ]);
    @session_start();
}

// Core DB connection
$config_path = dirname(__FILE__) . '/config.php';

if (!file_exists($config_path)) {
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Missing public/api/config.php — copy config.example.php to config.php and configure credentials.']);
    exit;
}

require_once($config_path);

$conn = @new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);

if ($conn->connect_error) {
    sendResponse(['error' => 'Connection failed: ' . $conn->connect_error], 500);
}

$conn->set_charset("utf8mb4");

// Resilience: Check if is_merged column exists to avoid 500 errors if migration hasn't run
$has_merged_col = false;
$has_merged_ids_col = false;

$check_merged = $conn->query("SHOW COLUMNS FROM certificates LIKE 'is_merged'");
if ($check_merged && $check_merged->num_rows > 0) {
    $has_merged_col = true;
}

$check_ids = $conn->query("SHOW COLUMNS FROM certificates LIKE 'merged_certificate_ids'");
if ($check_ids && $check_ids->num_rows > 0) {
    $has_merged_ids_col = true;
}

define('HAS_MERGED_COL', $has_merged_col);
define('HAS_MERGED_IDS_COL', $has_merged_ids_col);

// Resilience: Check if is_holographic column exists (migration may not have run yet on some servers)
$has_holographic_col = false;
$check_holo = $conn->query("SHOW COLUMNS FROM certificates LIKE 'is_holographic'");
if ($check_holo && $check_holo->num_rows > 0) {
    $has_holographic_col = true;
}
define('HAS_HOLOGRAPHIC_COL', $has_holographic_col);

$has_holo_pattern_col = false;
$check_hp = $conn->query("SHOW COLUMNS FROM certificates LIKE 'holo_pattern'");
if ($check_hp && $check_hp->num_rows > 0) {
    $has_holo_pattern_col = true;
}
define('HAS_HOLO_PATTERN_COL', $has_holo_pattern_col);

// Calculate Hamming distance for hex strings
function hammingDistance($h1, $h2) {
    if (strlen($h1) !== strlen($h2)) return 1000;
    $dist = 0;
    for ($i = 0; $i < strlen($h1); $i++) {
        $v1 = hexdec($h1[$i]);
        $v2 = hexdec($h2[$i]);
        $xor = $v1 ^ $v2;
        // Count set bits in nibble
        while ($xor > 0) {
            $dist += $xor & 1;
            $xor >>= 1;
        }
    }
    return $dist;
}

// Universal Similar Scan Finder
function findSimilarScans($conn, $name, $set, $year, $frontHash, $excludeId = null, $limit = 5, $cardNumber = null, $userId = null) {
    $query = "SELECT id, user_id, name, card_set, card_number, year, overall_grade, front_img, front_thumb, front_hash, date_scanned,
              CASE WHEN (front_thumb IS NOT NULL AND front_thumb != '') OR (front_img IS NOT NULL AND front_img != '') THEN 1 ELSE 0 END as has_front_img
              FROM certificates WHERE 1=1";
    $params = [];
    $types = "";
    
    // Safety check
    if (!$name) return [];

    if ($userId) {
        $query .= " AND user_id = ?";
        $params[] = $userId;
        $types .= "s";
    }

    if ($name && strlen($name) > 2) {
        $query .= " AND name LIKE ?";
        $params[] = "%$name%";
        $types .= "s";
    }

    if ($set && strlen($set) > 2) {
        $query .= " AND card_set LIKE ?";
        $params[] = "%$set%";
        $types .= "s";
    }

    if ($excludeId) {
        $query .= " AND id != ?";
        $params[] = $excludeId;
        $types .= "s";
    }
    
    $query .= " ORDER BY overall_grade DESC LIMIT 50"; // Initial pool

    $stmt = $conn->prepare($query);
    if (!empty($params)) {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $result = $stmt->get_result();

    $candidates = [];
    while ($row = $result->fetch_assoc()) {
        $score = 0;
        // Metadata Scoring
        if (strcasecmp($row['name'], $name) === 0) $score += 20;
        if (strcasecmp($row['card_set'], $set) === 0) $score += 15;
        if ($year && strcasecmp($row['year'], $year) === 0) $score += 10;
        if ($cardNumber && !empty($row['card_number']) && strcasecmp($row['card_number'], $cardNumber) === 0) $score += 30;

        // Hash Scoring
        if ($frontHash && !empty($row['front_hash'])) {
            $dist = hammingDistance($frontHash, $row['front_hash']);
            if ($dist <= 5) {
                $score += 100;
            } elseif ($dist <= 15) {
                $score += 50;
            } elseif ($dist <= 30) {
                $score += 10;
            }
        }
        
        if ($score > 10) {
            $row['match_score'] = $score;
            $candidates[] = $row;
        }
    }

    usort($candidates, function($a, $b) {
        return $b['match_score'] <=> $a['match_score'];
    });

    return array_slice($candidates, 0, $limit);
}

function sendResponse($data, $code = 200) {
    if (ob_get_length()) ob_clean();
    header('Content-Type: application/json; charset=UTF-8');
    http_response_code($code);
    $json = json_encode($data, JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        $json = json_encode(['error' => 'Server Error', 'success' => false]);
    }
    echo $json;
    exit;
}

/**
 * SECURITY: Ensure user is authenticated.
 * Returns the user object or terminates with 401.
 */
function requireAuth() {
    if (session_status() === PHP_SESSION_NONE) {
        @session_start();
    }
    if (!isset($_SESSION['user']) || !$_SESSION['user']['id']) {
        sendResponse(['error' => 'Authentication required'], 401);
    }
    return $_SESSION['user'];
}

/**
 * SECURITY: Ensure user has admin role.
 * Terminates with 403 if not admin.
 */
function requireAdmin() {
    $user = requireAuth();
    if (($user['role'] ?? 'user') !== 'admin') {
        sendResponse(['error' => 'Unauthorized. Admin access required.'], 403);
    }
    return $user;
}

/**
 * Open a mysqli connection to the optional marketplace database.
 */
function openMarketplaceConnection() {
    $host = defined('MARKETPLACE_DB_HOST') ? MARKETPLACE_DB_HOST : DB_HOST;
    $user = defined('MARKETPLACE_DB_USER') ? MARKETPLACE_DB_USER : DB_USER;
    $pass = defined('MARKETPLACE_DB_PASS') ? MARKETPLACE_DB_PASS : DB_PASS;
    $name = defined('MARKETPLACE_DB_NAME') ? MARKETPLACE_DB_NAME : 'marketplace';
    $pokeConn = new mysqli($host, $user, $pass, $name);
    if ($pokeConn->connect_error) {
        return [null, $pokeConn->connect_error];
    }
    $pokeConn->set_charset('utf8mb4');
    return [$pokeConn, null];
}
