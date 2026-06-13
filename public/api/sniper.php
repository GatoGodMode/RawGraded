<?php
/**
 * Sniper: listing assessment. action=assess — auth required; 1 pro credit per first run (non-admin); reassess no credit.
 */
require_once('db.php');
require_once(__DIR__ . '/membership.php');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$user = require_active_platform_membership($conn);
$userId = $user['id'];
$isAdmin = (isset($user['role']) && $user['role'] === 'admin');

$action = $_GET['action'] ?? '';
if ($action !== 'assess') {
    sendResponse(['error' => 'Invalid action'], 400);
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    sendResponse(['error' => 'Invalid input'], 400);
}

$images = $input['images'] ?? [];
$listedPrice = isset($input['listedPrice']) ? (float) $input['listedPrice'] : 0;
$shippingCost = isset($input['shippingCost']) ? (float) $input['shippingCost'] : 0;
$freeShipping = !empty($input['freeShipping']);
$title = trim((string) ($input['title'] ?? ''));
$reassess = !empty($input['reassess']);

if (!is_array($images) || count($images) < 1 || count($images) > 2) {
    sendResponse(['error' => 'Provide 1 or 2 images'], 400);
}

$deductCredit = !$reassess && !$isAdmin;
if ($deductCredit) {
    $stmt = $conn->prepare("UPDATE users SET paid_credits = paid_credits - 1 WHERE id = ? AND paid_credits > 0");
    $stmt->bind_param("s", $userId);
    $stmt->execute();
    if ($conn->affected_rows === 0) {
        sendResponse(['error' => 'Use a pro credit to run Sniper', 'code' => 'need_credit'], 402);
    }
}

// Gemini API key from settings
$geminiKey = '';
$stmtKey = $conn->prepare("SELECT `value` FROM settings WHERE `key` = 'gemini_api_key'");
if ($stmtKey && $stmtKey->execute()) {
    $row = $stmtKey->get_result()->fetch_assoc();
    if ($row && !empty($row['value'])) $geminiKey = $row['value'];
}
if ($geminiKey === '') {
    if ($deductCredit) {
        $refund = $conn->prepare("UPDATE users SET paid_credits = paid_credits + 1 WHERE id = ?");
        if ($refund) { $refund->bind_param("s", $userId); $refund->execute(); }
    }
    sendResponse(['error' => 'Sniper not configured'], 500);
}

$conditionContext = <<<TEXT
CONDITION (TCG-style): Near Mint (NM) = light play, max 3 pts; Lightly Played (LP) = max 6 pts; Moderately Played (MP) = max 12 pts; Heavily Played (HP) = max 24 pts. Consider centering, corners, edges, surface. Be strict: if listing says NM but you see wear, say so.
TEXT;

$totalCost = $listedPrice + ($freeShipping ? 0 : $shippingCost);
$freeLabel = $freeShipping ? 'yes' : 'no';
$prompt = $conditionContext . "\n\n";
$prompt .= "You are a decisive listing assessor. The user provided 1 or 2 photos of a card listing. Use the grading standards above to estimate condition.\n\n";
$prompt .= "REQUIRED: Determine if the card is holographic/foil (holofoil, reverse holo, galaxy, prism, or any reflective foil surface). Non-holo and holo have very different market values—you must state is_holographic and factor it into your verdict.\n\n";
$prompt .= "You are a discerning card-shopping expert. Use your knowledge of typical market prices for this card (and variant: holo vs non-holo) in the condition you see. Be decisive and use strict standards:\n";
$prompt .= "- snipe_spotted: Reserve for listings that are SERIOUSLY under market—a true snipe. The total price must be meaningfully below what this card routinely sells for in this condition (e.g. 20–30%+ under typical sold comps). Slightly under or \"a good deal\" is NOT a snipe; use potential_gem or fair instead.\n";
$prompt .= "- potential_gem: A good deal to a great deal—price is below or at the low end of market, condition supports the ask or better. Solid value. Not a steal of the century, but buyer is not overpaying.\n";
$prompt .= "- fair: Price is in line with what similar cards in this condition sell for. Not a steal, not a rip-off. Market rate.\n";
$prompt .= "- overpriced_or_misgraded: Price is above typical market for this condition, or the listing overstates condition (e.g. says NM but you see LP/MP). Do not hesitate when the numbers do not support the ask.\n\n";
$prompt .= "Do not be vague. Pick one verdict and support it with specific reasoning (condition, holo vs non-holo, and how the ask compares to typical market).\n\n";
$prompt .= "Listed price: " . $listedPrice . " USD. Shipping: " . $shippingCost . " USD (free shipping: " . $freeLabel . "). Total cost to buyer: " . $totalCost . " USD.\n";
if ($title !== '') $prompt .= "Listing title/context: " . $title . ".\n";
$prompt .= "\nOutput JSON only with these exact keys:\n";
$prompt .= "- is_holographic: boolean (true if the card has any holographic/foil/reflective surface)\n";
$prompt .= "- verdict: one of \"snipe_spotted\", \"potential_gem\", \"fair\", \"overpriced_or_misgraded\"\n";
$prompt .= "- condition_estimate: short phrase using NM/LP/MP/HP (e.g. \"We see LP\" or \"Listing says NM but we see MP\")\n";
$prompt .= "- reasoning: 2–4 sentences; mention holo vs non-holo, condition, and how price compares to market. Be specific.\n\nReturn only valid JSON, no markdown.";

