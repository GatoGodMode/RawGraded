<?php
require_once('db.php');

$action = $_GET['action'] ?? 'search';

if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

if ($action === 'population') {
    // Get population report for a specific name/set
    $name = $_GET['name'] ?? '';
    $set = $_GET['set'] ?? '';
    
    $merged_filter = HAS_MERGED_COL ? " AND (is_merged = 0 OR is_merged IS NULL)" : "";
    $archive_filter = " AND (is_archived = 0 OR is_archived IS NULL)";
    $hidden_filter = " AND (is_hidden = 0 OR is_hidden IS NULL)";
    $query = "SELECT overall_grade, COUNT(*) as count FROM certificates WHERE 1=1" . $merged_filter . $archive_filter . $hidden_filter;
    $params = [];
    $types = "";
    
    if ($name) {
        $query .= " AND name = ?";
        $params[] = $name;
        $types .= "s";
    }
    if ($set) {
        $query .= " AND card_set = ?";
        $params[] = $set;
        $types .= "s";
    }
    
    $query .= " GROUP BY overall_grade ORDER BY overall_grade DESC";
    
    $stmt = $conn->prepare($query);
    if (!empty($params)) {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $result = $stmt->get_result();
    
    $pop_data = [];
    while ($row = $result->fetch_assoc()) {
        $pop_data[] = $row;
    }
    
    sendResponse($pop_data);

} elseif ($action === 'global') {
    // Get total graded count (includes hidden certs so homepage total grows)
    $merged_filter = HAS_MERGED_COL ? " WHERE (is_merged = 0 OR is_merged IS NULL)" : " WHERE 1=1";
    $archive_filter = " AND (is_archived = 0 OR is_archived IS NULL)";
    $total_res = $conn->query("SELECT COUNT(*) as total FROM certificates" . $merged_filter . $archive_filter);
    $total_row = $total_res->fetch_assoc();
    $total_graded = $total_row['total'] ?? 0;

    // Get 10 most recent scans (exclude hidden to respect privacy)
    $merged_filter = HAS_MERGED_COL ? " WHERE (is_merged = 0 OR is_merged IS NULL)" : " WHERE 1=1";
    $archive_filter = " AND (is_archived = 0 OR is_archived IS NULL)";
    $hidden_filter = " AND (is_hidden = 0 OR is_hidden IS NULL)";
    $recent_query = "SELECT id, name, card_set, overall_grade, date_scanned, front_img, back_img, front_thumb, back_thumb FROM certificates" . $merged_filter . $archive_filter . $hidden_filter . " ORDER BY date_scanned DESC LIMIT 10";
    $recent_res = $conn->query($recent_query);
    $recent_scans = [];
    while ($row = $recent_res->fetch_assoc()) {
        $recent_scans[] = $row;
    }

    sendResponse([
        'total_graded' => $total_graded,
        'recent_scans' => $recent_scans
    ]);

} elseif ($action === 'featured') {
    // Last 5 public certificates with full grade data for homepage hero (reduces load, improves marketability)
    $merged_filter = HAS_MERGED_COL ? " WHERE (is_merged = 0 OR is_merged IS NULL)" : " WHERE 1=1";
    $archive_filter = " AND (is_archived = 0 OR is_archived IS NULL)";
    $hidden_filter = " AND (is_hidden = 0 OR is_hidden IS NULL)";
    $total_res = $conn->query("SELECT COUNT(*) as total FROM certificates" . $merged_filter . $archive_filter);
    $total_row = $total_res->fetch_assoc();
    $total_graded = $total_row['total'] ?? 0;

    $cols = "id, name, card_set, year, overall_grade, date_scanned, COALESCE(NULLIF(front_thumb, ''), front_img) as front_img, COALESCE(NULLIF(back_thumb, ''), back_img) as back_img, reasoning, centering, corners, edges, surface, predicted_grades, video_frames_json, defects_json, market_price_json";
    $q = "SELECT $cols FROM certificates" . $merged_filter . $archive_filter . $hidden_filter . " ORDER BY date_scanned DESC LIMIT 5";
    $res = $conn->query($q);
    $featured = [];
    while ($row = $res->fetch_assoc()) {
        if (!empty($row['predicted_grades'])) {
            $row['predicted_grades'] = json_decode($row['predicted_grades'], true);
        }
        // Attach summarized market data (psa10, raw) from the json cache column
        $row['market'] = null;
        if (!empty($row['market_price_json'])) {
            $md = json_decode($row['market_price_json'], true);
            if ($md && !($md['no_data'] ?? false)) {
                $row['market'] = [
                    'raw'   => $md['prices']['market'] ?? $md['pokewallet']['tcgplayer']['market'] ?? null,
                    'psa10' => $md['gradedPrices']['psa10'] ?? $md['pokewallet']['gradedPrices']['psa10'] ?? null,
                    'psa9'  => $md['gradedPrices']['psa9']  ?? $md['pokewallet']['gradedPrices']['psa9']  ?? null,
                ];
            }
        }
        unset($row['market_price_json']);
        // Forensics: first 1–4 video frames for hero evidence squares (data URLs)
        $row['forensics_images'] = [];
        if (!empty($row['video_frames_json'])) {
            $frames = json_decode($row['video_frames_json'], true);
            if (is_array($frames)) {
                $slice = array_slice($frames, 0, 4);
                foreach ($slice as $frame) {
                    if (is_string($frame) && $frame !== '') {
                        $row['forensics_images'][] = (strpos($frame, 'data:') === 0) ? $frame : ('data:image/jpeg;base64,' . $frame);
                    }
                }
            }
        }
        unset($row['video_frames_json']);
        $featured[] = $row;
    }
    sendResponse([
        'total_graded' => (int) $total_graded,
        'featured' => $featured
    ]);

} else {
    // Search archive (Public Archive search)
    $q = $_GET['q'] ?? '';
    $x_user = $_GET['x_username'] ?? '';
    $stream = isset($_GET['stream']) && $_GET['stream'] === '1';

    if ($stream) {
        // STREAMING HEADER
        header('Content-Type: application/x-ndjson');
        header('Cache-Control: no-cache');
        header('X-Accel-Buffering: no'); // Nginx
        // Attempt to disable compression
        if(function_exists('apache_setenv')){
            @apache_setenv('no-gzip', 1);
        }
        @ini_set('zlib.output_compression', 0);
        @ini_set('implicit_flush', 1);
        
        // Disable output buffering for real-time streaming
        while (ob_get_level()) ob_end_clean();
        
        // Prevent timeout for large searches
        set_time_limit(0);
    } else {
        header('Content-Type: application/json');
    }
    
    $merged_filter = HAS_MERGED_COL ? " AND (is_merged = 0 OR is_merged IS NULL)" : "";
    $archive_filter = " AND (is_archived = 0 OR is_archived IS NULL)";
    $hidden_filter = " AND (is_hidden = 0 OR is_hidden IS NULL)";

    if ($stream) {
        $cert_select = "id, name, card_set, character_name, year, overall_grade, date_scanned, x_username,
                  reasoning, centering, corners, edges, surface,
                  (CASE WHEN (front_thumb IS NOT NULL AND front_thumb != '') OR (front_img IS NOT NULL AND front_img != '') THEN 1 ELSE 0 END) as has_front_img,
                  0 as is_slab, NULL as auth_check_id, NULL as grader, front_img, front_thumb";
        
        $slab_select = "CONCAT('slab_', s.id), s.card_name, s.card_set, s.psa_serial, s.card_year, s.psa_grade, s.added_at, u.x_username,
                  s.grader, NULL, NULL, NULL, NULL,
                  (CASE WHEN s.local_front_img IS NOT NULL OR s.front_img_url IS NOT NULL THEN 1 ELSE 0 END),
                  1, sc.id, s.grader, s.front_img_url, s.local_front_img";
    } else {
        $cert_select = "id, name, card_set, character_name, year, overall_grade, date_scanned, x_username,
                  reasoning, centering, corners, edges, surface,
                  NULL,
                  0 as is_slab, NULL as auth_check_id, NULL as grader, COALESCE(NULLIF(front_thumb, ''), front_img), COALESCE(NULLIF(back_thumb, ''), back_img)";
                  
        $slab_select = "CONCAT('slab_', s.id), s.card_name, s.card_set, s.psa_serial, s.card_year, s.psa_grade, s.added_at, u.x_username,
                  s.grader, NULL, NULL, NULL, NULL,
                  NULL,
                  1, sc.id, s.grader, COALESCE(NULLIF(s.local_front_img, ''), s.front_img_url), s.local_back_img";
    }

    $base_cert_query = "SELECT $cert_select FROM certificates WHERE 1=1" . $merged_filter . $archive_filter . $hidden_filter;
    $base_slab_query = "SELECT $slab_select FROM psa_slabs s
              LEFT JOIN users u ON u.id = s.user_id
              INNER JOIN (
                  SELECT id, psa_slab_id, verdict FROM slab_checks 
                  WHERE id IN (SELECT MAX(id) FROM slab_checks GROUP BY psa_slab_id)
              ) sc ON sc.psa_slab_id = s.id
              WHERE sc.verdict = 'authentic'";

    $params = [];
    $types = "";
    
    $whereCert = "";
    $whereSlab = "";
    
    if ($q) {
        $search = "%$q%";
        $whereCert .= " AND (name LIKE ? OR card_set LIKE ? OR character_name LIKE ?)";
        $params[] = $search; $params[] = $search; $params[] = $search;
        $types .= "sss";
    }
    
    if ($x_user) {
        $whereCert .= " AND x_username = ?";
        $params[] = $x_user;
        $types .= "s";
    }

    if ($q) {
        $whereSlab .= " AND (s.card_name LIKE ? OR s.card_set LIKE ? OR s.psa_serial LIKE ?)";
        $params[] = $search; $params[] = $search; $params[] = $search;
        $types .= "sss";
    }
    
    if ($x_user) {
        $whereSlab .= " AND u.x_username = ?";
        $params[] = $x_user;
        $types .= "s";
    }
    
    $query = "($base_cert_query$whereCert) UNION ALL ($base_slab_query$whereSlab) ORDER BY date_scanned DESC LIMIT 50";
    
    $stmt = $conn->prepare($query);
    if (!empty($params)) {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($stream) {
        // STREAM ROWS
        while ($row = $result->fetch_assoc()) {
            $json = json_encode($row);
            if ($json === false) { continue; }
            echo $json . "\n";
            flush();
        }
    } else {
        $results = [];
        while ($row = $result->fetch_assoc()) {
            $results[] = $row;
        }
        sendResponse($results);
    }
}
?>
