<?php
/**
 * JARVIS - music library scanner (shared by music.php and ai.php).
 *
 * Walks the /music folder (music/<Artist>/<Title>.<ext>) and returns a
 * normalized catalog. Files dropped directly in /music land under "Vari".
 */

const JARVIS_MUSIC_EXT = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac'];

/** Build a URL-safe relative path (each segment encoded, slashes kept). */
function jarvis_music_url(string $rel): string {
    $parts = array_map('rawurlencode', explode('/', str_replace('\\', '/', $rel)));
    return 'music/' . implode('/', $parts);
}

/** Recursively collect audio files under $base, returning paths relative to $base. */
function jarvis_music_walk(string $base, string $sub = ''): array {
    $dir = $sub === '' ? $base : "$base/$sub";
    if (!is_dir($dir)) return [];
    $out = [];
    foreach (scandir($dir) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..' || $entry[0] === '.') continue;
        $rel = $sub === '' ? $entry : "$sub/$entry";
        $abs = "$base/$rel";
        if (is_dir($abs)) {
            $out = array_merge($out, jarvis_music_walk($base, $rel));
        } else {
            $ext = strtolower(pathinfo($entry, PATHINFO_EXTENSION));
            if (in_array($ext, JARVIS_MUSIC_EXT, true)) $out[] = $rel;
        }
    }
    return $out;
}

/**
 * @return array{tracks: array<int,array{artist:string,title:string,file:string}>,
 *               artists: array<string,array<int,string>>}
 */
function jarvis_music_catalog(?string $musicDir = null): array {
    $musicDir = $musicDir ?: realpath(__DIR__ . '/../music');
    $tracks = [];
    $artists = [];
    if ($musicDir && is_dir($musicDir)) {
        foreach (jarvis_music_walk($musicDir) as $rel) {
            $relU = str_replace('\\', '/', $rel);
            $slash = strpos($relU, '/');
            $artist = $slash === false ? 'Vari' : substr($relU, 0, $slash);
            $title  = pathinfo($relU, PATHINFO_FILENAME);
            $tracks[] = [
                'artist' => $artist,
                'title'  => $title,
                'file'   => jarvis_music_url($relU),
            ];
            $artists[$artist][] = $title;
        }
    }
    usort($tracks, fn ($a, $b) =>
        [$a['artist'], $a['title']] <=> [$b['artist'], $b['title']]);
    ksort($artists);
    foreach ($artists as &$list) sort($list);
    unset($list);
    return ['tracks' => $tracks, 'artists' => $artists];
}
