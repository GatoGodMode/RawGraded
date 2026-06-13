<?php
// market_helper.php
// Extracted market data fetching logic for use across API endpoints

function fetchMarketData($conn, $cert_id, $card_name, $card_set, $overall_grade = 0) {
    // 1. Read API key — fallback to hardcoded free key
    $api_key = '[REDACTED]';
    try {
        $settingsRes = $conn->query("SELECT setting_value FROM settings WHERE setting_key = 'POKEPRICE_API_KEY'");
        if ($settingsRes && ($kRow = $settingsRes->fetch_assoc()) && !empty($kRow['setting_value'])) {
            $api_key = $kRow['setting_value'];
        }
    } catch (\Throwable $e) { /* use default */ }

    $search_q = urlencode(trim($card_name . ' ' . $card_set));
    $pokewallet_key = '[REDACTED]'; // Provided by user

    $mh = curl_multi_init();

    // 1. PokemonPriceTracker Request
    $ch1 = curl_init();
    curl_setopt_array($ch1, [
        CURLOPT_URL            => "https://www.pokemonpricetracker.com/api/v2/cards?search={$search_q}&includeEbay=true&limit=1",
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => [
            "Authorization: Bearer {$api_key}",
            "Accept: application/json"
        ]
    ]);
    curl_multi_add_handle($mh, $ch1);

    // 2. PokéWallet Request
    $ch2 = curl_init();
    curl_setopt_array($ch2, [
        CURLOPT_URL            => "https://api.pokewallet.io/search?q={$search_q}",
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER     => [
            "X-API-Key: {$pokewallet_key}",
            "Accept: application/json"
        ]
    ]);
    curl_multi_add_handle($mh, $ch2);

    // Execute multiple cURL handles simultaneously
    do {
        $status = curl_multi_exec($mh, $active);
        if ($active) {
            curl_multi_select($mh);
        }
    } while ($active && $status == CURLM_OK);

    $response1  = curl_multi_getcontent($ch1);
    $http_code1 = curl_getinfo($ch1, CURLINFO_HTTP_CODE);
    
    $response2  = curl_multi_getcontent($ch2);
    $http_code2 = curl_getinfo($ch2, CURLINFO_HTTP_CODE);

    curl_multi_remove_handle($mh, $ch1);
    curl_multi_remove_handle($mh, $ch2);
    curl_multi_close($mh);

    $market_data = [
        'prices'       => ['low' => null, 'mid' => null, 'high' => null, 'market' => null],
        'gradedPrices' => ['psa10' => null, 'psa9' => null, 'bgs10' => null, 'cgc10' => null],
        'pokewallet'   => [
            'tcgplayer'  => null,
            'cardmarket' => null
        ],
        'last_updated' => date('c')
    ];

    $has_valuable_data = false;

    // --- PARSE POKEMON PRICE TRACKER ---
    if ($http_code1 === 200 && $response1) {
        $api = json_decode($response1, true);
        $cards = $api['data'] ?? (is_array($api) ? $api : []);
        $r     = $cards[0] ?? [];

        if (!empty($r['prices'])) {
            $has_valuable_data = true;
            $market_data['prices']['market'] = $r['prices']['market'] ?? null;
            $market_data['prices']['low']    = $r['prices']['low']    ?? null;
            $market_data['prices']['mid']    = $r['prices']['mid']    ?? null;
            $market_data['prices']['high']   = $r['prices']['high']   ?? null;
        }

        if (!empty($r['ebay']['salesByGrade'])) {
            $grades = $r['ebay']['salesByGrade'];
            $market_data['gradedPrices']['psa10'] = $grades['psa10']['smartMarketPrice']['price'] ?? $grades['psa10']['averagePrice'] ?? null;
            $market_data['gradedPrices']['psa9']  = $grades['psa9']['smartMarketPrice']['price']  ?? $grades['psa9']['averagePrice']  ?? null;
            $market_data['gradedPrices']['psa8']  = $grades['psa8']['smartMarketPrice']['price']  ?? $grades['psa8']['averagePrice']  ?? null;
            $market_data['gradedPrices']['psa7']  = $grades['psa7']['smartMarketPrice']['price']  ?? $grades['psa7']['averagePrice']  ?? null;
            $market_data['gradedPrices']['psa6']  = $grades['psa6']['smartMarketPrice']['price']  ?? $grades['psa6']['averagePrice']  ?? null;
            $market_data['gradedPrices']['psa5']  = $grades['psa5']['smartMarketPrice']['price']  ?? $grades['psa5']['averagePrice']  ?? null;
            $market_data['gradedPrices']['bgs10'] = $grades['bgs10']['smartMarketPrice']['price'] ?? $grades['bgs10']['averagePrice'] ?? null;
            $market_data['gradedPrices']['cgc10'] = $grades['cgc10']['smartMarketPrice']['price'] ?? $grades['cgc10']['averagePrice'] ?? null;
            
            if ($overall_grade > 0) {
                $target_grade = round($overall_grade);
                $tier_key = 'psa' . $target_grade;
                
                if (isset($grades[$tier_key])) {
                    $market_data['projectedValue'] = [
                        'grade' => $target_grade,
                        'price' => $grades[$tier_key]['smartMarketPrice']['price'] ?? $grades[$tier_key]['averagePrice'] ?? null
                    ];
                }
            }
        }
    }

    // --- PARSE POKEWALLET ---
    if ($http_code2 === 200 && $response2) {
        $pw_api = json_decode($response2, true);
        $pw_results = $pw_api['results'] ?? [];
        if (!empty($pw_results) && count($pw_results) > 0) {
            $has_valuable_data = true;
            $pw_first = $pw_results[0];

            if (!empty($pw_first['tcgplayer'])) {
                $tcg = $pw_first['tcgplayer'];
                $tcg_prices = [];
                foreach (($tcg['prices'] ?? []) as $pv) {
                    $tcg_prices[] = [
                        'sub_type'     => $pv['sub_type_name'] ?? 'Normal',
                        'market_price' => $pv['market_price'] ?? null,
                        'low_price'    => $pv['low_price'] ?? null,
                        'mid_price'    => $pv['mid_price'] ?? null,
                        'high_price'   => $pv['high_price'] ?? null,
                    ];
                }
                $market_data['pokewallet']['tcgplayer'] = [
                    'prices' => $tcg_prices,
                    'url'    => $tcg['url'] ?? null
                ];
            }

            if (!empty($pw_first['cardmarket'])) {
                $cm = $pw_first['cardmarket'];
                $cm_prices = [];
                foreach (($cm['prices'] ?? []) as $pv) {
                    $cm_prices[] = [
                        'variant_type' => $pv['variant_type'] ?? 'normal',
                        'trend'        => $pv['trend'] ?? null,
                        'avg30'        => $pv['avg30'] ?? null,
                        'avg7'         => $pv['avg7'] ?? null,
                        'low'          => $pv['low'] ?? null,
                    ];
                }
                $market_data['pokewallet']['cardmarket'] = [
                    'prices' => $cm_prices,
                    'url'    => $cm['product_url'] ?? null
                ];
            }
            $market_data['pokewallet']['gradedPrices'] = [
                'bgs9'  => null, 'bgs8'  => null, 'bgs7'  => null,
                'cgc9'  => null, 'cgc8'  => null, 'cgc7'  => null,
            ];
        }
    }

    // --- PARSE TCGDEX FALLBACK ---
    // If the primary providers found nothing, we look up the card on TCGDex GraphQL
    // and then fetch pricing using the TCGDex REST API
    if (!$has_valuable_data) {
        $first_name_word = explode(' ', $card_name)[0];
        $tcgq_url = "https://api.tcgdex.net/v2/graphql";
        $tcg_query = [
            'query' => 'query SearchCards($name: String!) { cards(filters: { name: $name }) { id name set { name } } }',
            'variables' => ['name' => $first_name_word]
        ];

        $opts = [
            "http" => [
                "method" => "POST",
                "header" => "Content-Type: application/json",
                "content" => json_encode($tcg_query),
                "timeout" => 5
            ]
        ];
        $context = stream_context_create($opts);
        $tcg_result_json = @file_get_contents($tcgq_url, false, $context);

        if ($tcg_result_json) {
            $tcg_result = json_decode($tcg_result_json, true);
            $cards = $tcg_result['data']['cards'] ?? [];
            
            $best_match_id = null;
            foreach ($cards as $c) {
                // Find nearest set match (fuzzily)
                if (stripos($c['set']['name'] ?? '', $card_set) !== false || stripos($card_set, $c['set']['name'] ?? '') !== false) {
                    $best_match_id = $c['id'];
                    break;
                }
            }
            if (!$best_match_id && count($cards) > 0) {
                $best_match_id = $cards[0]['id']; // default to first match if set is not found
            }

            if ($best_match_id) {
                $opts_get = [
                    "http" => [
                        "method" => "GET",
                        "header" => "Accept: application/json",
                        "timeout" => 5
                    ]
                ];
                $ctx_get = stream_context_create($opts_get);
                $card_details_json = @file_get_contents("https://api.tcgdex.net/v2/en/cards/{$best_match_id}", false, $ctx_get);
                
                if ($card_details_json) {
                    $card_details = json_decode($card_details_json, true);
                    if (!empty($card_details['pricing'])) {
                        $pricing = $card_details['pricing'];
                        $has_valuable_data = true;

                        // Map TCGplayer pricing
                        if (!empty($pricing['tcgplayer'])) {
                            $tcg_prices = [];
                            foreach (['normal', 'reverse', 'holo'] as $variant) {
                                if (!empty($pricing['tcgplayer'][$variant])) {
                                    $vData = $pricing['tcgplayer'][$variant];
                                    $tcg_prices[] = [
                                        'sub_type'     => ucfirst($variant),
                                        'market_price' => $vData['marketPrice'] ?? null,
                                        'low_price'    => $vData['lowPrice'] ?? null,
                                        'mid_price'    => $vData['midPrice'] ?? null,
                                        'high_price'   => $vData['highPrice'] ?? null,
                                    ];
                                }
                            }
                            $market_data['pokewallet']['tcgplayer'] = [
                                'prices' => $tcg_prices,
                                'url'    => "https://tcgplayer.com" // url not provided by tcgdex
                            ];
                        }

                        // Map Cardmarket pricing
                        if (!empty($pricing['cardmarket'])) {
                            $cmData = $pricing['cardmarket'];
                            $market_data['pokewallet']['cardmarket'] = [
                                'prices' => [
                                    [
                                        'variant_type' => 'normal',
                                        'trend'        => $cmData['trend'] ?? null,
                                        'avg30'        => $cmData['avg30'] ?? null,
                                        'avg7'         => $cmData['avg7'] ?? null,
                                        'low'          => $cmData['low'] ?? null,
                                    ],
                                    [
                                        'variant_type' => 'holo',
                                        'trend'        => $cmData['trend-holo'] ?? null,
                                        'avg30'        => $cmData['avg30-holo'] ?? null,
                                        'avg7'         => $cmData['avg7-holo'] ?? null,
                                        'low'          => $cmData['low-holo'] ?? null,
                                    ]
                                ],
                                'url'    => "https://cardmarket.com" // url not provided by tcgdex
                            ];
                        }
                    }
                }
            }
        }
    }

    if (!$has_valuable_data) {
        $market_data['no_data'] = true;
    }

    $cached_json = json_encode($market_data);

    // Global sync
    if ($cert_id) {
        try {
            $stmt = $conn->prepare(
                "UPDATE certificates
                 SET    market_price_json = ?, market_price_fetched_at = CURRENT_TIMESTAMP
                 WHERE  name = ? AND card_set = ?" // Synchronize across all identical cards
            );
            $stmt->bind_param("sss", $cached_json, $card_name, $card_set);
            $stmt->execute();
        } catch (\Throwable $e) { /* log if needed */ }
    }

    return $cached_json;
}
?>
