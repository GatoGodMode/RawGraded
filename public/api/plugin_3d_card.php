<?php
// plugin_3d_card.php
// -------------------
// Public 3D card viewer support.
// - Stores an AI-generated low-res height grid in certificates.{three_d_height_grid_json,three_d_height_grid_meta}
// - Client converts height grid -> normal map for rendering (keeps artifacts small and compute cheap)
// - Supports shareable public links via three_d_shares tokens.

require_once('db.php');
header('Content-Type: application/json; charset=UTF-8');

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $_GET['action'] ?? ($input['action'] ?? '');

// Safe when migration not applied yet (see db.php HAS_HOLOGRAPHIC_COL).
$sql_holo_cert = HAS_HOLOGRAPHIC_COL ? 'COALESCE(is_holographic, 0) AS is_holographic,' : '0 AS is_holographic,';
$sql_holo_c = HAS_HOLOGRAPHIC_COL ? 'COALESCE(c.is_holographic, 0) AS is_holographic,' : '0 AS is_holographic,';
$sql_hp_cert = (defined('HAS_HOLO_PATTERN_COL') && HAS_HOLO_PATTERN_COL) ? "COALESCE(holo_pattern, 'none') AS holo_pattern," : "'none' AS holo_pattern,";
$sql_hp_c = (defined('HAS_HOLO_PATTERN_COL') && HAS_HOLO_PATTERN_COL) ? "COALESCE(c.holo_pattern, 'none') AS holo_pattern," : "'none' AS holo_pattern,";

function read_json_param($arr, string $key, $default = null) {
    return array_key_exists($key, $arr) ? $arr[$key] : $default;
}

function safe_nonempty_string($v): string {
    if ($v === null) return '';
    if (is_string($v)) return trim($v);
    if (is_int($v) || is_float($v) || is_bool($v)) return trim((string)$v);
    return '';
}

function normalize_height_grid_payload($heightGrid) {
    // Accept either a 2D array (NxN) or a flat array with {size}.
    // We keep validation intentionally strict so a malformed payload doesn't explode storage.
    if (!is_array($heightGrid)) return null;

    // Detect 2D
    $is2d = isset($heightGrid[0]) && is_array($heightGrid[0]);
    if ($is2d) {
        $n = count($heightGrid);
        if ($n < 8 || $n > 64) return null;
        foreach ($heightGrid as $row) {
            if (!is_array($row) || count($row) !== $n) return null;
            foreach ($row as $v) {
                if (!is_numeric($v)) return null;
            }
        }
        return [
            'size' => $n,
            'flat' => array_map(fn($x) => (float)$x, array_reduce($heightGrid, function($carry, $row) {
                return array_merge($carry, $row);
            }, []))
        ];
    }

    // Flat array
    $flat = $heightGrid;
    if (count($flat) < 64 || count($flat) > 4096) return null;
    foreach ($flat as $v) {
        if (!is_numeric($v)) return null;
    }
    $len = count($flat);
    $n = (int)round(sqrt($len));
    if ($n * $n !== $len) return null;
    if ($n < 8 || $n > 64) return null;

    return [
        'size' => $n,
        'flat' => array_map(fn($x) => (float)$x, $flat)
    ];
}

function deduct_pro_credits_or_admin($conn, string $userId, int $amount): bool {
    // Requires auth already.
    // Admins are exempt.
    global $user;
    $isAdmin = ($user['role'] ?? 'user') === 'admin';
    if ($isAdmin) return true;

    $upd = $conn->prepare("UPDATE users SET paid_credits = paid_credits - ? WHERE id = ? AND paid_credits >= ?");
    if (!$upd) return false;
    $upd->bind_param("isi", $amount, $userId, $amount);
    $ok = $upd->execute();
    if (!$ok) return false;
    return $upd->affected_rows > 0;
}

if ($action === '' ) {
    sendResponse(['error' => 'Missing action'], 400);
}

