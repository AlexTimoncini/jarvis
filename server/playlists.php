<?php
/**
 * JARVIS - playlists API.
 *
 * POST JSON:
 *   { action: "list" }
 *        -> { ok, playlists: [ { name, count } ] }
 *   { action: "get", name }
 *        -> { ok, playlist: { name, tracks:[{artist,title,file}] } | null }
 *   { action: "create", name, tracks:[{artist,title,file}] }   // overwrite
 *        -> { ok, playlist }
 *   { action: "add", name, tracks:[{artist,title,file}] }       // append (dedupe)
 *        -> { ok, playlist }
 *   { action: "remove", name, files?:[...], titles?:[...] }      // remove tracks
 *        -> { ok, playlist }
 *   { action: "delete", name }
 *        -> { ok }
 */
header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/lib/playlists_lib.php';

$input  = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $input['action'] ?? 'list';

$playlists = jarvis_pl_load();

if ($action === 'list') {
    $out = [];
    foreach ($playlists as $p) {
        $out[] = ['name' => $p['name'] ?? '', 'count' => count($p['tracks'] ?? [])];
    }
    echo json_encode(['ok' => true, 'playlists' => $out], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'get') {
    [$key, $pl] = jarvis_pl_find($playlists, (string) ($input['name'] ?? ''));
    echo json_encode(['ok' => true, 'playlist' => $pl], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($action === 'create') {
    $name = trim((string) ($input['name'] ?? ''));
    $key  = jarvis_pl_norm($name);
    if ($key === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'playlist name required']);
        exit;
    }
    $pl = [
        'name'       => $name,
        'tracks'     => jarvis_pl_clean_tracks($input['tracks'] ?? []),
        'updated_at' => jarvis_pl_now(),
    ];
    $playlists[$key] = $pl;
    if (!jarvis_pl_save($playlists)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'could not save (check server/data writable)']);
        exit;
    }
    echo json_encode(['ok' => true, 'playlist' => $pl], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($action === 'add') {
    $name = trim((string) ($input['name'] ?? ''));
    [$key, $pl] = jarvis_pl_find($playlists, $name);
    if (!$pl) {
        // adding to a non-existing playlist just creates it
        $key = jarvis_pl_norm($name);
        if ($key === '') {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'playlist name required']);
            exit;
        }
        $pl = ['name' => $name, 'tracks' => [], 'updated_at' => jarvis_pl_now()];
    }
    $existing = $pl['tracks'] ?? [];
    $merged = array_merge($existing, jarvis_pl_clean_tracks($input['tracks'] ?? []));
    $pl['tracks'] = jarvis_pl_clean_tracks($merged); // re-dedupe by file
    $pl['updated_at'] = jarvis_pl_now();
    $playlists[$key] = $pl;
    jarvis_pl_save($playlists);
    echo json_encode(['ok' => true, 'playlist' => $pl], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($action === 'remove') {
    $name = trim((string) ($input['name'] ?? ''));
    [$key, $pl] = jarvis_pl_find($playlists, $name);
    if (!$pl) {
        echo json_encode(['ok' => false, 'error' => 'playlist not found']);
        exit;
    }
    $files  = array_map('strval', is_array($input['files'] ?? null) ? $input['files'] : []);
    $titles = array_map(fn ($t) => jarvis_pl_norm((string) $t), is_array($input['titles'] ?? null) ? $input['titles'] : []);
    $pl['tracks'] = array_values(array_filter($pl['tracks'] ?? [], function ($t) use ($files, $titles) {
        if (in_array($t['file'] ?? '', $files, true)) return false;
        if ($titles && in_array(jarvis_pl_norm((string) ($t['title'] ?? '')), $titles, true)) return false;
        return true;
    }));
    $pl['updated_at'] = jarvis_pl_now();
    $playlists[$key] = $pl;
    jarvis_pl_save($playlists);
    echo json_encode(['ok' => true, 'playlist' => $pl], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($action === 'delete') {
    [$key, $pl] = jarvis_pl_find($playlists, (string) ($input['name'] ?? ''));
    if ($key !== null) {
        unset($playlists[$key]);
        jarvis_pl_save($playlists);
        echo json_encode(['ok' => true]);
    } else {
        echo json_encode(['ok' => false, 'error' => 'playlist not found']);
    }
    exit;
}

http_response_code(400);
echo json_encode(['ok' => false, 'error' => 'unknown action']);
