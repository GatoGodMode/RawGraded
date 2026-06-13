<?php
require_once 'db.php';
header('Content-Type: application/json');

$action = $_GET['action'] ?? '';
$vault_sql_holo = HAS_HOLOGRAPHIC_COL ? 'COALESCE(is_holographic, 0) AS is_holographic' : '0 AS is_holographic';
$vault_sql_hp = (defined('HAS_HOLO_PATTERN_COL') && HAS_HOLO_PATTERN_COL) ? "COALESCE(holo_pattern, 'none') AS holo_pattern" : "'none' AS holo_pattern";
$isPostJson = ($_SERVER['REQUEST_METHOD'] === 'POST' && strpos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== false);
$jsonInput = $isPostJson ? json_decode(file_get_contents('php://input'), true) : [];

function ensureDisplayVaultsTables($conn) {
    $sql1 = "CREATE TABLE IF NOT EXISTS display_vaults (
        id VARCHAR(50) PRIMARY KEY,
        user_id INT NOT NULL,
        title VARCHAR(255) DEFAULT 'My Display Vault',
        theme VARCHAR(50) DEFAULT 'luxury-dark',
        has_champion_upgrade BOOLEAN DEFAULT FALSE,
        has_transparency_upgrade BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY user_id (user_id)
    )";
    $conn->query($sql1);

    $sql2 = "CREATE TABLE IF NOT EXISTS display_vault_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        vault_id VARCHAR(50) NOT NULL,
        item_type VARCHAR(20) DEFAULT 'certificate',
        item_id VARCHAR(50) NOT NULL,
        is_champion BOOLEAN DEFAULT FALSE,
        transparency_active BOOLEAN DEFAULT FALSE,
        sort_order INT DEFAULT 0,
        UNIQUE KEY unique_item (vault_id, item_type, item_id),
        KEY vault_id (vault_id)
    )";
    $conn->query($sql2);
}

ensureDisplayVaultsTables($conn);

