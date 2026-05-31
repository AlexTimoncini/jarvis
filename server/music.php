<?php
/**
 * JARVIS - music catalog endpoint.
 *
 * GET (or POST) -> scans /music and returns the catalog as JSON.
 * Also writes music/catalog.json as a human-readable manifest.
 *   { tracks: [{artist,title,file}], artists: { Artist: [titles] } }
 */

header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/music_lib.php';

$musicDir = realpath(__DIR__ . '/../music') ?: (__DIR__ . '/../music');
$catalog = jarvis_music_catalog($musicDir);

// Persist a manifest next to the songs (best-effort).
if (is_dir($musicDir) && is_writable($musicDir)) {
    @file_put_contents(
        $musicDir . '/catalog.json',
        json_encode($catalog, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)
    );
}

echo json_encode($catalog, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
