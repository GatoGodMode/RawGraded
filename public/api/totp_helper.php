<?php
/**
 * TOTP helper for Google Authenticator–compatible 2FA. No composer dependency.
 * RFC 6238 / base32 secret.
 */
if (!function_exists('totp_base32_decode')) {
    function totp_base32_decode($input) {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $input = strtoupper(preg_replace('/=+$/', '', $input));
        $len = strlen($input);
        $buf = 0;
        $bits = 0;
        $out = '';
        for ($i = 0; $i < $len; $i++) {
            $pos = strpos($alphabet, $input[$i]);
            if ($pos === false) return false;
            $buf = ($buf << 5) | $pos;
            $bits += 5;
            if ($bits >= 8) {
                $bits -= 8;
                $out .= chr(($buf >> $bits) & 0xff);
            }
        }
        return $out;
    }
}

if (!function_exists('totp_base32_encode')) {
    function totp_base32_encode($input) {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $out = '';
        $buf = 0;
        $bits = 0;
        $len = strlen($input);
        for ($i = 0; $i < $len; $i++) {
            $buf = ($buf << 8) | (ord($input[$i]) & 0xff);
            $bits += 8;
            while ($bits >= 5) {
                $bits -= 5;
                $out .= $alphabet[($buf >> $bits) & 31];
            }
        }
        if ($bits > 0) $out .= $alphabet[($buf << (5 - $bits)) & 31];
        return $out;
    }
}

if (!function_exists('totp_generate_secret')) {
    /** Returns a new base32-encoded 160-bit secret (e.g. for Google Authenticator). */
    function totp_generate_secret($bytes = 20) {
        $raw = random_bytes($bytes);
        return totp_base32_encode($raw);
    }
}

if (!function_exists('totp_verify')) {
    /**
     * Verify a 6-digit TOTP code. Uses 30s window; allows ±1 window for clock drift.
     * @param string $secretBase32 Base32-encoded secret
     * @param string $code 6-digit code from app
     * @param int $window Number of 30s steps to allow on each side (default 1)
     * @return bool
     */
    function totp_verify($secretBase32, $code, $window = 1) {
        $secret = totp_base32_decode($secretBase32);
        if ($secret === false || strlen($secret) < 8) return false;
        $code = preg_replace('/\D/', '', $code);
        if (strlen($code) !== 6) return false;
        $time = time() / 30;
        $floor = floor($time);
        for ($i = -$window; $i <= $window; $i++) {
            $counter = pack('N*', 0) . pack('N', $floor + $i);
            $hash = hash_hmac('sha1', $counter, $secret, true);
            $offset = ord(substr($hash, -1)) & 0x0f;
            $truncated = (
                ((ord($hash[$offset]) & 0x7f) << 24) |
                ((ord($hash[$offset + 1]) & 0xff) << 16) |
                ((ord($hash[$offset + 2]) & 0xff) << 8) |
                (ord($hash[$offset + 3]) & 0xff)
            );
            $expected = str_pad((string)($truncated % 1000000), 6, '0', STR_PAD_LEFT);
            if (hash_equals($expected, $code)) return true;
        }
        return false;
    }
}

if (!function_exists('totp_get_uri')) {
    /** otpauth:// URI for QR code (issuer and label are URL-encoded). */
    function totp_get_uri($secretBase32, $label, $issuer = 'RawGraded') {
        $params = http_build_query(['secret' => $secretBase32, 'issuer' => $issuer], '', '&', PHP_QUERY_RFC3986);
        return 'otpauth://totp/' . rawurlencode($issuer) . ':' . rawurlencode($label) . '?' . $params;
    }
}
