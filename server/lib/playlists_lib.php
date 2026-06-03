<?php
/**
 * JARVIS - playlist storage helpers.
 *
 * Playlists live in server/data/playlists.json, keyed by a normalized name:
 *   {
 *     "festa": {
 *        "name":  "Festa",
 *        "tracks": [ { "artist": "...", "title": "...", "file": "music/.../x.mp3" }, ... ],
 *        "updated_at": "2026-06-01 15:00"
 *     },
 *     ...
 *   }
 *
 * The client resolves spoken songs against the music catalog and sends
 * concrete {artist,title,file} entries, so playback never has to guess.
 */

function jarvis_pl_dir(): string {
    $dir = __DIR__ . '/../data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir;
}

function jarvis_pl_file(): string {
    return jarvis_pl_dir() . '/playlists.json';
}

/** Normalize a playlist name into a stable key (accent/case/space insensitive). */
function jarvis_pl_norm(string $name): string {
    $s = mb_strtolower(trim($name), 'UTF-8');
    // strip accents
    if (class_exists('Normalizer')) {
        $n = Normalizer::normalize($s, Normalizer::FORM_D);
        if (is_string($n)) $s = preg_replace('/\p{Mn}+/u', '', $n);
    }
    $s = preg_replace('/[^a-z0-9]+/', ' ', $s);
    return trim($s);
}

function jarvis_pl_load(): array {
    $f = jarvis_pl_file();
    if (!is_file($f)) return [];
    $data = json_decode((string) file_get_contents($f), true);
    return is_array($data) ? $data : [];
}

function jarvis_pl_save(array $playlists): bool {
    $f = jarvis_pl_file();
    $json = json_encode($playlists, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    return @file_put_contents($f, $json, LOCK_EX) !== false;
}

/** Sanitize an incoming tracks array into [{artist,title,file}] (file required). */
function jarvis_pl_clean_tracks($tracks): array {
    $out = [];
    if (!is_array($tracks)) return $out;
    $seen = [];
    foreach ($tracks as $t) {
        if (!is_array($t)) continue;
        $file = trim((string) ($t['file'] ?? ''));
        if ($file === '') continue;
        if (isset($seen[$file])) continue;
        $seen[$file] = true;
        $out[] = [
            'artist' => trim((string) ($t['artist'] ?? '')),
            'title'  => trim((string) ($t['title'] ?? '')),
            'file'   => $file,
        ];
    }
    return $out;
}

/** Find a playlist by (fuzzy) name. Returns [key, playlist] or [null, null]. */
function jarvis_pl_find(array $playlists, string $name): array {
    $key = jarvis_pl_norm($name);
    if ($key !== '' && isset($playlists[$key])) return [$key, $playlists[$key]];
    // fallback: partial / contained match
    foreach ($playlists as $k => $p) {
        if ($key !== '' && ($k === $key || strpos($k, $key) !== false || strpos($key, $k) !== false)) {
            return [$k, $p];
        }
    }
    return [null, null];
}

function jarvis_pl_now(): string {
    $cfgFile = __DIR__ . '/../config.php';
    $cfg = is_file($cfgFile) ? require $cfgFile : [];
    try { $tz = new DateTimeZone($cfg['timezone'] ?? 'Europe/Rome'); }
    catch (Exception $e) { $tz = new DateTimeZone('Europe/Rome'); }
    return (new DateTime('now', $tz))->format('Y-m-d H:i');
}
