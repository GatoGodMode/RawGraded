<?php
/**
 * Verify Stripe-Signature header (HMAC SHA256, v1).
 * @see https://docs.stripe.com/webhooks/signatures
 */
function verifyStripeWebhookSignature($payload, $sigHeader, $secret, $toleranceSeconds = 300) {
    if ($payload === '' || $sigHeader === '' || $secret === '') {
        return false;
    }
    $timestamp = null;
    $signatures = [];
    foreach (explode(',', $sigHeader) as $part) {
        $part = trim($part);
        if (strpos($part, '=') === false) {
            continue;
        }
        [$name, $value] = explode('=', $part, 2);
        if ($name === 't') {
            $timestamp = $value;
        } elseif ($name === 'v1') {
            $signatures[] = $value;
        }
    }
    if ($timestamp === null || empty($signatures)) {
        return false;
    }
    if (abs(time() - (int) $timestamp) > $toleranceSeconds) {
        return false;
    }
    $signed = $timestamp . '.' . $payload;
    $expected = hash_hmac('sha256', $signed, $secret);
    foreach ($signatures as $sig) {
        if (hash_equals($expected, $sig)) {
            return true;
        }
    }
    return false;
}
