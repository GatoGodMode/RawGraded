<?php
require __DIR__ . '/public/api/db.php';
$conn->query("ALTER TABLE certificates ADD COLUMN IF NOT EXISTS is_holographic TINYINT(1) DEFAULT 0");
if ($conn->error) {
    echo "Error: " . $conn->error;
} else {
    echo "Success: is_holographic added to database.\n";
}
