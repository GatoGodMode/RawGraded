<?php
// plugin_remove_bg.php
// ----------------------
// remove.bg background removal: persists processed thumbnails into the vault.
// This makes remove.bg the primary display for My Vault + Display Vaults.

require_once('db.php');

$user = requireAuth();
$userId = (string)$user['id'];
$isAdmin = ($user['role'] ?? 'user') === 'admin';

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$certId = trim((string)($input['cert_id'] ?? ''));
$slabId = (int)($input['slab_id'] ?? 0);
$sides = $input['sides'] ?? ['front'];
$format = strtolower(trim((string)($input['format'] ?? 'png')));

if (!$certId && !$slabId) sendResponse(['error' => 'Missing cert_id or slab_id'], 400);

if (!is_array($sides)) $sides = ['front'];
$sides = array_values(array_filter($sides, function($s) {
    return in_array($s, ['front', 'back'], true);
}));
if (count($sides) < 1) sendResponse(['error' => 'Missing sides (front/back)'], 400);

$allowedFormats = ['png', 'webp'];
if (!in_array($format, $allowedFormats, true)) $format = 'png';

$ownerUserId = '';
$isAssessed = false;
$imageRow = [];

if ($slabId) {
    // 1a) Slab Ownership check + fetch images
    $stmt = $conn->prepare("SELECT user_id, auth_check_id, local_front_img, local_back_img, front_img_url FROM psa_slabs 
        LEFT JOIN (SELECT id as auth_check_id, psa_slab_id FROM slab_checks WHERE id IN (SELECT MAX(id) FROM slab_checks GROUP BY psa_slab_id)) sc ON sc.psa_slab_id = psa_slabs.id
        WHERE psa_slabs.id = ?");
    if (!$stmt) sendResponse(['error' => 'Prepare failed: ' . $conn->error], 500);
    $stmt->bind_param("i", $slabId);
    $stmt->execute();
    $res = $stmt->get_result();
    $row = $res->fetch_assoc();
    if (!$row) sendResponse(['error' => 'Slab not found'], 404);

    $ownerUserId = (string)($row['user_id'] ?? '');
    $isAssessed = !empty($row['auth_check_id']);
    
    // Fallback to front_img_url if local_front_img is empty
    $imageRow = [
        'front_thumb' => $row['local_front_img'] ?: $row['front_img_url'],
        'front_img' => $row['local_front_img'] ?: $row['front_img_url'],
        'back_thumb' => $row['local_back_img'],
        'back_img' => $row['local_back_img']
    ];
} else {
    // 1b) Certificate Ownership check + fetch images
    $stmt = $conn->prepare("SELECT user_id, overall_grade, front_thumb, front_img, back_thumb, back_img FROM certificates WHERE id = ?");
    if (!$stmt) sendResponse(['error' => 'Prepare failed: ' . $conn->error], 500);
    $stmt->bind_param("s", $certId);
    $stmt->execute();
    $res = $stmt->get_result();
    $row = $res->fetch_assoc();
    if (!$row) sendResponse(['error' => 'Certificate not found'], 404);

    $ownerUserId = (string)($row['user_id'] ?? '');
    $isAssessed = !($row['overall_grade'] === null || $row['overall_grade'] === '');
    $imageRow = $row;
}

if (!$isAdmin && $ownerUserId !== $userId) {
    sendResponse(['error' => 'Unauthorized'], 403);
}

// Pro credit check (admins are exempt)
if (!$isAdmin) {
    $qCredits = $conn->prepare("SELECT paid_credits FROM users WHERE id = ? LIMIT 1");
    if (!$qCredits) sendResponse(['error' => 'Prepare failed: ' . $conn->error], 500);
    $qCredits->bind_param("s", $userId);
    $qCredits->execute();
    $rCredits = $qCredits->get_result()->fetch_assoc();
    $paidCredits = $rCredits ? (int)($rCredits['paid_credits'] ?? 0) : 0;

    if ($paidCredits < 1) {
        sendResponse(['error' => 'Insufficient Pro Credits', 'needed' => 1], 402);
    }
}

// 2) Get remove.bg API key from settings table
// Some deployments use (`key`,`value`), others may use (`setting_key`,`setting_value`).
$removeBgKey = '';
try {
    $q1 = $conn->prepare("SELECT value FROM settings WHERE `key` = ? LIMIT 1");
    if ($q1) {
        $k = 'REMOVEBG_API_KEY';
        $q1->bind_param("s", $k);
        $q1->execute();
        $r1 = $q1->get_result()->fetch_assoc();
        if ($r1 && !empty($r1['value'])) $removeBgKey = $r1['value'];
    }
} catch (Throwable $e) { /* ignore */ }

if (empty($removeBgKey)) {
    try {
        $q2 = $conn->prepare("SELECT setting_value FROM settings WHERE `setting_key` = ? LIMIT 1");
        if ($q2) {
            $k = 'REMOVEBG_API_KEY';
            $q2->bind_param("s", $k);
            $q2->execute();
            $r2 = $q2->get_result()->fetch_assoc();
            if ($r2 && !empty($r2['setting_value'])) $removeBgKey = $r2['setting_value'];
        }
    } catch (Throwable $e) { /* ignore */ }
}

if (empty($removeBgKey)) {
    sendResponse([
        'error' => 'Server missing REMOVEBG_API_KEY in settings table.',
        'help' => 'Insert a row: (key=REMOVEBG_API_KEY, value=<your remove.bg API key>).'
    ], 500);
}

// 3) Helpers
function extractBase64Part($maybeDataUrl): ?string {
    if (!is_string($maybeDataUrl) || trim($maybeDataUrl) === '') return null;
    $s = trim($maybeDataUrl);

    if (strpos($s, 'data:') === 0) {
        $parts = explode(',', $s, 2);
        if (count($parts) === 2) return $parts[1];
        return null;
    }
    return $s;
}

function base64ToTempFile($base64, $mimeGuess = 'image/jpeg'): array {
    $bin = base64_decode($base64);
    if ($bin === false) throw new Exception('Base64 decode failed.');
    $ext = (strpos($mimeGuess, 'png') !== false) ? 'png' : ((strpos($mimeGuess, 'webp') !== false) ? 'webp' : 'jpg');
    $tmp = tempnam(sys_get_temp_dir(), 'rg_bg_') . '.' . $ext;
    file_put_contents($tmp, $bin);
    return [$tmp, $ext];
}

// If assessed cards were rendered with a red box/grid overlay, remove.bg will preserve it.
// This trims away the red border/line by detecting "red-ish" pixels near image edges.
function crop_out_red_box_if_present($imgResource): ?array {
    if (!$imgResource) return null;

    $w = imagesx($imgResource);
    $h = imagesy($imgResource);
    if ($w <= 20 || $h <= 20) return null;

    $edgeLimitX = (int)max(10, floor($w * 0.35));
    $edgeLimitY = (int)max(10, floor($h * 0.35));
    $step = (int)max(2, floor(min($w, $h) / 200));
    $redThresholdRatio = 0.015;
    $insetPx = (int)max(4, floor(min($w, $h) * 0.01));

    $isRedish = function(int $x, int $y) use ($imgResource): bool {
        $rgb = imagecolorat($imgResource, $x, $y);
        $r = ($rgb >> 16) & 0xFF;
        $g = ($rgb >> 8) & 0xFF;
        $b = $rgb & 0xFF;
        if ($r < 140) return false;
        if ($g > 130) return false;
        if ($b > 130) return false;
        $maxGB = max($g, $b);
        return ($r - $maxGB) > 45;
    };

    $findLeft = function() use ($w, $h, $edgeLimitX, $step, $redThresholdRatio, $isRedish): ?int {
        for ($x = 0; $x <= $edgeLimitX; $x += max(1, $step)) {
            $cnt = 0;
            $ys = 0;
            for ($y = 0; $y < $h; $y += $step) {
                $ys++;
                if ($isRedish($x, $y)) $cnt++;
            }
            $ratio = $cnt / max(1, $ys);
            if ($ratio >= $redThresholdRatio) return $x;
        }
        return null;
    };

    $findRight = function() use ($w, $h, $edgeLimitX, $step, $redThresholdRatio, $isRedish): ?int {
        for ($x = $w - 1; $x >= $w - $edgeLimitX; $x -= max(1, $step)) {
            $cnt = 0;
            $ys = 0;
            for ($y = 0; $y < $h; $y += $step) {
                $ys++;
                if ($isRedish($x, $y)) $cnt++;
            }
            $ratio = $cnt / max(1, $ys);
            if ($ratio >= $redThresholdRatio) return $x;
        }
        return null;
    };

    $findTop = function() use ($w, $h, $edgeLimitY, $step, $redThresholdRatio, $isRedish): ?int {
        for ($y = 0; $y <= $edgeLimitY; $y += max(1, $step)) {
            $cnt = 0;
            $xs = 0;
            for ($x = 0; $x < $w; $x += $step) {
                $xs++;
                if ($isRedish($x, $y)) $cnt++;
            }
            $ratio = $cnt / max(1, $xs);
            if ($ratio >= $redThresholdRatio) return $y;
        }
        return null;
    };

    $findBottom = function() use ($w, $h, $edgeLimitY, $step, $redThresholdRatio, $isRedish): ?int {
        for ($y = $h - 1; $y >= $h - $edgeLimitY; $y -= max(1, $step)) {
            $cnt = 0;
            $xs = 0;
            for ($x = 0; $x < $w; $x += $step) {
                $xs++;
                if ($isRedish($x, $y)) $cnt++;
            }
            $ratio = $cnt / max(1, $xs);
            if ($ratio >= $redThresholdRatio) return $y;
        }
        return null;
    };

    $left = $findLeft();
    $right = $findRight();
    $top = $findTop();
    $bottom = $findBottom();
    if ($left === null || $right === null || $top === null || $bottom === null) return null;
    if ($right <= $left + 2 || $bottom <= $top + 2) return null;

    $x = max(0, $left + $insetPx);
    $y = max(0, $top + $insetPx);
    $cw = min($w - $x, ($right - $left) - 2 * $insetPx);
    $ch = min($h - $y, ($bottom - $top) - 2 * $insetPx);
    // Safety: avoid aggressive cropping if the "red" detection accidentally matched artwork.
    if ($cw < 20 || $ch < 20) return null;
    if ($cw < $w * 0.5 || $ch < $h * 0.5) return null;

    return [$x, $y, $cw, $ch];
}

function crop_image_to_png($imgResource, array $cropRect): ?string {
    if (!$imgResource) return null;
    if (count($cropRect) !== 4) return null;
    [$x, $y, $cw, $ch] = $cropRect;
    $outW = (int)$cw;
    $outH = (int)$ch;
    if ($outW < 10 || $outH < 10) return null;

    $out = imagecreatetruecolor($outW, $outH);
    if (!$out) return null;

    imagealphablending($out, false);
    imagesavealpha($out, true);
    imagecopyresampled($out, $imgResource, 0, 0, (int)$x, (int)$y, $outW, $outH, (int)$cw, (int)$ch);

    $tmp = tempnam(sys_get_temp_dir(), 'rg_bg_crop_') . '.png';
    $ok = imagepng($out, $tmp);
    imagedestroy($out);
    if (!$ok || !file_exists($tmp)) return null;
    return $tmp;
}

// 4) Call remove.bg per side
$imagesOut = [];

foreach ($sides as $side) {
    $isFront = $side === 'front';

    // Use thumb when available; it’s faster and cheaper.
    $thumbKey = $isFront ? 'front_thumb' : 'back_thumb';
    $imgKey = $isFront ? 'front_img' : 'back_img';

    $srcBase64 = extractBase64Part($imageRow[$thumbKey] ?? '');
    $mimeGuess = 'image/jpeg';
    if (!$srcBase64) {
        $srcBase64 = extractBase64Part($imageRow[$imgKey] ?? '');
        // We still assume jpeg; remove.bg is tolerant.
        $mimeGuess = 'image/jpeg';
    }

    if (!$srcBase64) {
        continue; // omit missing side
    }

    $tmpFile = '';
    try {
        [$tmpFile, $ext] = base64ToTempFile($srcBase64, $mimeGuess);

        $postFile = null;
        $mimeForPost = $mimeGuess;

        // Pre-trim red box/border for assessed cards only.
        if ($isAssessed && function_exists('imagecreatefromstring')) {
            try {
                $bin = @file_get_contents($tmpFile);
                if ($bin !== false) {
                    $imgRes = @imagecreatefromstring($bin);
                    if ($imgRes) {
                        $cropRect = crop_out_red_box_if_present($imgRes);
                        if ($cropRect) {
                            $croppedTmp = crop_image_to_png($imgRes, $cropRect);
                            if ($croppedTmp) {
                                $tmpFile = $croppedTmp;
                                $mimeForPost = 'image/png';
                                $ext = 'png';
                            }
                        }
                        @imagedestroy($imgRes);
                    }
                }
            } catch (Throwable $e) {
                // ignore trim errors; still send original image to remove.bg
            }
        }

        $postFile = curl_file_create($tmpFile, $mimeForPost, 'upload.' . $ext);

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => 'https://api.remove.bg/v1.0/removebg',
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_CONNECTTIMEOUT => 20,
            CURLOPT_HTTPHEADER => [
                'X-Api-Key: ' . $removeBgKey,
            ],
            CURLOPT_POSTFIELDS => [
                'size' => 'auto',
                'format' => $format,
                'image_file' => $postFile
            ],
        ]);

        $bin = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($bin === false || $httpCode !== 200) {
            throw new Exception('remove.bg failed: HTTP ' . $httpCode . ' ' . $err);
        }

        $b64 = base64_encode($bin);
        $mimeOut = $format === 'webp' ? 'image/webp' : 'image/png';
        $imagesOut[$side] = 'data:' . $mimeOut . ';base64,' . $b64;
    } finally {
        if ($tmpFile && file_exists($tmpFile)) @unlink($tmpFile);
    }
}

