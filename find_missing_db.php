<?php
echo "Current Directory: " . getcwd() . "\n";
echo "Scanning for db.php...\n";

$candidates = [
    'public/api/db.php',
    'api/db.php',
    'db.php',
    '../public/api/db.php',
    '../api/db.php',
    'html/public/api/db.php',
    'public_html/api/db.php'
];

$found = false;
foreach ($candidates as $path) {
    if (file_exists($path)) {
        echo "[FOUND] " . $path . " (Realpath: " . realpath($path) . ")\n";
        $found = true;
    } else {
        echo "[MISSING] " . $path . "\n";
    }
}

if (!$found) {
    echo "\nPerforming deep scan of current directory...\n";
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator('.'));
    foreach ($iterator as $file) {
        if ($file->getFilename() === 'db.php') {
            echo "[FOUND DEEP] " . $file->getPathname() . "\n";
        }
    }
}
?>
