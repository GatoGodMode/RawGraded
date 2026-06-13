<?php
header('Content-Type: text/plain');
echo "Absolute Path to Cron Script:\n";
echo __DIR__ . '/cron_weekly_refresh.php' . "\n\n";

echo "Recommended Cron Command:\n";
echo "/usr/local/bin/php " . __DIR__ . "/cron_weekly_refresh.php\n";
?>