// -------------------
// Auth-required actions
// -------------------
if (in_array($action, ['store_height_grid', 'get_height_grid', 'create_share_token', 'generate_micro_relief_height_grid'], true)) {
    $user = requireAuth();
    $userId = safe_nonempty_string($user['id'] ?? '');
    if ($userId === '') sendResponse(['error' => 'Authentication required'], 401);
}

if ($action === 'get_height_grid') {
    $certId = safe_nonempty_string($_GET['cert_id'] ?? ($input['cert_id'] ?? ''));
    if ($certId === '') sendResponse(['error' => 'cert_id required'], 400);

    $stmt = $conn->prepare("
        SELECT
            COALESCE(NULLIF(front_thumb, ''), front_img) AS front_texture,
            COALESCE(NULLIF(back_thumb, ''), back_img) AS back_texture,
            CASE WHEN front_thumb IS NOT NULL AND front_thumb != '' THEN 1 ELSE 0 END AS has_front_thumb,
            CASE WHEN back_thumb IS NOT NULL AND back_thumb != '' THEN 1 ELSE 0 END AS has_back_thumb,
            three_d_height_grid_json,
            three_d_height_grid_meta,
            {$sql_holo_cert}
            {$sql_hp_cert}
            year,
            card_set
        FROM certificates
        WHERE id = ? AND user_id = ?
        LIMIT 1
    ");
    if (!$stmt) sendResponse(['error' => 'Prepare failed'], 500);
    $stmt->bind_param("ss", $certId, $userId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    if (!$row) sendResponse(['error' => 'Certificate not found'], 404);

    $heightJson = $row['three_d_height_grid_json'];
    $has3d = $heightJson !== null && trim((string)$heightJson) !== '';

    sendResponse([
        'success' => true,
        'cert_id' => $certId,
        'has_3d' => $has3d,
        'front_texture' => $row['front_texture'] ?: '',
        'back_texture' => $row['back_texture'] ?: '',
        'height_grid_json' => $has3d ? $heightJson : null,
        'height_grid_meta' => $row['three_d_height_grid_meta'] ?: null,
        'is_holographic' => (int)($row['is_holographic'] ?? 0) === 1,
        'holo_pattern' => $row['holo_pattern'] ?? 'none',
        'has_front_thumb' => (int)($row['has_front_thumb'] ?? 0) === 1,
        'has_back_thumb' => (int)($row['has_back_thumb'] ?? 0) === 1,
        'year' => $row['year'] ?? '',
        'card_set' => $row['card_set'] ?? '',
    ]);
}

if ($action === 'generate_micro_relief_height_grid') {
    set_time_limit(180);
    // Keep this fixed to reduce payload/truncation risk.
    $size = 20;
    $expectedLen = $size * $size;

    $certId = safe_nonempty_string($_GET['cert_id'] ?? ($input['cert_id'] ?? ''));
    if ($certId === '') sendResponse(['error' => 'cert_id required'], 400);

    // Load textures server-side to keep the browser request tiny on shared hosts.
    $stmt = $conn->prepare("
        SELECT
            COALESCE(NULLIF(front_thumb, ''), front_img) AS front_texture,
            COALESCE(NULLIF(back_thumb, ''), back_img) AS back_texture
        FROM certificates
        WHERE id = ? AND user_id = ?
        LIMIT 1
    ");
    if (!$stmt) sendResponse(['error' => 'Prepare failed'], 500);
    $stmt->bind_param("ss", $certId, $userId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    if (!$row) sendResponse(['error' => 'Certificate not found'], 404);

    $front = $row['front_texture'] ?? '';
    $back = $row['back_texture'] ?? '';
    if (!is_string($front) || trim($front) === '') sendResponse(['error' => 'Missing front texture'], 400);
    if (!is_string($back) || trim($back) === '') $back = $front;

    // Gemini request helpers
    $cleanBase64 = function($data) {
        if (!is_string($data)) return '';
        $data = trim($data);
        if ($data === '') return '';
        if (strpos($data, ',') !== false) {
            return explode(',', $data, 2)[1];
        }
        return $data;
    };

    $detectMime = function($data): string {
        if (!is_string($data)) return 'image/jpeg';
        if (strpos($data, 'data:image/png') === 0 || stripos($data, 'image/png') !== false) return 'image/png';
        if (stripos($data, 'image/webp') !== false) return 'image/webp';
        return 'image/jpeg';
    };

    $frontMime = $detectMime($front);
    $backMime = $detectMime($back);
    $frontClean = $cleanBase64($front);
    $backClean = $cleanBase64($back);
    if ($frontClean === '' || $backClean === '') sendResponse(['error' => 'Invalid base64 image data'], 400);

    // Load Gemini API key from SQL (never expose to browser)
    $stmtKey = $conn->prepare("SELECT `value` FROM settings WHERE `key` = 'gemini_api_key' LIMIT 1");
    if (!$stmtKey) sendResponse(['error' => 'Prepare failed'], 500);
    $stmtKey->execute();
    $kr = $stmtKey->get_result()->fetch_assoc();
    $apiKey = ($kr && isset($kr['value'])) ? (string)$kr['value'] : '';
    if (trim($apiKey) === '') sendResponse(['error' => 'Gemini API key missing'], 500);

    $modelId = 'gemini-2.5-flash';
    $promptText = "
You are generating a low-resolution height field for a trading card surface.
Return ONLY valid JSON (no markdown, no code fences, no extra keys).
Values must be numbers in [0,1].

Return schema:
{
  \"size\": 20,
  \"height\": [ /* exactly 400 numbers */ ]
}
";

    $url = "https://generativelanguage.googleapis.com/v1beta/models/{$modelId}:generateContent?key=" . urlencode($apiKey);
    $requestBody = [
        'contents' => [
            [
                'role' => 'user',
                'parts' => [
                    ['text' => $promptText],
                    ['inlineData' => ['mimeType' => $frontMime, 'data' => $frontClean]],
                    ['inlineData' => ['mimeType' => $backMime, 'data' => $backClean]],
                ],
            ]
        ],
        'generationConfig' => [
            'responseMimeType' => 'application/json',
        ],
    ];

    $payloadJson = json_encode($requestBody, JSON_UNESCAPED_SLASHES);
    if ($payloadJson === false) sendResponse(['error' => 'Failed to build request'], 500);

    $resp = false;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) sendResponse(['error' => 'cURL init failed'], 500);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payloadJson);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 140);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);

        $resp = curl_exec($ch);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if ($resp === false) sendResponse(['error' => 'Gemini request failed: ' . $curlErr], 502);
    } else {
        $ctx = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => $payloadJson,
                'timeout' => 140,
            ],
        ]);
        $resp = @file_get_contents($url, false, $ctx);
        if ($resp === false) sendResponse(['error' => 'Gemini request failed (no cURL available)'], 502);
    }

    $respJson = json_decode($resp, true);
    if (!is_array($respJson)) sendResponse(['error' => 'Gemini invalid JSON response'], 502);

    $text = $respJson['candidates'][0]['content']['parts'][0]['text'] ?? '';
    if (!is_string($text) || trim($text) === '') sendResponse(['error' => 'Gemini empty text'], 502);

    // Parse: try strict JSON first, then fallback numeric extraction from `"height":[...]`.
    $extractJsonObject = function(string $t): string {
        $firstBrace = strpos($t, '{');
        $lastBrace = strrpos($t, '}');
        if ($firstBrace !== false && $lastBrace !== false && $lastBrace >= $firstBrace) {
            return substr($t, $firstBrace, $lastBrace - $firstBrace + 1);
        }
        // Strip code fences if present.
        $t = trim(preg_replace('/^```(json)?\\s*/i', '', $t));
        $t = preg_replace('/\\s*```$/', '', $t);
        return $t;
    };

    $cleanText = trim($text);
    $cleanJson = $extractJsonObject($cleanText);
    $parsed = json_decode($cleanJson, true);

    $height = array_fill(0, $expectedLen, 0);
    $found = false;

    if (is_array($parsed) && isset($parsed['height']) && is_array($parsed['height'])) {
        $h = $parsed['height'];
        $n = min(count($h), $expectedLen);
        for ($i = 0; $i < $n; $i++) {
            $v = $h[$i];
            if (is_numeric($v)) {
                $f = (float)$v;
                if ($f < 0) $f = 0;
                if ($f > 1) $f = 1;
                $height[$i] = $f;
                $found = true;
            }
        }
    }

    if (!$found) {
        // Fallback for truncated JSON: extract numbers from height region.
        $lower = strtolower($cleanText);
        $keyPos = strpos($lower, '"height"');
        if ($keyPos === false) sendResponse(['error' => 'Gemini output missing height array'], 502);

        $openPos = strpos($cleanText, '[', $keyPos);
        if ($openPos === false) sendResponse(['error' => 'Gemini height array missing ['], 502);

        $closePos = strpos($cleanText, ']', $openPos + 1);
        $heightRegion = ($closePos === false)
            ? substr($cleanText, $openPos + 1)
            : substr($cleanText, $openPos + 1, $closePos - $openPos - 1);

        preg_match_all('/-?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?/', $heightRegion, $m);
        $matches = $m[0] ?? [];
        if (!count($matches)) sendResponse(['error' => 'Gemini fallback parse found no numbers'], 502);

        $nums = [];
        foreach ($matches as $s) {
            if (is_numeric($s)) {
                $f = (float)$s;
                if ($f < 0) $f = 0;
                if ($f > 1) $f = 1;
                $nums[] = $f;
            }
        }
        if (!count($nums)) sendResponse(['error' => 'Gemini fallback parse invalid numbers'], 502);

        for ($i = 0; $i < $expectedLen; $i++) {
            $height[$i] = $nums[$i] ?? 0;
        }
    }

    sendResponse([
        'success' => true,
        'height_grid' => [
            'size' => $size,
            'height' => $height,
            'strength' => 1,
        ]
    ]);
}