$parts = [['text' => $prompt]];
foreach (array_slice($images, 0, 2) as $i => $b64) {
    $b64 = is_string($b64) ? preg_replace('/^data:image\/\w+;base64,/', '', $b64) : '';
    if ($b64 !== '') {
        $parts[] = ['inlineData' => ['mimeType' => 'image/jpeg', 'data' => $b64]];
    }
}

$payload = [
    'contents' => [['parts' => $parts]],
    'generationConfig' => [
        'responseMimeType' => 'application/json',
    ],
];

$url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' . urlencode($geminiKey);
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_TIMEOUT => 120,
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($response === false || $httpCode !== 200) {
    if ($deductCredit) {
        $refund = $conn->prepare("UPDATE users SET paid_credits = paid_credits + 1 WHERE id = ?");
        if ($refund) { $refund->bind_param("s", $userId); $refund->execute(); }
    }
    sendResponse(['error' => 'Assessment failed'], 502);
}

$data = json_decode($response, true);
$text = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';
if ($text === '') {
    if ($deductCredit) {
        $refund = $conn->prepare("UPDATE users SET paid_credits = paid_credits + 1 WHERE id = ?");
        if ($refund) { $refund->bind_param("s", $userId); $refund->execute(); }
    }
    sendResponse(['error' => 'No assessment result'], 502);
}

// Strip markdown code block if present
$text = preg_replace('/^```(?:json)?\s*/', '', $text);
$text = preg_replace('/\s*```$/', '', trim($text));
$first = strpos($text, '{');
$last = strrpos($text, '}');
if ($first !== false && $last !== false && $last >= $first) {
    $text = substr($text, $first, $last - $first + 1);
}
$parsed = json_decode($text, true);
if (!is_array($parsed)) {
    if ($deductCredit) {
        $refund = $conn->prepare("UPDATE users SET paid_credits = paid_credits + 1 WHERE id = ?");
        if ($refund) { $refund->bind_param("s", $userId); $refund->execute(); }
    }
    sendResponse(['error' => 'Invalid assessment response'], 502);
}

$verdict = $parsed['verdict'] ?? 'fair';
$allowed = ['snipe_spotted', 'potential_gem', 'fair', 'overpriced_or_misgraded'];
if (!in_array($verdict, $allowed, true)) $verdict = 'fair';

$out = [
    'verdict' => $verdict,
    'condition_estimate' => $parsed['condition_estimate'] ?? '',
    'reasoning' => $parsed['reasoning'] ?? '',
    'is_holographic' => isset($parsed['is_holographic']) ? (bool) $parsed['is_holographic'] : null,
];
if (isset($parsed['confidence'])) $out['confidence'] = (int) $parsed['confidence'];

if ($deductCredit) {
    $stmtCred = $conn->prepare("SELECT paid_credits FROM users WHERE id = ?");
    $stmtCred->bind_param("s", $userId);
    $stmtCred->execute();
    $r = $stmtCred->get_result()->fetch_assoc();
    if ($r !== null) $out['paid_credits'] = (int) $r['paid_credits'];
}

sendResponse($out);
