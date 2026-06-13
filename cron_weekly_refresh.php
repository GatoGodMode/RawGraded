<?php
// cron_weekly_refresh.php
// Run this script once a week (e.g., Sunday midnight) via cron job.
// Command: php /path/to/cron_weekly_refresh.php

if (file_exists(__DIR__ . '/api/db.php')) {
    require_once __DIR__ . '/api/db.php';
} else {
    require_once __DIR__ . '/public/api/db.php';
}

// Security: CLI cron or authenticated admin session only
$isCli = php_sapi_name() === 'cli';
if (!$isCli) {
    requireAdmin();
}

echo "Starting Weekly Refresh...\n";

// 1. Reset 'scans_this_week' for ALL users
$resetSql = "UPDATE users SET scans_this_week = 0";
if ($conn->query($resetSql)) {
    echo "Reset scans_this_week for " . $conn->affected_rows . " users.\n";
} else {
    echo "Error resetting scans_this_week: " . $conn->error . "\n";
}

// 2. Ensure Regular Users have at least 1 scan limit
// We do NOT touch Admins (scan_limit > 1000 usually)
// We do NOT touch VIPs/Paid users if they have high limits (logic depends on your tiers)
// For this request: "Start with 1 free scan, weekly refresh"
// This implies we should ensure everyone (except admins/special tiers) has *at least* 1 scan available.
// However, since we reset `scans_this_week` to 0, their effective available scans = (scan_limit + bonus_scans) - 0.
// So provided `scan_limit` is >= 1, they are good. 
// We just need to make sure no one has 0 scan_limit if they are supposed to have a free tier.

// Update users with < 1 scan_limit to 1 (Excluding admins who should have high limits anyway)
$topUpSql = "UPDATE users SET scan_limit = 1 WHERE scan_limit < 1 AND role != 'admin'";
if ($conn->query($topUpSql)) {
    echo "Topped up scan_limit to 1 for " . $conn->affected_rows . " users.\n";
} else {
    echo "Error topping up scan_limit: " . $conn->error . "\n";
}

// 3. Log the refresh
$date = date('Y-m-d H:i:s');
$conn->query("INSERT INTO settings (`key`, `value`) VALUES ('last_weekly_refresh', '$date') ON DUPLICATE KEY UPDATE `value` = '$date'");

echo "Weekly Refresh Complete.\n";