if ($action === 'store_height_grid') {
    $certId = safe_nonempty_string($_GET['cert_id'] ?? ($input['cert_id'] ?? ''));
    $force = (bool)($input['force'] ?? false);

    if ($certId === '') sendResponse(['error' => 'cert_id required'], 400);
    $heightGrid = $input['height_grid'] ?? null;
    $heightGridMeta = $input['height_grid_meta'] ?? null;
    $category = $input['category'] ?? 'Pokemon';

    if (!is_array($heightGrid)) {
        // Accept JSON already-parsed or numeric arrays only.
        sendResponse(['error' => 'height_grid must be an array'], 400);
    }

    $normalized = normalize_height_grid_payload($heightGrid);
    if (!$normalized) sendResponse(['error' => 'Invalid height_grid payload'], 400);

    $existingCheck = $conn->prepare("SELECT three_d_height_grid_json FROM certificates WHERE id = ? AND user_id = ? LIMIT 1");
    $existingCheck->bind_param("ss", $certId, $userId);
    $existingCheck->execute();
    $existingRow = $existingCheck->get_result()->fetch_assoc();
    $alreadyHas = $existingRow && isset($existingRow['three_d_height_grid_json']) && trim((string)$existingRow['three_d_height_grid_json']) !== '';

    // If we already have it and not forced, don't charge.
    if ($alreadyHas && !$force) {
        $metaJson = is_string($heightGridMeta) ? $heightGridMeta : json_encode($heightGridMeta ?? new stdClass(), JSON_UNESCAPED_SLASHES);
        $heightJson = json_encode([
            'size' => $normalized['size'],
            'height' => $normalized['flat']
        ], JSON_UNESCAPED_SLASHES);

        $upd = $conn->prepare("UPDATE certificates SET three_d_height_grid_json = ?, three_d_height_grid_meta = ? WHERE id = ? AND user_id = ?");
        $upd->bind_param("ssss", $heightJson, $metaJson, $certId, $userId);
        $upd->execute();

        sendResponse(['success' => true, 'already_exists' => true, 'charged' => false, 'cert_id' => $certId]);
    }

    // Charge 2 Pro Credits per card generation (only if we didn't already have it)
    if (!deduct_pro_credits_or_admin($conn, $userId, 2)) {
        sendResponse(['error' => 'Insufficient Pro Credits', 'needed' => 2], 402);
    }

    $metaOut = is_string($heightGridMeta) ? $heightGridMeta : json_encode($heightGridMeta ?? [], JSON_UNESCAPED_SLASHES);
    $heightJson = json_encode([
        'size' => $normalized['size'],
        'height' => $normalized['flat']
    ], JSON_UNESCAPED_SLASHES);

    $upd = $conn->prepare("UPDATE certificates SET three_d_height_grid_json = ?, three_d_height_grid_meta = ? WHERE id = ? AND user_id = ?");
    if (!$upd) sendResponse(['error' => 'Prepare failed'], 500);
    $upd->bind_param("ssss", $heightJson, $metaOut, $certId, $userId);
    $upd->execute();

    $creditsRemaining = 0;
    $cr = $conn->prepare("SELECT paid_credits FROM users WHERE id = ? LIMIT 1");
    if ($cr) {
        $cr->bind_param("s", $userId);
        $cr->execute();
        $r = $cr->get_result()->fetch_assoc();
        $creditsRemaining = (int)($r['paid_credits'] ?? 0);
    }

    sendResponse(['success' => true, 'charged' => true, 'credits_remaining' => $creditsRemaining, 'cert_id' => $certId]);
}

