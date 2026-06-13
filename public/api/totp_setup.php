<?php
/**
 * totp_setup.php - Isolated migration for 2FA (TOTP) columns on users.
 * Run once (admin or CLI) to add totp_secret and totp_enabled.
 */
ob_start();
header('Content-Type: application/json');
require_once('db.php');

if (php_sapi_name() !== 'cli') {
    requireAdmin();
}

$results = [];

$columns = [
    'totp_secret'       => "VARCHAR(64) DEFAULT NULL COMMENT 'Base32 TOTP secret for Google Authenticator'",
    'totp_enabled'      => "TINYINT(1) DEFAULT 0 COMMENT '1 = 2FA required at login'",
    'totp_remember_days' => "INT(11) DEFAULT 0 COMMENT '0=remember until logout, 30=require 2FA every 30 days'",
];

foreach ($columns as $name => $defn) {
    $check = $conn->query("SHOW COLUMNS FROM `users` LIKE '$name'");
    if ($check && $check->num_rows === 0) {
        if ($conn->query("ALTER TABLE `users` ADD COLUMN `$name` $defn") === true) {
            $results[] = "Added column: $name";
        } else {
            $results[] = "Error adding $name: " . $conn->error;
        }
    } else {
        $results[] = "Column $name already exists";
    }
}

// Table to persist 2FA verification per (user_id, session_id). expires_at NULL = until logout; set = require 2FA again after that time.
$tableName = 'totp_verified_sessions';
$tableCheck = $conn->query("SHOW TABLES LIKE '$tableName'");
if (!$tableCheck || $tableCheck->num_rows === 0) {
    $sql = "CREATE TABLE `$tableName` (
        `user_id` INT(11) UNSIGNED NOT NULL,
        `session_id` VARCHAR(128) NOT NULL,
        `verified_at` INT(11) UNSIGNED NOT NULL,
        `expires_at` INT(11) UNSIGNED NULL DEFAULT NULL COMMENT 'NULL=until logout, else unix ts',
        PRIMARY KEY (`user_id`, `session_id`),
        KEY `verified_at` (`verified_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
    if ($conn->query($sql) === true) {
        $results[] = "Created table: $tableName";
    } else {
        $results[] = "Error creating $tableName: " . $conn->error;
    }
} else {
    $results[] = "Table $tableName already exists";
}
$expiresCol = $conn->query("SHOW COLUMNS FROM `$tableName` LIKE 'expires_at'");
if ($expiresCol && $expiresCol->num_rows === 0) {
    if ($conn->query("ALTER TABLE `$tableName` ADD COLUMN `expires_at` INT(11) UNSIGNED NULL DEFAULT NULL COMMENT 'NULL=until logout' AFTER `verified_at`") === true) {
        $results[] = "Added column: $tableName.expires_at";
    } else {
        $results[] = "Error adding expires_at: " . $conn->error;
    }
}

// Table for 2FA "remember" token (cookie-based, works across session ID changes / load balancer)
$tableName2 = 'totp_remember_tokens';
$tableCheck2 = $conn->query("SHOW TABLES LIKE '$tableName2'");
if (!$tableCheck2 || $tableCheck2->num_rows === 0) {
    $sql2 = "CREATE TABLE `$tableName2` (
        `user_id` INT(11) UNSIGNED NOT NULL,
        `token_hash` VARCHAR(64) NOT NULL,
        `expires_at` INT(11) UNSIGNED NULL DEFAULT NULL,
        PRIMARY KEY (`user_id`, `token_hash`),
        KEY `expires_at` (`expires_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
    if ($conn->query($sql2) === true) {
        $results[] = "Created table: $tableName2";
    } else {
        $results[] = "Error creating $tableName2: " . $conn->error;
    }
} else {
    $results[] = "Table $tableName2 already exists";
}

echo json_encode([
    'status' => 'complete',
    'results' => $results
]);
