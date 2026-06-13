<?php
// Suppress errors to ensure valid JSON output
ini_set('display_errors', 0);
error_reporting(E_ALL);

require_once('db.php');
require_once('badges_lib.php');

// Start output buffering to catch any stray output
ob_start();

// Prevent caching and set content type ONLY if run directly
if (basename($_SERVER['SCRIPT_FILENAME']) === 'badges.php') {
    header('Cache-Control: no-cache, no-store, must-revalidate');
    header('Pragma: no-cache');
    header('Expires: 0');
    header('Content-Type: application/json');
}

// Isolated execution logic - only runs if called directly as an API
if (basename($_SERVER['SCRIPT_FILENAME']) === 'badges.php') {
    // Ensure user is logged in
    $user = requireAuth();
    $userId = $user['id'];
    $isAdmin = ($user['role'] ?? 'user') === 'admin';

// GET: Fetch badges
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? 'list';
    
    if ($action === 'list') {
        $mode = $_GET['mode'] ?? 'auto';
        
        if ($isAdmin && $mode !== 'user') {
            $res = $conn->query("SELECT b.*, (SELECT COUNT(*) FROM user_badges WHERE badge_id = b.id) as user_count FROM badges b ORDER BY b.rank_level, b.created_at DESC");
            $badges = [];
            while ($row = $res->fetch_assoc()) {
                $reqRes = $conn->query("SELECT * FROM badge_requirements WHERE badge_id = " . (int)$row['id']);
                $row['requirements'] = fetchAllFromRes($reqRes);
                $badges[] = $row;
            }
            sendResponse(['badges' => $badges]);
        } else {
            $stmt = $conn->prepare("SELECT b.*, ub.awarded_at FROM badges b INNER JOIN user_badges ub ON b.id = ub.badge_id WHERE ub.user_id = ? ORDER BY ub.awarded_at DESC");
            $stmt->bind_param("s", $userId);
            $stmt->execute();
            $badges = fetchAllFromRes($stmt->get_result());
            sendResponse(['badges' => $badges]);
        }
    } elseif ($action === 'check') {
        // SURGICAL SEED: If badges table is empty, seed defaults
        $countRes = $conn->query("SELECT COUNT(*) as count FROM badges");
        $count = $countRes ? $countRes->fetch_assoc()['count'] : 0;
        if ($count == 0) seedDefaultBadges($conn);

        $result = checkAndAwardBadges($conn, $userId);
        sendResponse(['status' => 'checked', 'new_badges' => count($result['new_badges'] ?? [])]);
    } elseif ($action === 'sync_all' && $isAdmin) {
        $revoke = isset($_GET['revoke']) && $_GET['revoke'] === 'true';
        $usersResult = $conn->query("SELECT id FROM users");
        $stats = ['badges_awarded' => 0, 'bonus_scans_granted' => 0, 'users_processed' => 0];
        while ($u = $usersResult->fetch_assoc()) {
            $result = checkAndAwardBadges($conn, $u['id'], $revoke);
            $stats['badges_awarded'] += count($result['new_badges']);
            $stats['bonus_scans_granted'] += $result['total_bonus_scans'];
            $stats['users_processed']++;
        }
        sendResponse($stats);
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $isAdmin) {
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        sendResponse(['error' => 'Invalid input'], 400);
    }
    $action = $input['action'] ?? 'create';
    $name = $input['name'] ?? '';
    $desc = $input['description'] ?? '';
    $icon = $input['icon_url'] ?? '';
    $rank = $input['rank_level'] ?? 'Trainer';
    $bonus = intval($input['bonus_scans'] ?? 0);
    $reqs = $input['requirements'] ?? [];

    if ($action === 'create') {
        $stmt = $conn->prepare("INSERT INTO badges (name, description, icon_url, rank_level, bonus_scans) VALUES (?, ?, ?, ?, ?)");
        $stmt->bind_param("ssssi", $name, $desc, $icon, $rank, $bonus);
        if ($stmt->execute()) {
            $badgeId = $conn->insert_id;
            foreach ($reqs as $req) {
                $rType = $req['type'] ?? $req['requirement_type'] ?? 'total_scans';
                $rOp = $req['operator'] ?? '>=';
                $rVal = $req['value'] ?? $req['required_value'] ?? 1;
                
                $rs = $conn->prepare("INSERT INTO badge_requirements (badge_id, requirement_type, operator, required_value) VALUES (?, ?, ?, ?)");
                $rs->bind_param("issi", $badgeId, $rType, $rOp, $rVal);
                $rs->execute();
            }
            cleanSendResponse(['status' => 'success', 'id' => $badgeId]);
        }
    } elseif ($action === 'update') {
        $id = intval($input['id']);
        $stmt = $conn->prepare("UPDATE badges SET name=?, description=?, icon_url=?, rank_level=?, bonus_scans=? WHERE id=?");
        $stmt->bind_param("ssssii", $name, $desc, $icon, $rank, $bonus, $id);
        if ($stmt->execute()) {
            $delReq = $conn->prepare("DELETE FROM badge_requirements WHERE badge_id = ?");
            $delReq->bind_param("i", $id);
            $delReq->execute();
            foreach ($reqs as $req) {
                $rType = $req['type'] ?? $req['requirement_type'] ?? 'total_scans';
                $rOp = $req['operator'] ?? '>=';
                $rVal = $req['value'] ?? $req['required_value'] ?? 1;

                $rs = $conn->prepare("INSERT INTO badge_requirements (badge_id, requirement_type, operator, required_value) VALUES (?, ?, ?, ?)");
                $rs->bind_param("issi", $id, $rType, $rOp, $rVal);
                $rs->execute();
            }
            sendResponse(['status' => 'success']);
        }
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE' && $isAdmin) {
    $id = intval($_GET['id'] ?? 0);
    $conn->prepare("DELETE FROM badge_requirements WHERE badge_id = ?")->bind_param("i", $id)->execute();
    $conn->prepare("DELETE FROM user_badges WHERE badge_id = ?")->bind_param("i", $id)->execute();
    $conn->prepare("DELETE FROM badges WHERE id = ?")->bind_param("i", $id)->execute();
    sendResponse(['status' => 'success']);
}
// End isolated execution
}

// Flush buffer and return clean JSON
function cleanSendResponse($data, $code = 200) {
    ob_clean(); // Discard any prior output
    http_response_code($code);
    echo json_encode($data);
    exit;
}
?>