if (count($imagesOut) < 1) {
    sendResponse(['error' => 'No source images available for requested sides'], 400);
}

// Deduct exactly 1 pro credit per successful run (front/back/both = single run)
$creditsRemaining = null;
if (!$isAdmin) {
    $upd = $conn->prepare("UPDATE users SET paid_credits = paid_credits - 1 WHERE id = ? AND paid_credits > 0");
    if (!$upd) sendResponse(['error' => 'Prepare failed: ' . $conn->error], 500);
    $upd->bind_param("s", $userId);
    $upd->execute();

    if ($upd->affected_rows < 1) {
        // Should be rare due to early check, but avoids double-charging / race conditions.
        sendResponse(['error' => 'Insufficient Pro Credits', 'needed' => 1], 402);
    }
}

// Persist processed results so My Vault + Display Vaults show cutouts as primary.
$persisted = false;
if (!$isAdmin) {
    // Non-admins can only ever update their own certificates (already checked above).
    // Keep the WHERE clause strict to avoid cross-user writes.
    $updateWhereUserId = $userId;
} else {
    // Admins may run against any certificate; still constrain by the certificate owner.
    $updateWhereUserId = $ownerUserId;
}

if (isset($imagesOut['front'])) {
    if ($slabId) {
        $uFront = $conn->prepare("UPDATE psa_slabs SET local_front_img = ? WHERE id = ? AND user_id = ?");
        if ($uFront) {
            $uFront->bind_param("ssi", $imagesOut['front'], $slabId, $updateWhereUserId);
            $uFront->execute();
            $persisted = true;
        }
    } else {
        $uFront = $conn->prepare("UPDATE certificates SET front_thumb = ? WHERE id = ? AND user_id = ?");
        if ($uFront) {
            $uFront->bind_param("sss", $imagesOut['front'], $certId, $updateWhereUserId);
            $uFront->execute();
            $persisted = true;
        }
    }
}

