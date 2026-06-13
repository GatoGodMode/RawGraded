<?php
// Enable output buffering IMMEDIATELY to catch any noise from includes
ob_start();

require_once('db.php');
require_once(__DIR__ . '/membership.php');
require_once(__DIR__ . '/totp_helper.php');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// 2FA cookie: persists "this browser passed 2FA" across session ID changes (e.g. new PHP process / load balancer)
define('TOTP_COOKIE_NAME', 'rg_totp');
function totp_cookie_secret() {
    return defined('TOTP_COOKIE_SECRET') ? TOTP_COOKIE_SECRET : (defined('APP_URL') ? APP_URL : 'rg');
}
function totp_cookie_secret_legacy() {
    return defined('APP_URL') ? APP_URL : 'rg';
}
function totp_cookie_domain() {
    $host = isset($_SERVER['HTTP_HOST']) ? explode(':', $_SERVER['HTTP_HOST'])[0] : '';
    $host = strtolower($host);
    if ($host === 'rawgraded.com' || $host === 'www.rawgraded.com') return '.rawgraded.com';
    return $host;
}
function totp_cookie_set($userId) {
    $payload = (int)$userId . ':' . time();
    $sig = hash_hmac('sha256', $payload, totp_cookie_secret());
    $value = base64_encode($payload . ':' . $sig);
    $maxAge = 30 * 24 * 3600; // 30 days; "every 30 days" re-prompt enforced when reading
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['SERVER_PORT'] ?? '') == '443';
    $path = '/';
    $domain = totp_cookie_domain();
    setcookie(TOTP_COOKIE_NAME, $value, ['expires' => time() + $maxAge, 'path' => $path, 'domain' => $domain, 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']);
}
function totp_cookie_clear() {
    $path = '/';
    $domain = totp_cookie_domain();
    setcookie(TOTP_COOKIE_NAME, '', ['expires' => time() - 3600, 'path' => $path, 'domain' => $domain, 'httponly' => true, 'samesite' => 'Lax']);
}

// 2FA remember token (cookie + DB + optional X-2FA-Remember header from localStorage): survives refresh when cookies don't
define('TOTP_REMEMBER_COOKIE', 'rg_totp_rm');
function totp_remember_get_token() {
    $raw = trim((string)($_COOKIE[TOTP_REMEMBER_COOKIE] ?? ''));
    if ($raw !== '' && strlen($raw) === 64) return $raw;
    $names = ['HTTP_X_2FA_REMEMBER', 'REDIRECT_HTTP_X_2FA_REMEMBER', 'X-2FA-Remember', 'x-2fa-remember'];
    if (function_exists('getallheaders')) {
        $h = getallheaders();
        if (is_array($h)) {
            foreach ($h as $k => $v) {
                if (stripos($k, '2fa') !== false && stripos($k, 'remember') !== false) {
                    $t = trim((string)$v);
                    if (strlen($t) === 64) return $t;
                }
            }
        }
    }
    foreach ($names as $n) {
        if (isset($_SERVER[$n])) {
            $t = trim((string)$_SERVER[$n]);
            if (strlen($t) === 64) return $t;
        }
    }
    foreach (array_keys($_SERVER) as $k) {
        if (stripos($k, '2FA') !== false && stripos($k, 'REMEMBER') !== false) {
            $t = trim((string)$_SERVER[$k]);
            if (strlen($t) === 64) return $t;
        }
    }
    return '';
}
function totp_remember_set($userId, $rememberDays, $conn) {
    $token = bin2hex(random_bytes(32));
    $hash = hash('sha256', $token);
    $expiresAt = ($rememberDays === 30) ? (time() + 30 * 24 * 3600) : null;
    $tbl = $conn->query("SHOW TABLES LIKE 'totp_remember_tokens'");
    if (!$tbl || $tbl->num_rows === 0) return $token;
    if ($expiresAt === null) {
        $ins = $conn->prepare("INSERT INTO totp_remember_tokens (user_id, token_hash, expires_at) VALUES (?, ?, NULL)");
        if ($ins) { $ins->bind_param("is", $userId, $hash); $ins->execute(); }
    } else {
        $ins = $conn->prepare("INSERT INTO totp_remember_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)");
        if ($ins) { $ins->bind_param("isi", $userId, $hash, $expiresAt); $ins->execute(); }
    }
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['SERVER_PORT'] ?? '') == '443';
    $path = '/';
    $domain = totp_cookie_domain();
    $maxAge = $rememberDays === 30 ? 30 * 24 * 3600 : 30 * 24 * 3600;
    setcookie(TOTP_REMEMBER_COOKIE, $token, ['expires' => time() + $maxAge, 'path' => $path, 'domain' => $domain, 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']);
    return $token;
}
function totp_remember_verify($userId, $conn) {
    $raw = totp_remember_get_token();
    if ($raw === '') return false;
    $hash = hash('sha256', $raw);
    $tbl = $conn->query("SHOW TABLES LIKE 'totp_remember_tokens'");
    if (!$tbl || $tbl->num_rows === 0) return false;
    $stmt = $conn->prepare("SELECT 1 FROM totp_remember_tokens WHERE user_id = ? AND token_hash = ? AND (expires_at IS NULL OR expires_at > UNIX_TIMESTAMP()) LIMIT 1");
    if (!$stmt) return false;
    $stmt->bind_param("is", $userId, $hash);
    $stmt->execute();
    return $stmt->get_result()->num_rows > 0;
}
function totp_remember_clear($userId, $conn) {
    $raw = totp_remember_get_token();
    if ($raw !== '') {
        $hash = hash('sha256', $raw);
        $del = $conn->prepare("DELETE FROM totp_remember_tokens WHERE user_id = ? AND token_hash = ?");
        if ($del) { $del->bind_param("is", $userId, $hash); $del->execute(); }
    }
    $path = '/';
    $domain = totp_cookie_domain();
    setcookie(TOTP_REMEMBER_COOKIE, '', ['expires' => time() - 3600, 'path' => $path, 'domain' => $domain, 'httponly' => true, 'samesite' => 'Lax']);
}
function totp_cookie_verify($currentUserId, $rememberDays) {
    $raw = trim((string)($_COOKIE[TOTP_COOKIE_NAME] ?? ''));
    if ($raw === '') return false;
    $dec = base64_decode($raw, true);
    if ($dec === false) { $raw = rawurldecode($raw); $dec = base64_decode($raw, true); }
    if ($dec === false) return false;
    $parts = explode(':', $dec, 3);
    if (count($parts) !== 3) return false;
    list($uid, $ts, $sig) = $parts;
    $uid = (int)$uid; $ts = (int)$ts;
    if ($uid !== (int)$currentUserId) return false;
    $secret = totp_cookie_secret();
    $ok = (hash_hmac('sha256', $uid . ':' . $ts, $secret) === $sig);
    if (!$ok && $secret !== totp_cookie_secret_legacy()) $ok = (hash_hmac('sha256', $uid . ':' . $ts, totp_cookie_secret_legacy()) === $sig);
    if (!$ok) return false;
    if ($rememberDays === 30 && (time() - $ts > 30 * 24 * 3600)) return false;
    return true;
}
// Returns user_id from rg_totp cookie if signature valid, else 0. Used to restore session when no PHP session (e.g. after refresh on different server).
function totp_cookie_user_id() {
    $raw = trim((string)($_COOKIE[TOTP_COOKIE_NAME] ?? ''));
    if ($raw === '') return 0;
    $dec = base64_decode($raw, true);
    if ($dec === false) { $raw = rawurldecode($raw); $dec = base64_decode($raw, true); }
    if ($dec === false) return 0;
    $parts = explode(':', $dec, 3);
    if (count($parts) !== 3) return 0;
    list($uid, $ts, $sig) = $parts;
    $uid = (int)$uid; $ts = (int)$ts;
    if ($uid <= 0) return 0;
    $secret = totp_cookie_secret();
    $ok = (hash_hmac('sha256', $uid . ':' . $ts, $secret) === $sig);
    if (!$ok && $secret !== totp_cookie_secret_legacy()) $ok = (hash_hmac('sha256', $uid . ':' . $ts, totp_cookie_secret_legacy()) === $sig);
    return $ok ? $uid : 0;
}

// 2FA verification token (client-held, sent in X-2FA-Token header; survives refresh, no cookie race)
define('TOTP_TOKEN_LIFETIME', 24 * 3600); // 24h
function totp_get_header_token() {
    if (function_exists('getallheaders')) {
        $h = getallheaders();
        if (is_array($h)) {
            foreach (['X-2FA-Token', 'x-2fa-token', 'X-2fa-Token'] as $k) {
                if (!empty($h[$k])) return trim($h[$k]);
            }
        }
    }
    return trim((string)($_SERVER['HTTP_X_2FA_TOKEN'] ?? ''));
}
function totp_token_create($userId) {
    $exp = time() + TOTP_TOKEN_LIFETIME;
    $payload = (int)$userId . ':' . $exp;
    $sig = hash_hmac('sha256', $payload, totp_cookie_secret());
    return base64_encode($payload . ':' . $sig);
}
function totp_token_verify($token, $currentUserId) {
    if ($token === '' || $token === null) return false;
    $dec = base64_decode($token, true);
    if ($dec === false) return false;
    $parts = explode(':', $dec, 3);
    if (count($parts) !== 3) return false;
    list($uid, $exp, $sig) = $parts;
    $uid = (int)$uid; $exp = (int)$exp;
    if ($uid !== (int)$currentUserId) return false;
    if ($exp < time()) return false;
    $secret = totp_cookie_secret();
    if (hash_hmac('sha256', $uid . ':' . $exp, $secret) !== $sig && hash_hmac('sha256', $uid . ':' . $exp, totp_cookie_secret_legacy()) !== $sig) return false;
    return true;
}
// Returns user_id if token is valid, else 0. Used to restore session when PHP session was lost (e.g. different server after refresh).
function totp_token_user_id($token) {
    if ($token === '' || $token === null) return 0;
    $dec = base64_decode($token, true);
    if ($dec === false) return 0;
    $parts = explode(':', $dec, 3);
    if (count($parts) !== 3) return 0;
    list($uid, $exp, $sig) = $parts;
    $uid = (int)$uid; $exp = (int)$exp;
    if ($uid <= 0 || $exp < time()) return 0;
    $secret = totp_cookie_secret();
    if (hash_hmac('sha256', $uid . ':' . $exp, $secret) !== $sig && hash_hmac('sha256', $uid . ':' . $exp, totp_cookie_secret_legacy()) !== $sig) return 0;
    return $uid;
}

// Require 2FA to be verified before allowing admin actions (closes bypass where admin logs in and calls admin_* before entering code)
function require_totp_for_admin() {
    if (empty($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') return;
    if (!empty($_SESSION['user']['totp_enabled']) && empty($_SESSION['totp_verified'])) {
        sendResponse(['error' => '2FA required'], 403);
    }
}

// --- MAIN LOGIC --- (CORS handled in db.php)
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
// ... no change needed below as long as it doesn't conflict



function fatal_handler() {
    $err = error_get_last();
    if ($err && ($err['type'] === E_ERROR || $err['type'] === E_PARSE || $err['type'] === E_CORE_ERROR)) {
        if (ob_get_length()) ob_clean();
        header('Content-Type: application/json');
        http_response_code(500);
        echo json_encode(['error' => 'Server Error: ' . $err['message']]);
        exit;
    }
}
register_shutdown_function('fatal_handler');

// --- MAIN LOGIC ---
try {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $action = $_GET['action'] ?? '';

    // 1. Check Session (2FA verified state is stored only in totp_verified_sessions by session_id; logout wipes it)
    if ($action === 'check_session') {
        if (isset($_SESSION['user'])) {
            $userId = $_SESSION['user']['id'];
            $role   = $_SESSION['user']['role'] ?? 'user';
            
            if ($role === 'admin') {
                $totpColCheck = $conn->query("SHOW COLUMNS FROM `users` LIKE 'totp_enabled'");
                $hasTotpCol = $totpColCheck && $totpColCheck->num_rows > 0;
                $totpRememberCol = $conn->query("SHOW COLUMNS FROM `users` LIKE 'totp_remember_days'");
                $hasTotpRememberCol = $totpRememberCol && $totpRememberCol->num_rows > 0;
                $adminData = $_SESSION['user'];
                $hasGoogleCol = $conn->query("SHOW COLUMNS FROM `users` LIKE 'google_id'");
                if ($hasTotpCol) {
                    $cols = 'totp_enabled';
                    if ($hasTotpRememberCol) $cols .= ', totp_remember_days';
                    if ($hasGoogleCol && $hasGoogleCol->num_rows > 0) $cols .= ', google_id';
                    $aStmt = $conn->prepare("SELECT $cols FROM users WHERE id = ? LIMIT 1");
                    $aStmt->bind_param("i", $userId);
                    $aStmt->execute();
                    $aRow = $aStmt->get_result()->fetch_assoc();
                    $adminData['totp_enabled'] = !empty($aRow['totp_enabled']);
                    $adminData['totp_remember_days'] = ($hasTotpRememberCol && isset($aRow['totp_remember_days'])) ? (int)$aRow['totp_remember_days'] : 0;
                    $adminData['google_id'] = ($hasGoogleCol && $hasGoogleCol->num_rows > 0 && isset($aRow['google_id'])) ? $aRow['google_id'] : null;
                    if ($adminData['totp_enabled'] && empty($_SESSION['totp_verified'])) {
                        $tbl = $conn->query("SHOW TABLES LIKE 'totp_verified_sessions'");
                        if ($tbl && $tbl->num_rows > 0) {
                            $sid = session_id();
                            $expiresCheck = $conn->query("SHOW COLUMNS FROM totp_verified_sessions LIKE 'expires_at'");
                            $hasExpires = $expiresCheck && $expiresCheck->num_rows > 0;
                            $sql = "SELECT verified_at FROM totp_verified_sessions WHERE user_id = ? AND session_id = ?" . ($hasExpires ? " AND (expires_at IS NULL OR expires_at > UNIX_TIMESTAMP())" : "") . " LIMIT 1";
                            $rst = $conn->prepare($sql);
                            if ($rst) {
                                $rst->bind_param("is", $userId, $sid);
                                $rst->execute();
                                $rrow = $rst->get_result()->fetch_assoc();
                                if ($rrow) {
                                    $_SESSION['totp_verified'] = true;
                                    $_SESSION['totp_verified_at'] = (int)$rrow['verified_at'];
                                }
                            }
                        }
                        if (empty($_SESSION['totp_verified']) && totp_remember_verify($userId, $conn)) {
                            $_SESSION['totp_verified'] = true;
                            $_SESSION['totp_verified_at'] = time();
                        }
                    }
                    if ($adminData['totp_enabled'] && empty($adminData['google_id']) && empty($_SESSION['totp_verified'])) {
                        $adminData['requires_totp'] = true;
                    }
                }
                membership_enrich_user_payload($conn, $adminData);
                $_SESSION['user'] = $adminData;
                sendResponse(['data' => $adminData]);
            } else {
                // Re-fetch user to get fresh credits/limits and 2FA status (totp_enabled optional until migration run)
                $totpColCheck = $conn->query("SHOW COLUMNS FROM `users` LIKE 'totp_enabled'");
                $hasTotpCol = $totpColCheck && $totpColCheck->num_rows > 0;
                $totpRememberCol = $conn->query("SHOW COLUMNS FROM `users` LIKE 'totp_remember_days'");
                $hasTotpRememberCol = $totpRememberCol && $totpRememberCol->num_rows > 0;
                $googleColCheck = $conn->query("SHOW COLUMNS FROM `users` LIKE 'google_id'");
                $hasGoogleCol = $googleColCheck && $googleColCheck->num_rows > 0;
                $cols = "id, username, email, x_username, scan_limit, bonus_scans, paid_credits, scans_this_week, scan_reset_date, joined_date";
                if ($hasTotpCol) $cols .= ", totp_enabled";
                if ($hasTotpRememberCol) $cols .= ", totp_remember_days";
                if ($hasGoogleCol) $cols .= ", google_id, google_picture";
                $stmt = $conn->prepare("SELECT $cols FROM users WHERE id = ?");
                $stmt->bind_param("i", $userId);
                $stmt->execute();
                $ures = $stmt->get_result();
                $user = $ures->fetch_assoc();

                if ($user) {
                    $totpEnabled = $hasTotpCol && !empty($user['totp_enabled']);
                    $totpRememberDays = ($hasTotpRememberCol && isset($user['totp_remember_days'])) ? (int)$user['totp_remember_days'] : 0;
                    if (isset($user['totp_enabled'])) unset($user['totp_enabled']);
                    if (isset($user['totp_remember_days'])) unset($user['totp_remember_days']);
                    $userGoogleId = ($hasGoogleCol && isset($user['google_id'])) ? $user['google_id'] : null;
                    $userGooglePicture = ($hasGoogleCol && isset($user['google_picture'])) ? $user['google_picture'] : null;
                    if (isset($user['google_id'])) unset($user['google_id']);
                    if (isset($user['google_picture'])) unset($user['google_picture']);
                    if ($totpEnabled && empty($_SESSION['totp_verified'])) {
                        $tbl = $conn->query("SHOW TABLES LIKE 'totp_verified_sessions'");
                        if ($tbl && $tbl->num_rows > 0) {
                            $sid = session_id();
                            $expiresCheck = $conn->query("SHOW COLUMNS FROM totp_verified_sessions LIKE 'expires_at'");
                            $hasExpires = $expiresCheck && $expiresCheck->num_rows > 0;
                            $sql = "SELECT verified_at FROM totp_verified_sessions WHERE user_id = ? AND session_id = ?" . ($hasExpires ? " AND (expires_at IS NULL OR expires_at > UNIX_TIMESTAMP())" : "") . " LIMIT 1";
                            $rst = $conn->prepare($sql);
                            if ($rst) {
                                $rst->bind_param("is", $userId, $sid);
                                $rst->execute();
                                $rrow = $rst->get_result()->fetch_assoc();
                                if ($rrow) {
                                    $_SESSION['totp_verified'] = true;
                                    $_SESSION['totp_verified_at'] = (int)$rrow['verified_at'];
                                }
                            }
                        }
                        if (empty($_SESSION['totp_verified']) && totp_remember_verify($userId, $conn)) {
                            $_SESSION['totp_verified'] = true;
                            $_SESSION['totp_verified_at'] = time();
                        }
                    }
                    $hasPurchased = false;
                    $checkStmt = $conn->prepare("SELECT 1 FROM scan_transactions WHERE user_id = ? AND status = 'paid' LIMIT 1");
                    if ($checkStmt) {
                        $checkStmt->bind_param("i", $userId);
                        $checkStmt->execute();
                        if ($checkStmt->get_result()->num_rows > 0) $hasPurchased = true;
                        $checkStmt->close();
                    }
                    $data = [
                        'id' => (int)$user['id'],
                        'username' => $user['username'],
                        'email' => $user['email'],
                        'x_username' => $user['x_username'] ?? '',
                        'role' => 'user',
                        'scan_limit' => (int)$user['scan_limit'],
                        'bonus_scans' => (int)($user['bonus_scans'] ?? 0),
                        'paid_credits' => (int)($user['paid_credits'] ?? 0),
                        'scans_this_week' => (int)($user['scans_this_week'] ?? 0),
                        'scan_reset_date' => $user['scan_reset_date'] ?? null,
                        'joinedDate' => $user['joined_date'] ?? date('Y-m-d'),
                        'has_purchased_credits' => $hasPurchased,
                        'totp_enabled' => $totpEnabled,
                        'totp_remember_days' => $totpRememberDays
                    ];
                    if ($hasGoogleCol) {
                        $data['google_id'] = $userGoogleId;
                        $data['google_picture'] = $userGooglePicture;
                    }
                    if ($totpEnabled && empty($userGoogleId) && empty($_SESSION['totp_verified'])) {
                        $data['requires_totp'] = true;
                    }
                    membership_enrich_user_payload($conn, $data);
                    $_SESSION['user'] = $data;
                    sendResponse(['data' => $data]);
                } else {
                    session_destroy();
                    sendResponse(['error' => 'User no longer exists'], 401);
                }
            }
        } else {
            sendResponse(['error' => 'No active session'], 401);
        }
    }

    // 2. Signup
    else if ($action === 'signup') {
        $username   = $input['username'] ?? '';
        $email      = $input['email'] ?? '';
        $password   = $input['password'] ?? '';
        $inviteCode = $input['invite_code'] ?? '';
        $x_username = $input['x_username'] ?? '';
        $applicationToken = trim($input['application_token'] ?? '');

        if (!$username || !$email || !$password) {
            sendResponse(['error' => 'Missing fields'], 400);
        }

        $scanLimit = 1; // Base limit for all users (1 free scan per week)
        $bonusScans = 0; // Default no bonus
        $inviteId = null;
        $applicationId = null;
        $bypassApplication = false;

        // Check Invite if provided (legacy funnel: skips questionnaire)
        if (!empty($inviteCode)) {
            $invStmt = $conn->prepare("SELECT id FROM invites WHERE code = ? AND is_used = 0");
            if (!$invStmt) throw new Exception("DB Error (Invites): " . $conn->error);
            
            $invStmt->bind_param("s", $inviteCode);
            $invStmt->execute();
            $invRes = $invStmt->get_result();
            
            if ($invRes->num_rows === 0) {
                sendResponse(['error' => 'Invalid or expired invite code.'], 403);
            }
            $inviteData = $invRes->fetch_assoc();
            $inviteId = $inviteData['id'];
            $bonusScans = 10; // Invite bonus: +10 scans (total effective = 15)
            $bypassApplication = true;
        }

        if (!$bypassApplication) {
            if ($applicationToken === '' || strlen($applicationToken) !== 64) {
                sendResponse(['error' => 'Complete the membership application first.', 'code' => 'APPLICATION_REQUIRED'], 400);
            }
            $appStmt = $conn->prepare("SELECT id, email, status, linked_user_id FROM membership_applications WHERE application_token = ? LIMIT 1");
            if (!$appStmt) throw new Exception("DB Error (Applications): " . $conn->error);
            $appStmt->bind_param("s", $applicationToken);
            $appStmt->execute();
            $appRow = $appStmt->get_result()->fetch_assoc();
            if (!$appRow) {
                sendResponse(['error' => 'Invalid application. Submit the questionnaire again.', 'code' => 'APPLICATION_INVALID'], 400);
            }
            if (!empty($appRow['linked_user_id'])) {
                sendResponse(['error' => 'This application was already used.', 'code' => 'APPLICATION_USED'], 400);
            }
            if (!in_array($appRow['status'], ['auto_cleared', 'approved'], true)) {
                sendResponse(['error' => 'Your application is still under review.', 'code' => 'APPLICATION_PENDING'], 403);
            }
            if (strcasecmp(trim($appRow['email']), trim($email)) !== 0) {
                sendResponse(['error' => 'Email must match the one used on your application.', 'code' => 'EMAIL_MISMATCH'], 400);
            }
            $applicationId = (int)$appRow['id'];
        }

        $hasMem = $conn->query("SHOW COLUMNS FROM `users` LIKE 'access_state'")->num_rows > 0;

        // Create User with bonus_scans
        $hashed = password_hash($password, PASSWORD_DEFAULT);
        if ($hasMem) {
            if ($applicationId !== null) {
                $stmt = $conn->prepare("INSERT INTO users (username, email, password, x_username, scan_limit, bonus_scans, access_state, trial_started_at, trial_ends_at, application_id) VALUES (?, ?, ?, ?, ?, ?, 'trialing', NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY), ?)");
                if (!$stmt) throw new Exception("DB Error (Users Insert): " . $conn->error);
                $stmt->bind_param("ssssiii", $username, $email, $hashed, $x_username, $scanLimit, $bonusScans, $applicationId);
            } else {
                $stmt = $conn->prepare("INSERT INTO users (username, email, password, x_username, scan_limit, bonus_scans, access_state, trial_started_at, trial_ends_at) VALUES (?, ?, ?, ?, ?, ?, 'trialing', NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))");
                if (!$stmt) throw new Exception("DB Error (Users Insert): " . $conn->error);
                $stmt->bind_param("ssssii", $username, $email, $hashed, $x_username, $scanLimit, $bonusScans);
            }
        } else {
            $stmt = $conn->prepare("INSERT INTO users (username, email, password, x_username, scan_limit, bonus_scans) VALUES (?, ?, ?, ?, ?, ?)");
            if (!$stmt) throw new Exception("DB Error (Users Insert): " . $conn->error);
            $stmt->bind_param("ssssii", $username, $email, $hashed, $x_username, $scanLimit, $bonusScans);
        }

        if ($stmt->execute()) {
            $userId = $stmt->insert_id;
            
            // Close invite if used
            if ($inviteId) {
                $updInv = $conn->prepare("UPDATE invites SET is_used = 1, used_by = ? WHERE id = ?");
                if ($updInv) {
                    $updInv->bind_param("ii", $userId, $inviteId);
                    $updInv->execute();
                }
            }

            if ($applicationId !== null) {
                $lnk = $conn->prepare("UPDATE membership_applications SET linked_user_id = ? WHERE id = ?");
                if ($lnk) {
                    $lnk->bind_param("ii", $userId, $applicationId);
                    $lnk->execute();
                }
            }

            // Session
            $user = [
                'id' => (int)$userId,
                'username' => $username,
                'email' => $email,
                'x_username' => $x_username,
                'role' => 'user',
                'scan_limit' => (int)$scanLimit,
                'bonus_scans' => (int)$bonusScans,
                'paid_credits' => 0,
                'scans_this_week' => 0,
                'joinedDate' => date('Y-m-d')
            ];
            membership_enrich_user_payload($conn, $user);
            session_regenerate_id(true); // SECURITY: Prevent session fixation
            $_SESSION['user'] = $user;
            sendResponse(['data' => $user]);

        } else {
            // Duplicate err usually
            sendResponse(['error' => 'Signup failed (Username/Email taken)'], 400); 
        }
    }

    // 3. Login
    else if ($action === 'login') {
        $identifier = $input['identifier'] ?? '';
        $password   = $input['password'] ?? '';

        if (!$identifier || !$password) {
            sendResponse(['error' => 'Missing credentials'], 400);
        }

        // A. Try USERS table (Schema: id, username, email, password)
        $stmt = $conn->prepare("SELECT * FROM users WHERE username = ? OR email = ?");
        if (!$stmt) throw new Exception("DB Error (Users Select): " . $conn->error);

        $stmt->bind_param("ss", $identifier, $identifier);
        $stmt->execute();
        $res = $stmt->get_result();
        $user = $res->fetch_assoc();

        if ($user && password_verify($password, $user['password'])) {
            $totpOn = !empty($user['totp_enabled']);
            $hasGoogle = !empty($user['google_id']);
            $data = [
                'id' => (int)$user['id'],
                'username' => $user['username'],
                'email' => $user['email'],
                'x_username' => $user['x_username'] ?? '',
                'role' => 'user',
                'scan_limit' => (int)$user['scan_limit'],
                'bonus_scans' => (int)($user['bonus_scans'] ?? 0),
                'paid_credits' => (int)($user['paid_credits'] ?? 0),
                'scans_this_week' => (int)($user['scans_this_week'] ?? 0),
                'scan_reset_date' => $user['scan_reset_date'] ?? null,
                'joinedDate' => $user['joined_date'] ?? date('Y-m-d'),
                'totp_enabled' => $totpOn,
                'totp_remember_days' => (int)($user['totp_remember_days'] ?? 0),
            ];
            if (isset($user['google_id'])) $data['google_id'] = $user['google_id'];
            if (isset($user['google_picture'])) $data['google_picture'] = $user['google_picture'];
            if ($totpOn && !$hasGoogle) {
                $data['requires_totp'] = true; // Force 2FA step this session (no totp_verified yet)
            }
            membership_enrich_user_payload($conn, $data);
            session_regenerate_id(true); // SECURITY: Prevent session fixation
            $_SESSION['user'] = $data;
            sendResponse(['data' => $data]); // Exit here
        }

        // B. Try ADMINS table (Schema: id, username, password) - Fallback
        // Only if User login failed
        try {
            $stmtAdmin = $conn->prepare("SELECT * FROM admins WHERE username = ?");
            if ($stmtAdmin) {
                $stmtAdmin->bind_param("s", $identifier);
                $stmtAdmin->execute();
                $resAdmin = $stmtAdmin->get_result();
                $admin = $resAdmin->fetch_assoc();

                if ($admin && password_verify($password, $admin['password'])) {
                    // --- SUCCESS: ADMIN LOGGED IN ---
                    // ENSURE SHADOW USER: Every admin needs a record in the 'users' table 
                    // to avoid ID collisions in the 'certificates' table.
                    $admin_username = $admin['username'];
                    $admin_email = $admin['email'] ?? ($admin_username . '@admin.system');
                    
                    $u_stmt = $conn->prepare("SELECT id FROM users WHERE username = ? OR email = ?");
                    $u_stmt->bind_param("ss", $admin_username, $admin_email);
                    $u_stmt->execute();
                    $u_res = $u_stmt->get_result();
                    $u_row = $u_res->fetch_assoc();
                    
                    if (!$u_row) {
                        // Create shadow user for admin
                        $ins = $conn->prepare("INSERT INTO users (username, email, password, role) VALUES (?, ?, 'ADMIN_SHADOW', 'admin')");
                        $ins->bind_param("ss", $admin_username, $admin_email);
                        $ins->execute();
                        $shadow_user_id = $ins->insert_id;
                    } else {
                        $shadow_user_id = $u_row['id'];
                        // ROBUSTNESS: Ensure the shadow user record has the 'admin' role
                        $conn->query("UPDATE users SET role = 'admin' WHERE id = " . (int)$shadow_user_id);
                    }

                    $data = [
                        'id' => (int)$shadow_user_id, // Use shadow USER ID for scans!
                        'admin_id' => (int)$admin['id'], // Keep original admin ID too
                        'username' => $admin['username'],
                        'email' => $admin['email'] ?? '',
                        'x_username' => $admin['x_username'] ?? '',
                        'role' => 'admin',
                        'joinedDate' => date('Y-m-d'),
                        'scan_limit' => 999999,
                        'bonus_scans' => 0,
                        'paid_credits' => 0,
                        'scans_this_week' => 0
                    ];
                    // Enforce 2FA for admin when shadow user has totp_enabled and no google_id (same as regular user login)
                    $totpCol = $conn->query("SHOW COLUMNS FROM `users` LIKE 'totp_enabled'");
                    if ($totpCol && $totpCol->num_rows > 0) {
                        $totpRememberCol = $conn->query("SHOW COLUMNS FROM `users` LIKE 'totp_remember_days'");
                        $googleCol = $conn->query("SHOW COLUMNS FROM `users` LIKE 'google_id'");
                        $totpCols = 'totp_enabled';
                        if ($totpRememberCol && $totpRememberCol->num_rows > 0) $totpCols .= ', totp_remember_days';
                        if ($googleCol && $googleCol->num_rows > 0) $totpCols .= ', google_id';
                        $tstmt = $conn->prepare("SELECT $totpCols FROM users WHERE id = ? LIMIT 1");
                        if ($tstmt) {
                            $tstmt->bind_param("i", $shadow_user_id);
                            $tstmt->execute();
                            $trow = $tstmt->get_result()->fetch_assoc();
                            if ($trow && !empty($trow['totp_enabled']) && empty($trow['google_id'])) {
                                $data['totp_enabled'] = true;
                                $data['requires_totp'] = true;
                                $data['totp_remember_days'] = (int)($trow['totp_remember_days'] ?? 0);
                            }
                        }
                    }
                    membership_enrich_user_payload($conn, $data);
                    session_regenerate_id(true); // SECURITY: Prevent session fixation
                    $_SESSION['user'] = $data;
                    sendResponse(['data' => $data]); // Exit here
                }
            }
        } catch (Exception $ex) {
            // If admins table is missing, catch it so we don't crash, just fail login
            // Maybe log it?
        }

        sendResponse(['error' => 'Invalid username/email or password'], 401);
    }

    // 4. Logout
    else if ($action === 'logout') {
        $logoutUserId = isset($_SESSION['user']['id']) ? (int)$_SESSION['user']['id'] : 0;
        totp_remember_clear($logoutUserId, $conn);
        $sid = session_id();
        $tbl = $conn->query("SHOW TABLES LIKE 'totp_verified_sessions'");
        if ($tbl && $tbl->num_rows > 0 && $sid) {
            $del = $conn->prepare("DELETE FROM totp_verified_sessions WHERE session_id = ?");
            if ($del) { $del->bind_param("s", $sid); $del->execute(); }
        }
        totp_cookie_clear();
        session_destroy();
        sendResponse(['success' => true]);
    }

    // 4.1 Cache version (public GET) — clients compare to sessionStorage and reload if newer
    else if ($action === 'cache_version') {
        $tbl = $conn->query("SHOW TABLES LIKE 'settings'");
        if (!$tbl || $tbl->num_rows === 0) {
            sendResponse(['data' => 0]);
        }
        $row = $conn->query("SELECT `value` FROM settings WHERE `key` = 'cache_version' LIMIT 1");
        $v = ($row && $r = $row->fetch_assoc()) ? (int)$r['value'] : 0;
        sendResponse(['data' => $v]);
    }

    // 4.2 Admin bump cache version (POST) — after deploy, bump so all clients reload on next check
    else if ($action === 'admin_bump_cache_version') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();
        $tbl = $conn->query("SHOW TABLES LIKE 'settings'");
        if (!$tbl || $tbl->num_rows === 0) {
            sendResponse(['error' => 'Settings table missing'], 500);
        }
        $row = $conn->query("SELECT `value` FROM settings WHERE `key` = 'cache_version' LIMIT 1");
        $current = ($row && $r = $row->fetch_assoc()) ? (int)$r['value'] : 0;
        $next = $current + 1;
        $stmt = $conn->prepare("INSERT INTO settings (`key`, `value`) VALUES ('cache_version', ?) ON DUPLICATE KEY UPDATE `value` = ?");
        if (!$stmt) {
            sendResponse(['error' => 'DB prepare failed'], 500);
        }
        $s = (string)$next;
        $stmt->bind_param("ss", $s, $s);
        if ($stmt->execute()) {
            sendResponse(['data' => ['version' => $next]]);
        } else {
            sendResponse(['error' => 'Failed to bump version'], 500);
        }
    }

    // 5. Admin Stats
    else if ($action === 'admin_stats') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();
        $uCount = $conn->query("SELECT COUNT(*) as c FROM users")->fetch_assoc()['c'];
        
        // Join with users to get the name of who used it
        $sql = "SELECT i.code, i.is_used, i.created_at, u.username as used_by_name 
                FROM invites i 
                LEFT JOIN users u ON i.used_by = u.id 
                ORDER BY i.created_at DESC LIMIT 50";
                
        $invRes = $conn->query($sql);
        $invites = [];
        while($r = $invRes->fetch_assoc()) {
            $r['is_used'] = (int)$r['is_used']; 
            $invites[] = $r;
        }

        // Fetch recent certificates for Admin Review with ownership
        $sqlCerts = "SELECT c.id, c.name, c.overall_grade, c.date_scanned, c.user_id, u.username as owner_name 
                     FROM certificates c 
                     LEFT JOIN users u ON c.user_id = u.id 
                     ORDER BY c.date_scanned DESC LIMIT 50";
        $certRes = $conn->query($sqlCerts);
        $certs = [];
        while($c = $certRes->fetch_assoc()) $certs[] = $c;

        sendResponse(['data' => ['userCount' => $uCount, 'invites' => $invites, 'certificates' => $certs]]);
    }

    // 6.2 Admin Data Integrity Fix
    else if ($action === 'admin_integrity_fix') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();
        // Fix Self-Linking
        $conn->query("UPDATE certificates SET parent_id = NULL WHERE parent_id = id");
        $affectedSelf = $conn->affected_rows;

        // Fix Orphaned Parents
        $conn->query("UPDATE certificates SET parent_id = NULL WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM certificates)");
        $affectedOrphans = $conn->affected_rows;

        sendResponse(['data' => [
            'fixed_self' => $affectedSelf,
            'fixed_orphans' => $affectedOrphans,
            'total_fixed' => $affectedSelf + $affectedOrphans
        ]]);
    }

    // 6.3 Admin Bulk Ownership Transfer
    else if ($action === 'admin_bulk_transfer') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();

        $fromId = $input['from_user_id'] ?? '';
        $toId = $input['to_user_id'] ?? '';

        if (!$fromId || !$toId) {
            sendResponse(['error' => 'Missing User IDs'], 400);
        }

        $stmt = $conn->prepare("UPDATE certificates SET user_id = ? WHERE user_id = ?");
        $stmt->bind_param("ii", $toId, $fromId);

        if ($stmt->execute()) {
            sendResponse(['data' => ['success' => true, 'affected_count' => $stmt->affected_rows]]);
        } else {
            sendResponse(['error' => 'Transfer failed: ' . $conn->error], 500);
        }
    }

    // 6.4 Admin Claim Certs (Alias for bulk transfer to current admin)
    else if ($action === 'admin_claim_certs') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();
        $fromId = $input['from_user_id'] ?? '';
        
        // ROBUSTNESS FIX: Look up the Admin's "Shadow User ID" freshly from the database.
        // This handles cases where the session might be stale (cached from before the login fix).
        $admin_username = $_SESSION['user']['username'];
        $admin_email = $_SESSION['user']['email'] ?? '';
        
        $u_stmt = $conn->prepare("SELECT id FROM users WHERE username = ? OR (email = ? AND email != '')");
        $u_stmt->bind_param("ss", $admin_username, $admin_email);
        $u_stmt->execute();
        $u_res = $u_stmt->get_result();
        $u_row = $u_res->fetch_assoc();

        if ($u_row) {
            $toId = $u_row['id'];
        } else {
            // Fallback (Should typically not happen if login logic is working, but safe default)
            $toId = $_SESSION['user']['id']; 
        }

        if (!$fromId) {
            sendResponse(['error' => 'Missing Target User ID'], 400);
        }
        
        if ($fromId == $toId) {
             sendResponse(['success' => true, 'affected_count' => 0, 'message' => 'Source and Target are the same.']);
        }

        $stmt = $conn->prepare("UPDATE certificates SET user_id = ? WHERE user_id = ?");
        $stmt->bind_param("ii", $toId, $fromId);

        if ($stmt->execute()) {
            sendResponse(['data' => ['success' => true, 'affected_count' => $stmt->affected_rows]]);
        } else {
            sendResponse(['error' => 'Claim failed: ' . $conn->error], 500);
        }
    }

    // 6.5 Admin Refresh Credits (reset scans_this_week so users can scan again; fallback if weekly cron fails)
    else if ($action === 'admin_refresh_credits') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();
        $sql = "UPDATE users SET scans_this_week = 0";
        if ($conn->query($sql)) {
            sendResponse(['data' => ['success' => true, 'affected_count' => $conn->affected_rows]]);
        } else {
            sendResponse(['error' => 'Refresh failed: ' . $conn->error], 500);
        }
    }

    // 6.6 Admin Refresh User Credits (reset one user's scans_this_week to 0)
    else if ($action === 'admin_refresh_user_credits') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();
        $userId = $input['user_id'] ?? '';
        if (!$userId) {
            sendResponse(['error' => 'user_id required'], 400);
        }
        $stmt = $conn->prepare("UPDATE users SET scans_this_week = 0 WHERE id = ?");
        $stmt->bind_param("i", $userId);
        if ($stmt->execute()) {
            sendResponse(['data' => ['success' => true, 'affected_count' => $stmt->affected_rows]]);
        } else {
            sendResponse(['error' => 'Refresh failed: ' . $conn->error], 500);
        }
    }

    // 7. Admin Delete Certificate
    else if ($action === 'admin_delete_cert') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();

        $id = $input['id'] ?? '';
        if (!$id) sendResponse(['error' => 'Missing ID'], 400);

        $stmt = $conn->prepare("DELETE FROM certificates WHERE id = ?");
        $stmt->bind_param("s", $id);
        
        if ($stmt->execute()) {
            sendResponse(['data' => ['success' => true]]);
        } else {
            sendResponse(['error' => 'Delete failed'], 500);
        }
    }

    // 7.1 Admin Re-assign Certificate
    else if ($action === 'admin_reassign_cert') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }

        $certId = $input['cert_id'] ?? '';
        $newUserId = $input['new_user_id'] ?? '';

        if (!$certId || !$newUserId) {
            sendResponse(['error' => 'Missing Cert ID or User ID'], 400);
        }

        $stmt = $conn->prepare("UPDATE certificates SET user_id = ? WHERE id = ?");
        $stmt->bind_param("is", $newUserId, $certId);

        if ($stmt->execute()) {
            sendResponse(['data' => ['success' => true]]);
        } else {
            sendResponse(['error' => 'Update failed: ' . $conn->error], 500);
        }
    }

    // 8. Admin List Users
    else if ($action === 'admin_list_users') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();

        $hasVipLifetime = $conn->query("SHOW COLUMNS FROM `users` LIKE 'vip_lifetime'")->num_rows > 0;
        $vipSel = $hasVipLifetime ? ', vip_lifetime' : '';
        $res = $conn->query("SELECT id, username, email, x_username, is_alliance, is_pck, scan_limit, bonus_scans, paid_credits, scans_this_week, scan_reset_date, joined_date$vipSel FROM users ORDER BY joined_date DESC");
        $users = [];
        while($u = $res->fetch_assoc()) {
            $u['id'] = (int)$u['id'];
            $u['scan_limit'] = (int)$u['scan_limit'];
            $u['bonus_scans'] = (int)($u['bonus_scans'] ?? 0);
            $u['paid_credits'] = (int)($u['paid_credits'] ?? 0);
            $u['scans_this_week'] = (int)($u['scans_this_week'] ?? 0);
            $u['is_alliance'] = (int)($u['is_alliance'] ?? 0);
            $u['is_pck'] = (int)($u['is_pck'] ?? 0);
            if ($hasVipLifetime) {
                $u['vip_lifetime'] = (int)($u['vip_lifetime'] ?? 0);
            } else {
                $u['vip_lifetime'] = 0;
            }
            $users[] = $u;
        }
        sendResponse(['data' => $users]);
    }

    // 9. Admin Create User
    else if ($action === 'admin_create_user') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();

        $username = $input['username'] ?? '';
        $email = $input['email'] ?? '';
        $password = $input['password'] ?? '';
        $scanLimit = $input['scan_limit'] ?? 5;
        $bonusScans = (int)($input['bonus_scans'] ?? 0);
        $paidCredits = max(0, (int)($input['paid_credits'] ?? 0));

        if (!$username || !$email || !$password) {
            sendResponse(['error' => 'Missing fields'], 400);
        }

        $hashed = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $conn->prepare("INSERT INTO users (username, email, password, scan_limit, bonus_scans, paid_credits) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->bind_param("sssiii", $username, $email, $hashed, $scanLimit, $bonusScans, $paidCredits);

        if ($stmt->execute()) {
            sendResponse(['data' => ['success' => true, 'id' => $stmt->insert_id]]);
        } else {
            sendResponse(['error' => 'Creation failed (possible duplicate)'], 400);
        }
    }

    // 10. Admin Update User
    else if ($action === 'admin_update_user') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();

        $userId = $input['id'] ?? '';
        $username = $input['username'] ?? '';
        $email = $input['email'] ?? '';
        $x_username = $input['x_username'] ?? '';
        $scanLimit = $input['scan_limit'] ?? 5;
        $bonusScans = (int)($input['bonus_scans'] ?? 0);
        $paidCredits = max(0, (int)($input['paid_credits'] ?? 0));
        $password = $input['password'] ?? '';
        $hasVipLifetime = $conn->query("SHOW COLUMNS FROM `users` LIKE 'vip_lifetime'")->num_rows > 0;
        $vipLifetime = $hasVipLifetime ? ((int)!empty($input['vip_lifetime'])) : null;

        if (!$userId) sendResponse(['error' => 'Missing User ID'], 400);

        $sql = "UPDATE users SET username = ?, email = ?, x_username = ?, scan_limit = ?, bonus_scans = ?, paid_credits = ?";
        $types = "sssiii";
        $params = [$username, $email, $x_username, $scanLimit, $bonusScans, $paidCredits];

        if ($vipLifetime !== null) {
            $sql .= ", vip_lifetime = ?";
            $types .= "i";
            $params[] = $vipLifetime;
        }

        if ($password) {
            $hashed = password_hash($password, PASSWORD_DEFAULT);
            $sql .= ", password = ?";
            $types .= "s";
            $params[] = $hashed;
        }

        $sql .= " WHERE id = ?";
        $types .= "i";
        $params[] = $userId;

        $stmt = $conn->prepare($sql);
        $stmt->bind_param($types, ...$params);

        if ($stmt->execute()) {
            sendResponse(['data' => ['success' => true]]);
        } else {
            sendResponse(['error' => 'Update failed: ' . $conn->error], 500);
        }
    }

    // 11. Admin Delete User
    else if ($action === 'admin_delete_user') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }

        $userId = $input['id'] ?? '';
        if (!$userId) sendResponse(['error' => 'Missing User ID'], 400);

        // Optional: Delete associated certificates too? 
        // For now just delete user.
        $stmt = $conn->prepare("DELETE FROM users WHERE id = ?");
        $stmt->bind_param("i", $userId);

        if ($stmt->execute()) {
            sendResponse(['data' => ['success' => true]]);
        } else {
            sendResponse(['error' => 'Delete failed'], 500);
        }
    }

    // 12. Admin Reset Password
    else if ($action === 'admin_reset_password') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();

        $userId = $input['user_id'] ?? '';
        $newPassword = $input['new_password'] ?? '';

        if (!$userId || strlen($newPassword) < 6) {
            sendResponse(['error' => 'Invalid input'], 400);
        }

        $hashed = password_hash($newPassword, PASSWORD_DEFAULT);
        $stmt = $conn->prepare("UPDATE users SET password = ? WHERE id = ?");
        $stmt->bind_param("si", $hashed, $userId);

        if ($stmt->execute()) {
            sendResponse(['data' => ['success' => true]]);
        } else {
            sendResponse(['error' => 'Reset failed'], 500);
        }
    }

    // 13. Admin Toggle Alliance Status
    else if ($action === 'admin_toggle_alliance') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }

        $userId = $input['user_id'] ?? '';
        $isAlliance = $input['is_alliance'] ?? 0;

        if (!$userId) {
            sendResponse(['error' => 'Missing User ID'], 400);
        }

        $stmt = $conn->prepare("UPDATE users SET is_alliance = ? WHERE id = ?");
        $stmt->bind_param("ii", $isAlliance, $userId);

        if ($stmt->execute()) {
            sendResponse(['data' => ['success' => true]]);
        } else {
            sendResponse(['error' => 'Toggle failed: ' . $conn->error], 500);
        }
    }

    // 13.1 Admin Toggle PCK Status
    else if ($action === 'admin_toggle_pck') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();

        $userId = $input['user_id'] ?? '';
        $isPck = $input['is_pck'] ?? 0;

        if (!$userId) {
            sendResponse(['error' => 'Missing User ID'], 400);
        }

        $stmt = $conn->prepare("UPDATE users SET is_pck = ? WHERE id = ?");
        $stmt->bind_param("ii", $isPck, $userId);

        if ($stmt->execute()) {
            sendResponse(['data' => ['success' => true]]);
        } else {
            sendResponse(['error' => 'Toggle failed: ' . $conn->error], 500);
        }
    }

    // 13.2 Admin Toggle lifetime VIP (full platform access without subscription)
    else if ($action === 'admin_toggle_vip_lifetime') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();

        if ($conn->query("SHOW COLUMNS FROM `users` LIKE 'vip_lifetime'")->num_rows === 0) {
            sendResponse(['error' => 'vip_lifetime column missing — run sync_db first'], 400);
        }

        $userId = (int)($input['user_id'] ?? 0);
        $vipLifetime = (int)!empty($input['vip_lifetime']);

        if ($userId <= 0) {
            sendResponse(['error' => 'Missing User ID'], 400);
        }

        $stmt = $conn->prepare("UPDATE users SET vip_lifetime = ? WHERE id = ?");
        $stmt->bind_param("ii", $vipLifetime, $userId);

        if ($stmt->execute()) {
            sendResponse(['data' => ['success' => true]]);
        } else {
            sendResponse(['error' => 'Toggle failed: ' . $conn->error], 500);
        }
    }

    // 14. Admin List Disputes
    else if ($action === 'admin_list_disputes') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();

        $res = $conn->query("
            SELECT s.id as slab_id, s.cert_id, s.psa_serial, s.grader, s.card_name, s.user_id as current_owner_id,
                   s.transfer_requested_by, u1.username as current_owner, u2.username as requester,
                   s.transfer_status, s.added_at
            FROM psa_slabs s
            LEFT JOIN users u1 ON s.user_id = u1.id
            LEFT JOIN users u2 ON s.transfer_requested_by = u2.id
            WHERE s.transfer_status = 'dispute'
            ORDER BY s.added_at DESC
        ");
        $disputes = [];
        if ($res) {
            while($row = $res->fetch_assoc()) {
                $row['slab_id'] = (int)$row['slab_id'];
                $row['current_owner_id'] = (int)$row['current_owner_id'];
                $row['transfer_requested_by'] = (int)$row['transfer_requested_by'];
                $disputes[] = $row;
            }
        }
        sendResponse(['data' => $disputes]);
    }

    // 15. Admin Resolve Dispute
    else if ($action === 'admin_resolve_dispute') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }
        require_totp_for_admin();

        $slabId = (int)($input['slab_id'] ?? 0);
        $resolution = $input['resolution'] ?? ''; // 'award_requester', 'keep_owner'
        
        if (!$slabId || !in_array($resolution, ['award_requester', 'keep_owner'])) {
            sendResponse(['error' => 'Missing or invalid parameters'], 400);
        }

        if ($resolution === 'award_requester') {
            // Transfer to requester, clear status
            $chk = $conn->prepare("SELECT transfer_requested_by FROM psa_slabs WHERE id = ? AND transfer_status = 'dispute'");
            $chk->bind_param("i", $slabId);
            $chk->execute();
            $row = $chk->get_result()->fetch_assoc();
            if (!$row || !$row['transfer_requested_by']) {
                sendResponse(['error' => 'Dispute not found or invalid'], 404);
            }
            $newOwnerId = (int)$row['transfer_requested_by'];
            $upd = $conn->prepare("UPDATE psa_slabs SET user_id = ?, transfer_status = NULL, transfer_requested_by = NULL, for_sale = 0 WHERE id = ?");
            $upd->bind_param("ii", $newOwnerId, $slabId);
            if ($upd->execute()) {
                sendResponse(['data' => ['success' => true]]);
            } else {
                sendResponse(['error' => 'Resolution failed'], 500);
            }
        } else {
            // Keep current owner, clear dispute status
            $upd = $conn->prepare("UPDATE psa_slabs SET transfer_status = NULL, transfer_requested_by = NULL WHERE id = ?");
            $upd->bind_param("i", $slabId);
            if ($upd->execute()) {
                sendResponse(['data' => ['success' => true]]);
            } else {
                sendResponse(['error' => 'Resolution failed'], 500);
            }
        }
    }

    // 6. Generate Invite
    else if ($action === 'generate_invite') {
        if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
            sendResponse(['error' => 'Unauthorized'], 403);
        }

        $code = 'RAW-' . strtoupper(substr(md5(uniqid(rand(), true)), 0, 8));
        $creatorId = $_SESSION['user']['id'];

        // Make sure invites table exists first (handled by sync_db but good to be safe)
        $stmt = $conn->prepare("INSERT INTO invites (code, created_by) VALUES (?, ?)");
        if (!$stmt) {
             // If table missing, this will throw, caught by fatal handler or try/catch
             throw new Exception("DB Error (Invites Insert): " . $conn->error);
        }
        $stmt->bind_param("si", $code, $creatorId);
        
        if ($stmt->execute()) {
            sendResponse(['data' => ['code' => $code]]);
        } else {
            sendResponse(['error' => 'Failed to generate code'], 500);
        }
    }

    else if ($action === 'redeem_invite') {
        if (!isset($_SESSION['user'])) {
            sendResponse(['error' => 'Unauthorized'], 401);
        }
        
        $userId = $_SESSION['user']['id'];
        $code = $input['code'] ?? '';
        
        if (empty($code)) {
            sendResponse(['error' => 'Code is required'], 400);
        }
        
        // Check if code exists and is not used
        $stmt = $conn->prepare("SELECT id FROM invites WHERE code = ? AND is_used = 0");
        if (!$stmt) throw new Exception("DB Error: " . $conn->error);
        
        $stmt->bind_param("s", $code);
        $stmt->execute();
        $result = $stmt->get_result();
        
        if ($result->num_rows === 0) {
            sendResponse(['error' => 'Invalid or already used invite code'], 403);
        }
        
        $inviteData = $result->fetch_assoc();
        $inviteId = $inviteData['id'];
        
        // Grant bonus scans
        $updateUser = $conn->prepare("UPDATE users SET bonus_scans = bonus_scans + 10 WHERE id = ?");
        if (!$updateUser) throw new Exception("DB Error: " . $conn->error);
        
        $updateUser->bind_param("i", $userId);
        
        if (!$updateUser->execute()) {
            sendResponse(['error' => 'Failed to grant bonus'], 500);
        }
        
        // Mark invite as used
        $updateInv = $conn->prepare("UPDATE invites SET is_used = 1, used_by = ? WHERE id = ?");
        if (!$updateInv) throw new Exception("DB Error: " . $conn->error);
        
        $updateInv->bind_param("ii", $userId, $inviteId);
        $updateInv->execute();
        
        // Update session
        $_SESSION['user']['bonus_scans'] = ($_SESSION['user']['bonus_scans'] ?? 0) + 10;
        
        sendResponse([
            'success' => true, 
            'message' => '+10 scans added!',
            'bonus_scans' => $_SESSION['user']['bonus_scans']
        ]);
    }

    else if ($action === 'update_profile') {
        if (!isset($_SESSION['user'])) {
            sendResponse(['error' => 'Unauthorized'], 401);
        }

        $isAdmin = ($_SESSION['user']['role'] ?? '') === 'admin';
        $userId = $isAdmin ? ($_SESSION['user']['admin_id'] ?? $_SESSION['user']['id']) : $_SESSION['user']['id'];
        $email  = $input['email'] ?? '';
        $x_username = $input['x_username'] ?? '';
        $password = $input['password'] ?? '';

        $table = $isAdmin ? 'admins' : 'users';

        if ($table === 'users' && !$email) {
            sendResponse(['error' => 'Email is required'], 400);
        }

        $sql = "UPDATE $table SET email = ?, x_username = ?";
        $types = "ss";
        $params = [$email, $x_username];

        if ($password) {
            $hashed = password_hash($password, PASSWORD_DEFAULT);
            $sql .= ", password = ?";
            $types .= "s";
            $params[] = $hashed;
        }

        $sql .= " WHERE id = ?";
        $types .= "i";
        $params[] = $userId;

        $stmt = $conn->prepare($sql);
        $stmt->bind_param($types, ...$params);

        if ($stmt->execute()) {
            $_SESSION['user']['email'] = $email;
            $_SESSION['user']['x_username'] = $x_username;
            sendResponse(['data' => ['user' => $_SESSION['user']]]);
        } else {
            sendResponse(['error' => 'Update failed: ' . $conn->error], 500);
        }
    }
    

    // ── GOOGLE AUTH ──────────────────────────────────────────────
    // Verifies a Google ID token from the frontend GSI SDK.
    // Creates a new user or logs in an existing one by google_id or email.
    else if ($action === 'google_auth') {
        $applicationToken = trim($input['application_token'] ?? '');
        $idToken = $input['credential'] ?? $input['id_token'] ?? '';
        if (!$idToken) {
            sendResponse(['error' => 'Missing Google credential'], 400);
        }

        // Verify the token with Google's tokeninfo endpoint
        $verifyUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($idToken);
        $ctx = stream_context_create(['http' => ['timeout' => 10]]);
        $raw = @file_get_contents($verifyUrl, false, $ctx);
        if (!$raw) {
            sendResponse(['error' => 'Failed to verify Google token'], 502);
        }
        $payload = json_decode($raw, true);

        if (empty($payload['sub']) || empty($payload['email'])) {
            sendResponse(['error' => 'Invalid Google token payload'], 401);
        }

        // Verify audience matches our Client ID
        $aud = $payload['aud'] ?? '';
        if ($aud !== GOOGLE_CLIENT_ID) {
            sendResponse(['error' => 'Token audience mismatch'], 401);
        }

        $googleId      = $payload['sub'];
        $email         = filter_var($payload['email'], FILTER_SANITIZE_EMAIL);
        $name          = $payload['name'] ?? '';
        $picture       = $payload['picture'] ?? '';
        $emailVerified = ($payload['email_verified'] ?? 'false') === 'true' ? 1 : 0;

        // Generate a username from the display name or email prefix
        $baseUsername = preg_replace('/[^a-zA-Z0-9_]/', '', strtolower(explode(' ', $name)[0] ?: explode('@', $email)[0]));
        if (strlen($baseUsername) < 3) $baseUsername = 'user' . substr($googleId, 0, 6);

        // 1. Try to find existing user by google_id
        $stmt = $conn->prepare("SELECT * FROM users WHERE google_id = ? LIMIT 1");
        $stmt->bind_param("s", $googleId);
        $stmt->execute();
        $user = $stmt->get_result()->fetch_assoc();

        if (!$user) {
            // 2. Try to find existing user by email (link account)
            $stmt2 = $conn->prepare("SELECT * FROM users WHERE email = ? LIMIT 1");
            $stmt2->bind_param("s", $email);
            $stmt2->execute();
            $user = $stmt2->get_result()->fetch_assoc();

            if ($user) {
                // Link google_id to existing email account
                $upd = $conn->prepare("UPDATE users SET google_id = ?, email_verified = 1, google_picture = ? WHERE id = ?");
                $upd->bind_param("ssi", $googleId, $picture, $user['id']);
                $upd->execute();
                $user['google_id'] = $googleId;
                $user['google_picture'] = $picture;
                $user['email_verified'] = 1;
            } else {
                // 3. Create new user via Google — require cleared application (same rules as password signup)
                if ($applicationToken === '' || strlen($applicationToken) !== 64) {
                    sendResponse(['error' => 'Complete the membership application first.', 'code' => 'APPLICATION_REQUIRED'], 400);
                }
                $appStmt = $conn->prepare("SELECT id, email, status, linked_user_id FROM membership_applications WHERE application_token = ? LIMIT 1");
                if (!$appStmt) throw new Exception("DB Error (Applications): " . $conn->error);
                $appStmt->bind_param("s", $applicationToken);
                $appStmt->execute();
                $appRow = $appStmt->get_result()->fetch_assoc();
                if (!$appRow || !empty($appRow['linked_user_id']) || !in_array($appRow['status'], ['auto_cleared', 'approved'], true)) {
                    sendResponse(['error' => 'Invalid or pending application.', 'code' => 'APPLICATION_INVALID'], 403);
                }
                if (strcasecmp(trim($appRow['email']), trim($email)) !== 0) {
                    sendResponse(['error' => 'Use the same Google account email you used on your application.', 'code' => 'EMAIL_MISMATCH'], 400);
                }
                $applicationId = (int)$appRow['id'];

                // 3. Create new user via Google — ensure unique username
                $uname = $baseUsername;
                $suffix = 1;
                while (true) {
                    $ck = $conn->prepare("SELECT id FROM users WHERE username = ? LIMIT 1");
                    $ck->bind_param("s", $uname);
                    $ck->execute();
                    if ($ck->get_result()->num_rows === 0) break;
                    $uname = $baseUsername . $suffix++;
                }

                // Placeholder password: Google-only users cannot log in with password
                $passwordPlaceholder = password_hash('GOOGLE_OAUTH_NO_PASSWORD', PASSWORD_DEFAULT);
                $hasMem = $conn->query("SHOW COLUMNS FROM `users` LIKE 'access_state'")->num_rows > 0;
                if ($hasMem) {
                    $ins = $conn->prepare(
                        "INSERT INTO users (username, email, password, google_id, email_verified, google_picture, scan_limit, bonus_scans, access_state, trial_started_at, trial_ends_at, application_id) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 'trialing', NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY), ?)"
                    );
                    if (!$ins) throw new Exception("DB Error (Google Insert): " . $conn->error);
                    $ins->bind_param("ssssisi", $uname, $email, $passwordPlaceholder, $googleId, $emailVerified, $picture, $applicationId);
                } else {
                    $ins = $conn->prepare(
                        "INSERT INTO users (username, email, password, google_id, email_verified, google_picture, scan_limit, bonus_scans) VALUES (?, ?, ?, ?, ?, ?, 1, 0)"
                    );
                    if (!$ins) throw new Exception("DB Error (Google Insert): " . $conn->error);
                    $ins->bind_param("ssssis", $uname, $email, $passwordPlaceholder, $googleId, $emailVerified, $picture);
                }
                if (!$ins->execute()) {
                    sendResponse(['error' => 'Account creation failed: ' . $conn->error], 500);
                }
                $newId = $ins->insert_id;
                if ($hasMem && isset($applicationId)) {
                    $lnk = $conn->prepare("UPDATE membership_applications SET linked_user_id = ? WHERE id = ?");
                    if ($lnk) {
                        $lnk->bind_param("ii", $newId, $applicationId);
                        $lnk->execute();
                    }
                }
                $user = [
                    'id' => $newId, 'username' => $uname, 'email' => $email,
                    'google_id' => $googleId, 'google_picture' => $picture,
                    'email_verified' => $emailVerified, 'scan_limit' => 1,
                    'bonus_scans' => 0, 'paid_credits' => 0, 'scans_this_week' => 0,
                    'joined_date' => date('Y-m-d'),
                ];
            }
        }

        $totpOn = !empty($user['totp_enabled']);
        $hasGoogle = !empty($user['google_id']);
        $data = [
            'id'              => (int)$user['id'],
            'username'        => $user['username'],
            'email'           => $user['email'],
            'x_username'      => $user['x_username'] ?? '',
            'role'            => $user['role'] ?? 'user',
            'scan_limit'      => (int)($user['scan_limit'] ?? 1),
            'bonus_scans'     => (int)($user['bonus_scans'] ?? 0),
            'paid_credits'    => (int)($user['paid_credits'] ?? 0),
            'scans_this_week' => (int)($user['scans_this_week'] ?? 0),
            'scan_reset_date' => $user['scan_reset_date'] ?? null,
            'joinedDate'      => $user['joined_date'] ?? date('Y-m-d'),
            'google_id'       => $user['google_id'] ?? $googleId,
            'google_picture'  => $user['google_picture'] ?? $picture,
            'email_verified'  => (bool)($user['email_verified'] ?? true),
            'auth_method'     => 'google',
            'totp_enabled'    => $totpOn,
            'totp_remember_days' => (int)($user['totp_remember_days'] ?? 0),
        ];
        if ($totpOn && !$hasGoogle) {
            $data['requires_totp'] = true; // Force 2FA step this session
        }
        membership_enrich_user_payload($conn, $data);
        session_regenerate_id(true);
        $_SESSION['user'] = $data;
        sendResponse(['data' => $data]);
    }

    // ── GOOGLE LINK (logged-in user links a Google account from profile; email need not match, must not belong to another user/admin)
    else if ($action === 'google_link') {
        if (empty($_SESSION['user']['id'])) {
            sendResponse(['error' => 'Not logged in'], 401);
        }
        $currentUserId = (int)$_SESSION['user']['id'];
        $idToken = $input['credential'] ?? $input['id_token'] ?? '';
        if (!$idToken) {
            sendResponse(['error' => 'Missing Google credential'], 400);
        }
        $verifyUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($idToken);
        $ctx = stream_context_create(['http' => ['timeout' => 10]]);
        $raw = @file_get_contents($verifyUrl, false, $ctx);
        if (!$raw) {
            sendResponse(['error' => 'Failed to verify Google token'], 502);
        }
        $payload = json_decode($raw, true);
        if (empty($payload['sub']) || empty($payload['email'])) {
            sendResponse(['error' => 'Invalid Google token payload'], 401);
        }
        $aud = $payload['aud'] ?? '';
        if ($aud !== GOOGLE_CLIENT_ID) {
            sendResponse(['error' => 'Token audience mismatch'], 401);
        }
        $googleId = $payload['sub'];
        $email = filter_var($payload['email'], FILTER_SANITIZE_EMAIL);
        $picture = $payload['picture'] ?? '';

        $otherByGoogle = $conn->prepare("SELECT id FROM users WHERE google_id = ? AND id != ? LIMIT 1");
        $otherByGoogle->bind_param("si", $googleId, $currentUserId);
        $otherByGoogle->execute();
        if ($otherByGoogle->get_result()->num_rows > 0) {
            sendResponse(['error' => 'This Google account is already linked to another account.'], 400);
        }
        $otherByEmail = $conn->prepare("SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1");
        $otherByEmail->bind_param("si", $email, $currentUserId);
        $otherByEmail->execute();
        if ($otherByEmail->get_result()->num_rows > 0) {
            sendResponse(['error' => 'This email is already used by another account.'], 400);
        }
        $adminHasEmail = $conn->query("SHOW COLUMNS FROM `admins` LIKE 'email'");
        if ($adminHasEmail && $adminHasEmail->num_rows > 0) {
            $adm = $conn->prepare("SELECT id FROM admins WHERE email = ? LIMIT 1");
            if ($adm) {
                $adm->bind_param("s", $email);
                $adm->execute();
                if ($adm->get_result()->num_rows > 0) {
                    sendResponse(['error' => 'This email is already used by an admin.'], 400);
                }
            }
        }

        $upd = $conn->prepare("UPDATE users SET google_id = ?, google_picture = ?, email_verified = 1 WHERE id = ?");
        if (!$upd) sendResponse(['error' => 'Database error'], 500);
        $upd->bind_param("ssi", $googleId, $picture, $currentUserId);
        if (!$upd->execute()) sendResponse(['error' => 'Failed to link account'], 500);

        $stmt = $conn->prepare("SELECT id, username, email, x_username, scan_limit, bonus_scans, paid_credits, scans_this_week, scan_reset_date, joined_date, google_id, google_picture FROM users WHERE id = ?");
        $stmt->bind_param("i", $currentUserId);
        $stmt->execute();
        $user = $stmt->get_result()->fetch_assoc();
        if (!$user) sendResponse(['error' => 'User not found'], 500);
        $hasPurchased = false;
        $checkStmt = $conn->prepare("SELECT 1 FROM scan_transactions WHERE user_id = ? AND status = 'paid' LIMIT 1");
        if ($checkStmt) {
            $checkStmt->bind_param("i", $currentUserId);
            $checkStmt->execute();
            if ($checkStmt->get_result()->num_rows > 0) $hasPurchased = true;
            $checkStmt->close();
        }
        $totpColCheck = $conn->query("SHOW COLUMNS FROM `users` LIKE 'totp_enabled'");
        $hasTotpCol = $totpColCheck && $totpColCheck->num_rows > 0;
        $totpRememberCol = $conn->query("SHOW COLUMNS FROM `users` LIKE 'totp_remember_days'");
        $hasTotpRememberCol = $totpRememberCol && $totpRememberCol->num_rows > 0;
        $totpEnabled = false;
        $totpRememberDays = 0;
        if ($hasTotpCol) {
            $tStmt = $conn->prepare("SELECT totp_enabled, totp_remember_days FROM users WHERE id = ? LIMIT 1");
            $tStmt->bind_param("i", $currentUserId);
            $tStmt->execute();
            $tRow = $tStmt->get_result()->fetch_assoc();
            $totpEnabled = !empty($tRow['totp_enabled']);
            $totpRememberDays = ($hasTotpRememberCol && isset($tRow['totp_remember_days'])) ? (int)$tRow['totp_remember_days'] : 0;
        }
        $data = [
            'id' => (int)$user['id'],
            'username' => $user['username'],
            'email' => $user['email'],
            'x_username' => $user['x_username'] ?? '',
            'role' => $_SESSION['user']['role'] ?? 'user',
            'scan_limit' => (int)$user['scan_limit'],
            'bonus_scans' => (int)($user['bonus_scans'] ?? 0),
            'paid_credits' => (int)($user['paid_credits'] ?? 0),
            'scans_this_week' => (int)($user['scans_this_week'] ?? 0),
            'scan_reset_date' => $user['scan_reset_date'] ?? null,
            'joinedDate' => $user['joined_date'] ?? date('Y-m-d'),
            'has_purchased_credits' => $hasPurchased,
            'google_id' => $user['google_id'] ?? null,
            'google_picture' => $user['google_picture'] ?? null,
            'totp_enabled' => $totpEnabled,
            'totp_remember_days' => $totpRememberDays,
        ];
        $_SESSION['user'] = array_merge($_SESSION['user'], $data);
        sendResponse(['data' => $data]);
    }

    // ── 2FA TOTP (Google Authenticator) ─────────────────────────────
    else if ($action === 'totp_setup') {
        if (empty($_SESSION['user']['id'])) sendResponse(['error' => 'Not logged in'], 401);
        $userId = (int)$_SESSION['user']['id'];
        $email  = $_SESSION['user']['email'] ?? '';
        $secret = totp_generate_secret();
        $stmt = $conn->prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?");
        $stmt->bind_param("si", $secret, $userId);
        if (!$stmt->execute()) sendResponse(['error' => 'Failed to save secret'], 500);
        $label = $email ?: ('user' . $userId);
        $qr_uri = totp_get_uri($secret, $label, 'RawGraded');
        sendResponse(['data' => ['secret' => $secret, 'qr_uri' => $qr_uri]]);
    }
    else if ($action === 'totp_verify_setup') {
        if (empty($_SESSION['user']['id'])) sendResponse(['error' => 'Not logged in'], 401);
        $userId = (int)$_SESSION['user']['id'];
        $code   = trim($input['code'] ?? '');
        if (!$code) sendResponse(['error' => 'Enter the 6-digit code from your app'], 400);
        $stmt = $conn->prepare("SELECT totp_secret FROM users WHERE id = ? LIMIT 1");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        if (!$row || empty($row['totp_secret'])) sendResponse(['error' => 'Run 2FA setup first'], 400);
        if (!totp_verify($row['totp_secret'], $code)) sendResponse(['error' => 'Invalid code. Try again.'], 400);
        $upd = $conn->prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?");
        if (!$upd) sendResponse(['error' => 'Database error (run totp_setup.php on this server): ' . $conn->error], 500);
        $upd->bind_param("i", $userId);
        if (!$upd->execute()) sendResponse(['error' => 'Failed to save 2FA (run totp_setup.php on this server): ' . $conn->error], 500);
        $verify = $conn->query("SELECT totp_enabled FROM users WHERE id = " . (int)$userId);
        $vRow = $verify ? $verify->fetch_assoc() : null;
        if (!$vRow || empty($vRow['totp_enabled'])) {
            sendResponse(['error' => '2FA did not save. Run dist/api/totp_setup.php on this server once (as admin or CLI).'], 500);
        }
        $_SESSION['totp_verified'] = true;
        $_SESSION['totp_verified_at'] = time();
        $_SESSION['user']['totp_enabled'] = true;
        $sid = session_id();
        if ($conn->query("SHOW TABLES LIKE 'totp_verified_sessions'")->num_rows > 0) {
            $tblHasExpires = $conn->query("SHOW COLUMNS FROM totp_verified_sessions LIKE 'expires_at'")->num_rows > 0;
            if ($tblHasExpires) {
                $remCol = $conn->query("SHOW COLUMNS FROM users LIKE 'totp_remember_days'");
                $remRow = $conn->query("SELECT totp_remember_days FROM users WHERE id = " . (int)$userId);
                $remArr = $remRow ? $remRow->fetch_assoc() : null;
                $rememberDays = ($remCol && $remCol->num_rows > 0 && $remArr !== null) ? (int)($remArr['totp_remember_days'] ?? 0) : 0;
                $expSql = $rememberDays === 30 ? (string)(time() + 30 * 24 * 3600) : 'NULL';
                $sql = "INSERT INTO totp_verified_sessions (user_id, session_id, verified_at, expires_at) VALUES (?, ?, UNIX_TIMESTAMP(), $expSql) ON DUPLICATE KEY UPDATE verified_at = UNIX_TIMESTAMP(), expires_at = VALUES(expires_at)";
            } else {
                $sql = "INSERT INTO totp_verified_sessions (user_id, session_id, verified_at) VALUES (?, ?, UNIX_TIMESTAMP()) ON DUPLICATE KEY UPDATE verified_at = UNIX_TIMESTAMP()";
            }
            $ins = $conn->prepare($sql);
            if ($ins) { $ins->bind_param("is", $userId, $sid); $ins->execute(); }
        }
        $remCol = $conn->query("SHOW COLUMNS FROM users LIKE 'totp_remember_days'");
        $remRow = $conn->query("SELECT totp_remember_days FROM users WHERE id = " . (int)$userId);
        $remArr = $remRow ? $remRow->fetch_assoc() : null;
        $rememberDays = ($remCol && $remCol->num_rows > 0 && $remArr !== null) ? (int)($remArr['totp_remember_days'] ?? 0) : 0;
        $rememberToken = totp_remember_set($userId, $rememberDays, $conn);
        $userOut = $_SESSION['user'];
        $userOut['requires_totp'] = false;
        $userOut['totp_enabled'] = true;
        session_write_close();
        sendResponse(['data' => ['enabled' => true, 'user' => $userOut, 'remember_token' => $rememberToken]]);
    }
    else if ($action === 'totp_verify_login') {
        if (empty($_SESSION['user']['id'])) sendResponse(['error' => 'Not logged in'], 401);
        $userId = (int)$_SESSION['user']['id'];
        $code   = trim($input['code'] ?? '');
        if (!$code) sendResponse(['error' => 'Enter the 6-digit code'], 400);
        $stmt = $conn->prepare("SELECT totp_secret FROM users WHERE id = ? AND totp_enabled = 1 LIMIT 1");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        if (!$row || empty($row['totp_secret'])) sendResponse(['error' => '2FA not enabled for this account'], 400);
        if (!totp_verify($row['totp_secret'], $code)) sendResponse(['error' => 'Invalid code. Try again.'], 400);
        $_SESSION['totp_verified'] = true;
        $_SESSION['totp_verified_at'] = time();
        $sid = session_id();
        $remCol = $conn->query("SHOW COLUMNS FROM users LIKE 'totp_remember_days'");
        $remRow = $conn->query("SELECT totp_remember_days FROM users WHERE id = " . (int)$userId);
        $remArr = $remRow ? $remRow->fetch_assoc() : null;
        $rememberDays = ($remCol && $remCol->num_rows > 0 && $remArr !== null) ? (int)($remArr['totp_remember_days'] ?? 0) : 0;
        if ($conn->query("SHOW TABLES LIKE 'totp_verified_sessions'")->num_rows > 0) {
            $tblHasExpires = $conn->query("SHOW COLUMNS FROM totp_verified_sessions LIKE 'expires_at'")->num_rows > 0;
            if ($tblHasExpires) {
                $expSql = $rememberDays === 30 ? (string)(time() + 30 * 24 * 3600) : 'NULL';
                $sql = "INSERT INTO totp_verified_sessions (user_id, session_id, verified_at, expires_at) VALUES (?, ?, UNIX_TIMESTAMP(), $expSql) ON DUPLICATE KEY UPDATE verified_at = UNIX_TIMESTAMP(), expires_at = VALUES(expires_at)";
            } else {
                $sql = "INSERT INTO totp_verified_sessions (user_id, session_id, verified_at) VALUES (?, ?, UNIX_TIMESTAMP()) ON DUPLICATE KEY UPDATE verified_at = UNIX_TIMESTAMP()";
            }
            $ins = $conn->prepare($sql);
            if ($ins) { $ins->bind_param("is", $userId, $sid); $ins->execute(); }
        }
        $rememberToken = totp_remember_set($userId, $rememberDays, $conn);
        $userOut = $_SESSION['user'];
        $userOut['requires_totp'] = false;
        if (!isset($userOut['totp_enabled'])) $userOut['totp_enabled'] = true;
        session_write_close();
        sendResponse(['data' => ['verified' => true, 'user' => $userOut, 'remember_token' => $rememberToken]]);
    }
    else if ($action === 'totp_set_remember') {
        if (empty($_SESSION['user']['id'])) sendResponse(['error' => 'Not logged in'], 401);
        $userId = (int)$_SESSION['user']['id'];
        $days = isset($input['remember_days']) ? (int)$input['remember_days'] : -1;
        if ($days !== 0 && $days !== 30) sendResponse(['error' => 'remember_days must be 0 (until logout) or 30'], 400);
        $colCheck = $conn->query("SHOW COLUMNS FROM `users` LIKE 'totp_remember_days'");
        if (!$colCheck || $colCheck->num_rows === 0) sendResponse(['error' => '2FA remember preference not available on this server'], 500);
        $upd = $conn->prepare("UPDATE users SET totp_remember_days = ? WHERE id = ?");
        $upd->bind_param("ii", $days, $userId);
        if (!$upd->execute()) sendResponse(['error' => 'Failed to save preference'], 500);
        $_SESSION['user']['totp_remember_days'] = $days;
        if ($conn->query("SHOW TABLES LIKE 'totp_verified_sessions'")->num_rows > 0 && $conn->query("SHOW COLUMNS FROM totp_verified_sessions LIKE 'expires_at'")->num_rows > 0) {
            $sid = session_id();
            $expVal = $days === 30 ? (time() + 30 * 24 * 3600) : null;
            $expSql = $expVal === null ? 'NULL' : (string)(int)$expVal;
            $conn->query("UPDATE totp_verified_sessions SET expires_at = $expSql WHERE user_id = $userId AND session_id = '" . $conn->real_escape_string($sid) . "'");
        }
        sendResponse(['data' => ['totp_remember_days' => $days]]);
    }
    else if ($action === 'totp_disable') {
        if (empty($_SESSION['user']['id'])) sendResponse(['error' => 'Not logged in'], 401);
        $userId = (int)$_SESSION['user']['id'];
        $code   = trim($input['code'] ?? '');
        if (!$code) sendResponse(['error' => 'Enter your current 6-digit code to disable 2FA'], 400);
        $stmt = $conn->prepare("SELECT totp_secret FROM users WHERE id = ? AND totp_enabled = 1 LIMIT 1");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        if (!$row || empty($row['totp_secret'])) sendResponse(['error' => '2FA is not enabled'], 400);
        if (!totp_verify($row['totp_secret'], $code)) sendResponse(['error' => 'Invalid code'], 400);
        $upd = $conn->prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?");
        $upd->bind_param("i", $userId);
        $upd->execute();
        unset($_SESSION['totp_verified'], $_SESSION['totp_verified_at']);
        totp_remember_clear($userId, $conn);
        if ($conn->query("SHOW TABLES LIKE 'totp_verified_sessions'")->num_rows > 0) {
            $del = $conn->prepare("DELETE FROM totp_verified_sessions WHERE user_id = ?");
            if ($del) { $del->bind_param("i", $userId); $del->execute(); }
        }
        totp_cookie_clear();
        sendResponse(['data' => ['enabled' => false]]);
    }
    else if ($action === 'totp_status') {
        if (empty($_SESSION['user']['id'])) sendResponse(['error' => 'Not logged in'], 401);
        $userId = (int)$_SESSION['user']['id'];
        $colCheck = $conn->query("SHOW COLUMNS FROM `users` LIKE 'totp_remember_days'");
        $cols = 'totp_enabled';
        if ($colCheck && $colCheck->num_rows > 0) $cols .= ', totp_remember_days';
        $stmt = $conn->prepare("SELECT $cols FROM users WHERE id = ? LIMIT 1");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        $out = ['totp_enabled' => !empty($row['totp_enabled'])];
        if (isset($row['totp_remember_days'])) $out['totp_remember_days'] = (int)$row['totp_remember_days'];
        sendResponse(['data' => $out]);
    }

    // ── REQUEST PASSWORD RESET ───────────────────────────────────
    // Generates a secure token and sends a reset email.
    else if ($action === 'request_password_reset') {
        $email = filter_var($input['email'] ?? '', FILTER_SANITIZE_EMAIL);
        if (!$email) sendResponse(['error' => 'Email is required'], 400);

        // Always respond success to prevent email enumeration
        $stmt = $conn->prepare("SELECT id FROM users WHERE email = ? LIMIT 1");
        $stmt->bind_param("s", $email);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();

        if ($row) {
            $userId  = $row['id'];
            $token   = bin2hex(random_bytes(32));
            $expires = date('Y-m-d H:i:s', strtotime('+1 hour'));

            $upd = $conn->prepare("UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?");
            $upd->bind_param("ssi", $token, $expires, $userId);
            $upd->execute();

            $resetLink = APP_URL . '/reset-password?token=' . $token;
            $subject   = APP_NAME . ' — Password Reset Request';
            $body      = "Hi,\n\nA password reset was requested for your account.\n\n"
                       . "Reset link (valid 1 hour):\n" . $resetLink . "\n\n"
                       . "If you did not request this, ignore this email.\n\n— " . APP_NAME;
            $headers   = "From: noreply@rawgraded.com\r\nX-Mailer: PHP/" . phpversion();
            @mail($email, $subject, $body, $headers);
        }

        sendResponse(['success' => true, 'message' => 'If that email exists, a reset link has been sent.']);
    }

    // ── CONFIRM PASSWORD RESET ───────────────────────────────────
    // Validates the reset token and sets the new password.
    else if ($action === 'confirm_password_reset') {
        $token    = $input['token'] ?? '';
        $password = $input['password'] ?? '';

        if (!$token || strlen($password) < 8) {
            sendResponse(['error' => 'Token and a password of at least 8 characters are required'], 400);
        }

        $now  = date('Y-m-d H:i:s');
        $stmt = $conn->prepare("SELECT id FROM users WHERE reset_token = ? AND reset_expires > ? LIMIT 1");
        $stmt->bind_param("ss", $token, $now);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();

        if (!$row) sendResponse(['error' => 'Invalid or expired reset link. Please request a new one.'], 400);

        $hashed = password_hash($password, PASSWORD_DEFAULT);
        $upd    = $conn->prepare("UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?");
        $upd->bind_param("si", $hashed, $row['id']);
        $upd->execute();

        sendResponse(['success' => true, 'message' => 'Password updated. You can now log in.']);
    }

    // ── VERIFY EMAIL ─────────────────────────────────────────────
    // Called when user clicks link in verification email.
    else if ($action === 'verify_email') {
        $token = $input['token'] ?? $_GET['token'] ?? '';
        if (!$token) sendResponse(['error' => 'Verification token is required'], 400);

        $stmt = $conn->prepare("SELECT id FROM users WHERE email_token = ? AND email_verified = 0 LIMIT 1");
        $stmt->bind_param("s", $token);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();

        if (!$row) sendResponse(['error' => 'Invalid or already used verification token.'], 400);

        $upd = $conn->prepare("UPDATE users SET email_verified = 1, email_token = NULL WHERE id = ?");
        $upd->bind_param("i", $row['id']);
        $upd->execute();

        if (isset($_SESSION['user']) && $_SESSION['user']['id'] === $row['id']) {
            $_SESSION['user']['email_verified'] = true;
        }

        sendResponse(['success' => true, 'message' => 'Email verified! You can now use all features.']);
    }

    else {
        sendResponse(['error' => 'Invalid action'], 400);
    }

} catch (Exception $e) {
    sendResponse(['error' => 'Exception: ' . $e->getMessage()], 500);
} catch (Error $e) {
    sendResponse(['error' => 'Fatal: ' . $e->getMessage()], 500);
}
