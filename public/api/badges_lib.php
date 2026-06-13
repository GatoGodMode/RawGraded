<?php
require_once('db.php');

function seedDefaultBadges($conn) {
    $defaults = [
        ['First Audit', 'Awarded for completing your first card scan.', 'Trainer', 5, 'total_scans', '>=', 1],
        ['Scan Squad', 'Completed 10 audits. Keep at it!', 'Trainer', 10, 'total_scans', '>=', 10],
        ['Vault Veteran', 'Completed 50 audits. You know your cards!', 'Leader', 25, 'total_scans', '>=', 50],
        ['Master Collector', 'Completed 100 audits. An elite status.', 'Master', 50, 'total_scans', '>=', 100],
        ['Auditor Streak', 'Maintained a 3-day scan streak.', 'Trainer', 10, 'current_streak', '>=', 3],
        ['Pro Auditor Streak', 'Maintained a 7-day scan streak.', 'Leader', 25, 'current_streak', '>=', 7]
    ];
    foreach ($defaults as $d) {
        $stmt = $conn->prepare("INSERT INTO badges (name, description, rank_level, bonus_scans) VALUES (?, ?, ?, ?)");
        $stmt->bind_param("sssi", $d[0], $d[1], $d[2], $d[3]);
        if ($stmt->execute()) {
            $badgeId = $conn->insert_id;
            $rs = $conn->prepare("INSERT INTO badge_requirements (badge_id, requirement_type, operator, required_value) VALUES (?, ?, ?, ?)");
            $rs->bind_param("issi", $badgeId, $d[4], $d[5], $d[6]);
            $rs->execute();
        }
    }
}

function fetchAllFromRes($res) {
    if (!$res) return [];
    $rows = [];
    while ($row = $res->fetch_assoc()) $rows[] = $row;
    return $rows;
}