if (isset($imagesOut['back'])) {
    if ($slabId) {
        $uBack = $conn->prepare("UPDATE psa_slabs SET local_back_img = ? WHERE id = ? AND user_id = ?");
        if ($uBack) {
            $uBack->bind_param("ssi", $imagesOut['back'], $slabId, $updateWhereUserId);
            $uBack->execute();
            $persisted = true;
        }
    } else {
        $uBack = $conn->prepare("UPDATE certificates SET back_thumb = ? WHERE id = ? AND user_id = ?");
        if ($uBack) {
            $uBack->bind_param("sss", $imagesOut['back'], $certId, $updateWhereUserId);
            $uBack->execute();
            $persisted = true;
        }
    }
}

// Return latest remaining credits for UI refresh.
$qAfter = $conn->prepare("SELECT paid_credits FROM users WHERE id = ? LIMIT 1");
if ($qAfter) {
    $qAfter->bind_param("s", $userId);
    $qAfter->execute();
    $rAfter = $qAfter->get_result()->fetch_assoc();
    $creditsRemaining = $rAfter ? (int)($rAfter['paid_credits'] ?? 0) : 0;
}

sendResponse([
    'success' => true,
    'images' => $imagesOut,
    'cert_id' => $certId,
    'persisted' => $persisted,
    'credits_remaining' => $creditsRemaining
]);

?>