if ($action === 'create_share_token') {
    $certId = safe_nonempty_string($_GET['cert_id'] ?? ($input['cert_id'] ?? ''));
    if ($certId === '') sendResponse(['error' => 'cert_id required'], 400);

    $check = $conn->prepare("SELECT three_d_height_grid_json FROM certificates WHERE id = ? AND user_id = ? LIMIT 1");
    $check->bind_param("ss", $certId, $userId);
    $check->execute();
    $row = $check->get_result()->fetch_assoc();
    if (!$row) sendResponse(['error' => 'Certificate not found'], 404);

    $heightJson = $row['three_d_height_grid_json'] ?? null;
    if ($heightJson === null || trim((string)$heightJson) === '') {
        sendResponse(['error' => '3D not generated for this card'], 400);
    }

    // Generate unguessable token and store mapping
    $token = bin2hex(random_bytes(24)); // 48 chars

    $ins = $conn->prepare("INSERT INTO three_d_shares (token, cert_id, user_id) VALUES (?, ?, ?)");
    if (!$ins) sendResponse(['error' => 'Prepare failed'], 500);
    $ins->bind_param("sss", $token, $certId, $userId);
    $ok = $ins->execute();

    if (!$ok) {
        // Rare collision; retry once
        $token = bin2hex(random_bytes(24));
        $ins2 = $conn->prepare("INSERT INTO three_d_shares (token, cert_id, user_id) VALUES (?, ?, ?)");
        $ins2->bind_param("sss", $token, $certId, $userId);
        $ins2->execute();
    }

    sendResponse([
        'success' => true,
        'token' => $token,
    ]);
}