function checkAndAwardBadges($conn, $userId, $revoke = false) {
    $result = ['new_badges' => [], 'total_bonus_scans' => 0];
    
    // ... (rest of the function setup)

    // SURGICAL: Ensure total_scans in users table is synced with certificates count
    $stmt = $conn->prepare("UPDATE users u SET total_scans = (SELECT COUNT(*) FROM certificates WHERE user_id = u.id) WHERE id = ?");
    $stmt->bind_param("s", $userId);
    $stmt->execute();
    
    // Fetch Basic User Stats
    $stmt = $conn->prepare("SELECT total_scans, current_streak, joined_date FROM users WHERE id = ?");
    $stmt->bind_param("s", $userId);
    $stmt->execute();
    $userStats = $stmt->get_result()->fetch_assoc();
    if (!$userStats) return $result;

    // Fetch Advanced Portfolio Stats (Value, Investment, Sets)
    // Exclude parents to avoid double counting
    $advStmt = $conn->prepare("SELECT 
        COUNT(DISTINCT card_set) as unique_sets, 
        COALESCE(SUM(CASE WHEN id NOT IN (SELECT parent_id FROM certificates WHERE user_id = ? AND parent_id IS NOT NULL) THEN estimated_value ELSE 0 END), 0) as total_value,
        COALESCE(SUM(CASE WHEN id NOT IN (SELECT parent_id FROM certificates WHERE user_id = ? AND parent_id IS NOT NULL) THEN (COALESCE(acq_price, 0) + COALESCE(acq_tax, 0) + COALESCE(acq_shipping, 0)) ELSE 0 END), 0) as total_investment
        FROM certificates WHERE user_id = ?");
    $advStmt->bind_param("sss", $userId, $userId, $userId);
    $advStmt->execute();
    $advStats = $advStmt->get_result()->fetch_assoc();
    
    // Merge stats
    $stats = array_merge($userStats, $advStats);
    
    // Fetch all badges and whether the user has earned them
    $badgesRes = $conn->prepare("SELECT b.*, (SELECT COUNT(*) FROM user_badges WHERE user_id = ? AND badge_id = b.id) as earned FROM badges b");
    $badgesRes->bind_param("s", $userId);
    $badgesRes->execute();
    $allBadges = fetchAllFromRes($badgesRes->get_result());

    foreach ($allBadges as $badge) {
        $reqRes = $conn->prepare("SELECT * FROM badge_requirements WHERE badge_id = ?");
        $reqRes->bind_param("i", $badge['id']);
        $reqRes->execute();
        $reqs = fetchAllFromRes($reqRes->get_result());
        
        $allMet = !empty($reqs);
        foreach ($reqs as $req) {
            $met = false;
            $type = $req['requirement_type'];
            
            // Re-use logic for operators (same as before)
            if ($type === 'signup_date') {
                $uDate = strtotime(date('Y-m-d', strtotime($stats['joined_date'] ?? date('Y-m-d'))));
                $rDate = strtotime($req['required_value']);
                if ($req['operator'] === '>=') $met = $uDate >= $rDate;
                elseif ($req['operator'] === '>') $met = $uDate > $rDate;
                elseif ($req['operator'] === '=') $met = $uDate == $rDate;
                elseif ($req['operator'] === '<=') $met = $uDate <= $rDate;
                elseif ($req['operator'] === '<') $met = $uDate < $rDate;
                elseif ($req['operator'] === '!=') $met = $uDate != $rDate;
                if ($req['operator'] === '>=') $met = $val >= $req['required_value'];
                elseif ($req['operator'] === '>') $met = $val > $req['required_value'];
                elseif ($req['operator'] === '=') $met = $val == $req['required_value'];
                elseif ($req['operator'] === '<=') $met = $val <= $req['required_value'];
                elseif ($req['operator'] === '<') $met = $val < $req['required_value'];
                elseif ($req['operator'] === '!=') $met = $val != $req['required_value'];
            } elseif (in_array($type, ['category_count', 'set_count', 'character_count', 'year_count', 'artist_count'])) {
                // Extended Logic for Specific Counts
                $target = $req['target_criteria'] ?? '';
                if ($target) {
                    $column = '';
                    switch ($type) {
                        case 'category_count': $column = 'card_category'; break;
                        case 'set_count': $column = 'card_set'; break;
                        case 'character_count': $column = 'character_name'; break;
                        case 'year_count': $column = 'year'; break;
                        case 'artist_count': $column = 'artist'; break;
                    }

                    if ($column) {
                        // Use LIKE for flexibility (e.g. "Pikachu" matches "Pikachu & Raichu")
                        $countStmt = $conn->prepare("SELECT COUNT(*) as c FROM certificates WHERE user_id = ? AND $column LIKE ?");
                        $likeParam = "%" . $target . "%";
                        $countStmt->bind_param("ss", $userId, $likeParam);
                        $countStmt->execute();
                        $val = $countStmt->get_result()->fetch_assoc()['c'];

                        if ($req['operator'] === '>=') $met = $val >= $req['required_value'];
                        elseif ($req['operator'] === '>') $met = $val > $req['required_value'];
                        elseif ($req['operator'] === '=') $met = $val == $req['required_value'];
                        elseif ($req['operator'] === '<=') $met = $val <= $req['required_value'];
                        elseif ($req['operator'] === '<') $met = $val < $req['required_value'];
                        elseif ($req['operator'] === '!=') $met = $val != $req['required_value'];
                    }
                }
            } else {
                $val = 0;
                switch ($type) {
                    case 'total_scans': $val = $stats['total_scans']; break;
                    case 'current_streak': $val = $stats['current_streak']; break;
                    case 'total_value': $val = $stats['total_value']; break;
                    case 'total_investment': $val = $stats['total_investment']; break;
                    case 'unique_sets': $val = $stats['unique_sets']; break;
                    default: $val = 0;
                }
                if ($req['operator'] === '>=') $met = $val >= $req['required_value'];
                elseif ($req['operator'] === '>') $met = $val > $req['required_value'];
                elseif ($req['operator'] === '=') $met = $val == $req['required_value'];
                elseif ($req['operator'] === '<=') $met = $val <= $req['required_value'];
                elseif ($req['operator'] === '<') $met = $val < $req['required_value'];
                elseif ($req['operator'] === '!=') $met = $val != $req['required_value'];
            }
            if (!$met) { $allMet = false; break; }
        }
        
        // LOGIC: Award or Revoke
        if ($allMet && $badge['earned'] == 0) {
            // AWARD NEW BADGE
            $stmt = $conn->prepare("INSERT IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)");
            $stmt->bind_param("si", $userId, $badge['id']);
            $stmt->execute();
            if ($conn->affected_rows > 0) {
                $result['new_badges'][] = $badge['id'];
                $result['total_bonus_scans'] += $badge['bonus_scans'];
            }
        } elseif ($revoke && !$allMet && $badge['earned'] > 0) {
            // REVOKE BADGE (Requirements no longer met) - ONLY IF REVOKE IS TRUE
            $stmt = $conn->prepare("DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?");
            $stmt->bind_param("si", $userId, $badge['id']);
            $stmt->execute();
        }
    }

    // Recalculate ALL bonus scans from scratch to ensure accuracy (handles both awards and revokes)
    $stmt = $conn->prepare("UPDATE users SET bonus_scans = (SELECT COALESCE(SUM(b.bonus_scans), 0) FROM badges b INNER JOIN user_badges ub ON b.id = ub.badge_id WHERE ub.user_id = ?) WHERE id = ?");
    $stmt->bind_param("ss", $userId, $userId);
    $stmt->execute();

    return $result;
}