if ($action === 'get_public_vault') {
    $vault_id = $_GET['vault_id'] ?? '';
    if (!$vault_id) {
        echo json_encode(['success' => false, 'error' => 'Missing vault ID']);
        exit;
    }

    $stmt = $conn->prepare("SELECT * FROM display_vaults WHERE id = ?");
    $stmt->bind_param("s", $vault_id);
    $stmt->execute();
    $vault = $stmt->get_result()->fetch_assoc();

    if (!$vault) {
        echo json_encode(['success' => false, 'error' => 'Vault not found']);
        exit;
    }
    
    // Get vault owner username
    $uStmt = $conn->prepare("SELECT username, x_username FROM users WHERE id = ?");
    $uStmt->bind_param("i", $vault['user_id']);
    $uStmt->execute();
    $owner = $uStmt->get_result()->fetch_assoc();
    $vault['username'] = $owner['username'] ?? 'Collector';
    $vault['x_username'] = $owner['x_username'] ?? '';

    $stmt = $conn->prepare("SELECT * FROM display_vault_items WHERE vault_id = ? ORDER BY sort_order ASC, id ASC");
    $stmt->bind_param("s", $vault_id);
    $stmt->execute();
    $res = $stmt->get_result();
    $vaultItems = [];
    while ($row = $res->fetch_assoc()) {
        $vaultItems[] = $row;
    }

    $resolvedItems = [];
    foreach ($vaultItems as $vItem) {
        $allowedToSeeCost = ($vItem['transparency_active'] && $vault['has_transparency_upgrade']);
        if ($vItem['item_type'] === 'certificate') {
            $cStmt = $conn->prepare("SELECT
                id,
                name,
                card_set,
                year,
                overall_grade,
                acq_price,
                front_thumb,
                front_img,
                back_thumb,
                back_img,
                three_d_height_grid_json,
                market_price_json,
                market_price_unlocked,
                {$vault_sql_holo},
                {$vault_sql_hp}
            FROM certificates
            WHERE id = ? AND user_id = ? AND is_archived = 0");
            $cStmt->bind_param("si", $vItem['item_id'], $vault['user_id']);
            $cStmt->execute();
            $cert = $cStmt->get_result()->fetch_assoc();
            
                if ($cert) {
                    $has3d = $cert['three_d_height_grid_json'] !== null && trim((string)$cert['three_d_height_grid_json']) !== '';
                $itemData = [
                    'item_id' => $cert['id'],
                    'item_type' => 'certificate',
                    'name' => $cert['name'],
                    'card_set' => $cert['card_set'],
                    'year' => $cert['year'],
                    'overall_grade' => $cert['overall_grade'],
                    'front_thumb' => $cert['front_thumb'] ?: ($cert['front_img'] ? "api/collection.php?action=serve_image&id={$cert['id']}&type=front" : ""),
                        'has_3d' => $has3d,
                    'is_holographic' => (int)($cert['is_holographic'] ?? 0) === 1,
                    'holo_pattern' => $cert['holo_pattern'] ?? 'none',
                    'is_champion' => (bool)$vItem['is_champion'],
                    'transparency_active' => (bool)$vItem['transparency_active'],
                ];
                if ($allowedToSeeCost) {
                    $itemData['acq_price'] = $cert['acq_price'];
                    $mkt = 0;
                    if ($cert['market_price_unlocked'] && $cert['market_price_json']) {
                        $jd = json_decode($cert['market_price_json'], true);
                        if ($jd) {
                            $mkt = $jd['projectedValue']['price'] ?? $jd['prices']['market'] ?? 0;
                            if (!$mkt && $cert['overall_grade'] >= 8 && isset($jd['gradedPrices']['psa'.round($cert['overall_grade'])])) {
                                $mkt = $jd['gradedPrices']['psa'.round($cert['overall_grade'])];
                            }
                        }
                    }
                    $itemData['market_value'] = $mkt;
                    if ($vItem['is_champion'] && $mkt > 0 && $cert['acq_price'] > 0) {
                        $itemData['value_increase_pct'] = (($mkt - $cert['acq_price']) / $cert['acq_price']) * 100;
                    }
                }
                $resolvedItems[] = $itemData;
            }
        } else if ($vItem['item_type'] === 'psa_slab') {
            $pStmt = $conn->prepare("SELECT id, psa_serial, card_name, card_set, card_year, psa_grade as grade, acq_price, local_front_img, front_img_url FROM psa_slabs WHERE psa_serial = ? AND user_id = ? AND status = 'active'");
            $pStmt->bind_param("si", $vItem['item_id'], $vault['user_id']);
            $pStmt->execute();
            $slab = $pStmt->get_result()->fetch_assoc();
            
            if ($slab) {
                $itemData = [
                    'item_id' => $slab['psa_serial'],
                    'item_type' => 'psa_slab',
                    'name' => $slab['card_name'],
                    'card_set' => $slab['card_set'],
                    'year' => $slab['card_year'],
                    'overall_grade' => $slab['grade'],
                    'front_thumb' => $slab['local_front_img'] ?: $slab['front_img_url'],
                    'is_champion' => (bool)$vItem['is_champion'],
                    'transparency_active' => (bool)$vItem['transparency_active'],
                ];
                if ($allowedToSeeCost) {
                    $itemData['acq_price'] = $slab['acq_price'];
                    // Market value for slab not easily stored without joined market table in current schema, we'll keep it simple or look up matching cert if linked
                    $itemData['market_value'] = 0; 
                }
                $resolvedItems[] = $itemData;
            }
        }
    }

    echo json_encode([
        'success' => true,
        'vault' => [
            'id' => $vault['id'],
            'title' => $vault['title'],
            'has_champion_upgrade' => (bool)$vault['has_champion_upgrade'],
            'has_transparency_upgrade' => (bool)$vault['has_transparency_upgrade'],
            'username' => $vault['username'],
            'x_username' => $vault['x_username']
        ],
        'items' => $resolvedItems
    ]);
    exit;
}

// --- ALL OTHER ACTIONS REQUIRE AUTH ---
$user = requireAuth();
$user_id = $user['id'];

function deductCredit($conn, $user_id, $amount = 1) {
    $stmt = $conn->prepare("SELECT role, paid_credits FROM users WHERE id = ?");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $u = $stmt->get_result()->fetch_assoc();
    
    if ($u && $u['role'] === 'admin') return true;
    if (!$u || $u['paid_credits'] < $amount) return false;
    
    $upStmt = $conn->prepare("UPDATE users SET paid_credits = paid_credits - ? WHERE id = ?");
    $upStmt->bind_param("ii", $amount, $user_id);
    $upStmt->execute();
    return true;
}

if ($action === 'list_my_vaults') {
    $stmt = $conn->prepare("
        SELECT v.*, (SELECT COUNT(*) FROM display_vault_items i WHERE i.vault_id = v.id) as item_count 
        FROM display_vaults v 
        WHERE v.user_id = ? 
        ORDER BY v.created_at DESC
    ");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $res = $stmt->get_result();
    $vaults = [];
    while ($row = $res->fetch_assoc()) {
        $vaults[] = $row;
    }
    
    echo json_encode(['success' => true, 'vaults' => $vaults]);
    exit;
}

if ($action === 'create_vault') {
    $title = $isPostJson ? ($jsonInput['title'] ?? 'My Display Vault') : ($_POST['title'] ?? 'My Display Vault');
    
    if (!deductCredit($conn, $user_id, 1)) {
        echo json_encode(['success' => false, 'error' => 'Insufficient Pro Credits']);
        exit;
    }
    
    $vault_id = 'vault-' . substr(bin2hex(random_bytes(10)), 0, 12);
    $stmt = $conn->prepare("INSERT INTO display_vaults (id, user_id, title) VALUES (?, ?, ?)");
    $stmt->bind_param("sis", $vault_id, $user_id, $title);
    $stmt->execute();
    
    echo json_encode(['success' => true, 'vault_id' => $vault_id]);
    exit;
}

if ($action === 'rename_vault' && $isPostJson) {
    $vault_id = $jsonInput['vault_id'] ?? '';
    $new_title = trim($jsonInput['title'] ?? '');
    
    if (!$vault_id || !$new_title) {
        echo json_encode(['success' => false, 'error' => 'Missing vault_id or title']);
        exit;
    }
    
    // Verify ownership
    $check = $conn->prepare("SELECT id FROM display_vaults WHERE id = ? AND user_id = ?");
    $check->bind_param("si", $vault_id, $user_id);
    $check->execute();
    if (!$check->get_result()->fetch_assoc()) {
        echo json_encode(['success' => false, 'error' => 'Vault not found or unauthorized']);
        exit;
    }
    
    $stmt = $conn->prepare("UPDATE display_vaults SET title = ? WHERE id = ?");
    $stmt->bind_param("ss", $new_title, $vault_id);
    $stmt->execute();
    
    echo json_encode(['success' => true]);
    exit;
}

if ($action === 'buy_upgrade') {
    $vault_id = $_POST['vault_id'] ?? '';
    $type = $_POST['upgrade_type'] ?? '';
    
    $check = $conn->prepare("SELECT * FROM display_vaults WHERE id = ? AND user_id = ?");
    $check->bind_param("si", $vault_id, $user_id);
    $check->execute();
    $vault = $check->get_result()->fetch_assoc();
    
    if (!$vault) {
        echo json_encode(['success' => false, 'error' => 'Vault not found']);
        exit;
    }
    
    if ($type === 'champion' && !$vault['has_champion_upgrade']) {
        if (!deductCredit($conn, $user_id, 1)) {
            echo json_encode(['success' => false, 'error' => 'Insufficient Pro Credits']); exit;
        }
        $upd_champ = $conn->prepare("UPDATE display_vaults SET has_champion_upgrade = 1 WHERE id = ?");
        $upd_champ->bind_param("s", $vault_id);
        $upd_champ->execute();
    } else if ($type === 'transparency' && !$vault['has_transparency_upgrade']) {
        if (!deductCredit($conn, $user_id, 1)) {
            echo json_encode(['success' => false, 'error' => 'Insufficient Pro Credits']); exit;
        }
        $upd_trans = $conn->prepare("UPDATE display_vaults SET has_transparency_upgrade = 1 WHERE id = ?");
        $upd_trans->bind_param("s", $vault_id);
        $upd_trans->execute();
    }
    
    echo json_encode(['success' => true]);
    exit;
}

if ($action === 'manage_items' && $isPostJson) {
    $vault_id = $jsonInput['vault_id'] ?? '';
    $action_type = $jsonInput['action_type'] ?? '';
    
    $check = $conn->prepare("SELECT id FROM display_vaults WHERE id = ? AND user_id = ?");
    $check->bind_param("si", $vault_id, $user_id);
    $check->execute();
    if (!$check->get_result()->fetch_assoc()) {
        echo json_encode(['success' => false, 'error' => 'Unauthorized']); exit;
    }
    
    if ($action_type === 'sync') {
        $items = $jsonInput['items'] ?? [];
        // Extract existing transparencies and champion flags
        $stmt = $conn->prepare("SELECT item_id, is_champion, transparency_active FROM display_vault_items WHERE vault_id = ?");
        $stmt->bind_param("s", $vault_id);
        $stmt->execute();
        $res = $stmt->get_result();
        $existing = [];
        while ($row = $res->fetch_assoc()) {
            $existing[$row['item_id']] = $row;
        }
        
        $del = $conn->prepare("DELETE FROM display_vault_items WHERE vault_id = ?");
        $del->bind_param("s", $vault_id);
        $del->execute();
        
        $insert = $conn->prepare("INSERT INTO display_vault_items (vault_id, item_type, item_id, is_champion, transparency_active, sort_order) VALUES (?, ?, ?, ?, ?, ?)");
        $idx = 0;
        foreach ($items as $item) {
            $iid = $item['item_id'];
            $itype = $item['item_type'];
            $isChamp = (int)($existing[$iid]['is_champion'] ?? 0);
            $isTrans = (int)($existing[$iid]['transparency_active'] ?? 0);
            $idxInt = (int)$idx;
            
            $insert = $conn->prepare("INSERT INTO display_vault_items (vault_id, item_type, item_id, is_champion, transparency_active, sort_order) VALUES (?, ?, ?, ?, ?, ?)");
            $insert->bind_param("sssiii", $vault_id, $itype, $iid, $isChamp, $isTrans, $idxInt);
            $insert->execute();
            $idx++;
        }
    } else if ($action_type === 'set_champion') {
        $item_id = $jsonInput['item_id'] ?? '';
        
        $upd1 = $conn->prepare("UPDATE display_vault_items SET is_champion = 0 WHERE vault_id = ?");
        $upd1->bind_param("s", $vault_id);
        $upd1->execute();
        
        $upd2 = $conn->prepare("UPDATE display_vault_items SET is_champion = 1 WHERE vault_id = ? AND item_id = ?");
        $upd2->bind_param("ss", $vault_id, $item_id);
        $upd2->execute();
    }
    
    echo json_encode(['success' => true]);
    exit;
}

if ($action === 'toggle_item_transparency' && $isPostJson) {
    $vault_id = $jsonInput['vault_id'] ?? '';
    $item_id = $jsonInput['item_id'] ?? '';
    $active = $jsonInput['transparency_active'] ? 1 : 0;
    
    $check = $conn->prepare("SELECT id, has_transparency_upgrade FROM display_vaults WHERE id = ? AND user_id = ?");
    $check->bind_param("si", $vault_id, $user_id);
    $check->execute();
    $vault = $check->get_result()->fetch_assoc();
    
    if (!$vault || !$vault['has_transparency_upgrade']) {
        echo json_encode(['success' => false, 'error' => 'Unauthorized or missing upgrade']); exit;
    }
    
    $upd = $conn->prepare("UPDATE display_vault_items SET transparency_active = ? WHERE vault_id = ? AND item_id = ?");
    $upd->bind_param("iss", $active, $vault_id, $item_id);
    $upd->execute();
    
    echo json_encode(['success' => true]);
    exit;
}

echo json_encode(['success' => false, 'error' => 'Invalid action']);