// -------------------
// Public (no auth) endpoints
// -------------------
if (in_array($action, ['public_view', 'public_get_for_vault'], true)) {
    $token = safe_nonempty_string($_GET['token'] ?? ($input['token'] ?? ''));
    $vaultId = safe_nonempty_string($_GET['vault_id'] ?? ($input['vault_id'] ?? ''));
    $certId = safe_nonempty_string($_GET['cert_id'] ?? ($input['cert_id'] ?? ''));

    if ($action === 'public_view') {
        if ($token === '') sendResponse(['error' => 'token required'], 400);

        $stmt = $conn->prepare("
            SELECT
                s.cert_id,
                c.front_thumb,
                c.front_img,
                c.back_thumb,
                c.back_img,
                c.three_d_height_grid_json,
                c.three_d_height_grid_meta,
                {$sql_holo_c}
                {$sql_hp_c}
                c.year,
                c.card_set
            FROM three_d_shares s
            JOIN certificates c ON c.id = s.cert_id AND c.user_id = s.user_id
            WHERE s.token = ?
            LIMIT 1
        ");
        if (!$stmt) sendResponse(['error' => 'Prepare failed'], 500);
        $stmt->bind_param("s", $token);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        if (!$row) sendResponse(['error' => 'Share not found'], 404);

        $heightJson = $row['three_d_height_grid_json'] ?? null;
        if ($heightJson === null || trim((string)$heightJson) === '') {
            sendResponse(['error' => '3D not generated for this card'], 404);
        }

        $frontTexture = $row['front_thumb'] ?: $row['front_img'] ?: '';
        $backTexture = $row['back_thumb'] ?: $row['back_img'] ?: $frontTexture;

        sendResponse([
            'success' => true,
            'cert_id' => $row['cert_id'],
            'front_texture' => $frontTexture,
            'back_texture' => $backTexture,
            'height_grid_json' => $heightJson,
            'height_grid_meta' => $row['three_d_height_grid_meta'] ?: null,
            'is_holographic' => (int)($row['is_holographic'] ?? 0) === 1,
            'holo_pattern' => $row['holo_pattern'] ?? 'none',
            'year' => $row['year'] ?? '',
            'card_set' => $row['card_set'] ?? '',
        ]);
    }

    if ($action === 'public_get_for_vault') {
        if ($vaultId === '' || $certId === '') sendResponse(['error' => 'vault_id and cert_id required'], 400);

        $v = $conn->prepare("SELECT user_id FROM display_vaults WHERE id = ? LIMIT 1");
        $v->bind_param("s", $vaultId);
        $v->execute();
        $vRow = $v->get_result()->fetch_assoc();
        if (!$vRow) sendResponse(['error' => 'Vault not found'], 404);

        $vaultUserId = (string)($vRow['user_id'] ?? '');
        if ($vaultUserId === '') sendResponse(['error' => 'Vault invalid'], 404);

        // Verify cert is included in that vault (prevents random cert snooping)
        $inVault = $conn->prepare("
            SELECT 1
            FROM display_vault_items
            WHERE vault_id = ? AND item_type = 'certificate' AND item_id = ?
            LIMIT 1
        ");
        $inVault->bind_param("ss", $vaultId, $certId);
        $inVault->execute();
        $inRow = $inVault->get_result()->fetch_assoc();
        if (!$inRow) sendResponse(['error' => 'Certificate not in vault'], 403);

        $stmt = $conn->prepare("
            SELECT
                COALESCE(NULLIF(front_thumb, ''), front_img) AS front_texture,
                COALESCE(NULLIF(back_thumb, ''), back_img) AS back_texture,
                three_d_height_grid_json,
                three_d_height_grid_meta,
                {$sql_holo_cert}
                {$sql_hp_cert}
                year,
                card_set
            FROM certificates
            WHERE id = ? AND user_id = ?
            LIMIT 1
        ");
        $stmt->bind_param("ss", $certId, $vaultUserId);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        if (!$row) sendResponse(['error' => 'Certificate not found'], 404);

        $heightJson = $row['three_d_height_grid_json'] ?? null;
        $has3d = $heightJson !== null && trim((string)$heightJson) !== '';
        if (!$has3d) {
            sendResponse([
                'success' => true,
                'cert_id' => $certId,
                'has_3d' => false,
                'is_holographic' => (int)($row['is_holographic'] ?? 0) === 1,
                'holo_pattern' => $row['holo_pattern'] ?? 'none',
                'year' => $row['year'] ?? '',
                'card_set' => $row['card_set'] ?? '',
            ]);
        }

        sendResponse([
            'success' => true,
            'cert_id' => $certId,
            'has_3d' => true,
            'front_texture' => $row['front_texture'] ?: '',
            'back_texture' => $row['back_texture'] ?: ($row['front_texture'] ?: ''),
            'height_grid_json' => $heightJson,
            'height_grid_meta' => $row['three_d_height_grid_meta'] ?: null,
            'is_holographic' => (int)($row['is_holographic'] ?? 0) === 1,
            'holo_pattern' => $row['holo_pattern'] ?? 'none',
            'year' => $row['year'] ?? '',
            'card_set' => $row['card_set'] ?? '',
        ]);
    }
}

sendResponse(['error' => 'Invalid action'], 400);

?>

