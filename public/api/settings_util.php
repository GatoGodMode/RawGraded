<?php
/**
 * Read operator secrets from the settings table (supports key/value and legacy setting_key schemas).
 * Never hardcode API keys in source — configure at deploy time via Admin in production.
 */
function readSetting($conn, $key) {
    if (!$conn || $key === '') {
        return '';
    }
    try {
        $hasKey = $conn->query("SHOW COLUMNS FROM `settings` LIKE 'key'")->num_rows > 0;
        $hasValue = $conn->query("SHOW COLUMNS FROM `settings` LIKE 'value'")->num_rows > 0;
        if ($hasKey && $hasValue) {
            $stmt = $conn->prepare("SELECT `value` FROM settings WHERE `key` = ? LIMIT 1");
            if ($stmt) {
                $stmt->bind_param('s', $key);
                $stmt->execute();
                $row = $stmt->get_result()->fetch_assoc();
                if ($row && isset($row['value']) && $row['value'] !== '') {
                    return (string) $row['value'];
                }
            }
        }
        $hasSettingKey = $conn->query("SHOW COLUMNS FROM `settings` LIKE 'setting_key'")->num_rows > 0;
        $hasSettingValue = $conn->query("SHOW COLUMNS FROM `settings` LIKE 'setting_value'")->num_rows > 0;
        if ($hasSettingKey && $hasSettingValue) {
            $stmt2 = $conn->prepare("SELECT `setting_value` FROM settings WHERE `setting_key` = ? LIMIT 1");
            if ($stmt2) {
                $stmt2->bind_param('s', $key);
                $stmt2->execute();
                $row2 = $stmt2->get_result()->fetch_assoc();
                if ($row2 && isset($row2['setting_value']) && $row2['setting_value'] !== '') {
                    return (string) $row2['setting_value'];
                }
            }
        }
    } catch (Throwable $e) {
        return '';
    }
    return '';
}
