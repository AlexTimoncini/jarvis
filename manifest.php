<?php
/**
 * Web App Manifest with deploy-path aware URLs.
 * Use this on PHP hosts (InfinityFree) where .webmanifest MIME may be wrong.
 */
header('Content-Type: application/manifest+json; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');

$dir = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/'));
$base = ($dir === '/' || $dir === '.') ? '/' : rtrim($dir, '/') . '/';

$manifest = [
    'id' => $base,
    'name' => 'J.A.R.V.I.S.',
    'short_name' => 'JARVIS',
    'description' => 'Assistente AI vocale a tema Iron Man.',
    'lang' => 'it',
    'dir' => 'ltr',
    'start_url' => $base,
    'scope' => $base,
    'display' => 'standalone',
    'display_override' => ['standalone', 'fullscreen'],
    'orientation' => 'portrait',
    'background_color' => '#02060c',
    'theme_color' => '#02060c',
    'categories' => ['productivity', 'utilities'],
    'icons' => [
        [
            'src' => $base . 'assets/icons/icon-192.png',
            'sizes' => '192x192',
            'type' => 'image/png',
            'purpose' => 'any',
        ],
        [
            'src' => $base . 'assets/icons/icon-512.png',
            'sizes' => '512x512',
            'type' => 'image/png',
            'purpose' => 'any',
        ],
        [
            'src' => $base . 'assets/icons/icon-192.png',
            'sizes' => '192x192',
            'type' => 'image/png',
            'purpose' => 'maskable',
        ],
        [
            'src' => $base . 'assets/icons/icon-512.png',
            'sizes' => '512x512',
            'type' => 'image/png',
            'purpose' => 'maskable',
        ],
    ],
];

echo json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
