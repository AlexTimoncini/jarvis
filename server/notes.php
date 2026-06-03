<?php
/**
 * JARVIS - notes API.
 *
 * GET (file download, triggers a .txt on the device):
 *   ?action=download&id=...           -> text/plain attachment
 *   ?action=download&title=Spesa      -> text/plain attachment (fuzzy title)
 *
 * POST JSON:
 *   { action: "list" }                                  -> { ok, notes: [{id,title,updated_at,preview}] }
 *   { action: "get", id?|title? }                       -> { ok, note|null }
 *   { action: "add", title, content }                   -> { ok, note }   (upsert: appends if title exists)
 *   { action: "append", title, content }                -> { ok, note }
 *   { action: "delete", id?|title? }                    -> { ok, deleted }
 *
 * Notes are stored in server/data/notes.json (denied to the web by .htaccess);
 * the only way to read them out is through this endpoint.
 */

require __DIR__ . '/lib/notes_lib.php';

$cfgFile = __DIR__ . '/config.php';
$cfg = file_exists($cfgFile) ? require $cfgFile : [];
$apiKey = $cfg['gemini_api_key'] ?? (getenv('GEMINI_API_KEY') ?: '');
$embedModel = $cfg['gemini_embed_model'] ?? 'gemini-embedding-001';

// ---- GET: file download (kept separate so the browser saves a real .txt) ----
if (($_GET['action'] ?? '') === 'download') {
    $notes = jarvis_notes_load();
    [$idx, $note] = jarvis_note_find($notes, (string) ($_GET['id'] ?? ''), (string) ($_GET['title'] ?? ''));
    if (!$note) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Nota non trovata.';
        exit;
    }
    $fname = jarvis_note_filename((string) ($note['title'] ?? 'nota'));
    header('Content-Type: text/plain; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $fname . '"');
    header('X-Content-Type-Options: nosniff');
    echo jarvis_note_as_text($note);
    exit;
}

header('Content-Type: application/json; charset=utf-8');

$input  = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $input['action'] ?? 'list';
$notes  = jarvis_notes_load();

/** Short single-line preview for list views / spoken summaries. */
function jarvis_note_preview(string $content, int $max = 80): string {
    $s = trim(preg_replace('/\s+/', ' ', $content));
    if (mb_strlen($s, 'UTF-8') <= $max) return $s;
    return rtrim(mb_substr($s, 0, $max, 'UTF-8')) . '…';
}

if ($action === 'list') {
    $out = [];
    foreach ($notes as $n) {
        $out[] = [
            'id'         => $n['id'] ?? '',
            'title'      => $n['title'] ?? '',
            'updated_at' => $n['updated_at'] ?? ($n['created_at'] ?? ''),
            'preview'    => jarvis_note_preview((string) ($n['content'] ?? '')),
        ];
    }
    echo json_encode(['ok' => true, 'notes' => $out], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'get') {
    [$idx, $note] = jarvis_note_find($notes, (string) ($input['id'] ?? ''), (string) ($input['title'] ?? ''));
    if ($note) unset($note['embedding']);
    echo json_encode(['ok' => (bool) $note, 'note' => $note ?: null], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($action === 'add' || $action === 'append') {
    $title   = trim((string) ($input['title'] ?? ''));
    $content = trim((string) ($input['content'] ?? ''));
    if ($content === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'content required']);
        exit;
    }
    if ($title === '') $title = 'Nota';

    [$idx, $note] = jarvis_note_find($notes, '', $title);

    // "append" always merges; "add" upserts: if a note with this title already
    // exists we group the new content into it (handy for collecting ideas).
    if ($note && ($action === 'append' || $action === 'add')) {
        $existing = (string) ($note['content'] ?? '');
        $note['content'] = $existing === '' ? $content : ($existing . "\n" . $content);
        $note['updated_at'] = jarvis_note_now();
        $notes[$idx] = $note;
    } else {
        $now  = jarvis_note_now();
        $note = [
            'id'         => jarvis_uid(),
            'title'      => $title,
            'content'    => $content,
            'created_at' => $now,
            'updated_at' => $now,
        ];
        $notes[] = $note;
        $idx = count($notes) - 1;
    }

    // Refresh the semantic embedding (best-effort: search still works without it).
    $emb = jarvis_note_embed(($note['title'] ?? '') . "\n" . ($note['content'] ?? ''), $apiKey, $embedModel);
    if ($emb) {
        $note['embedding'] = $emb;
        if ($idx !== null) $notes[$idx] = $note;
    }

    if (!jarvis_notes_save($notes)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'could not save (check server/data writable)']);
        exit;
    }
    $out = $note; unset($out['embedding']);
    echo json_encode(['ok' => true, 'note' => $out], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($action === 'search') {
    $query = trim((string) ($input['query'] ?? $input['title'] ?? ''));
    if ($query === '') {
        echo json_encode(['ok' => false, 'error' => 'query required']);
        exit;
    }
    if (!count($notes)) { echo json_encode(['ok' => false, 'note' => null, 'matches' => []]); exit; }

    $qv = jarvis_note_embed($query, $apiKey, $embedModel);

    // Lazily backfill embeddings for notes created before this feature.
    $dirty = false;
    if ($qv) {
        foreach ($notes as $i => $n) {
            if (!isset($n['embedding']) || !is_array($n['embedding'])) {
                $e = jarvis_note_embed(($n['title'] ?? '') . "\n" . ($n['content'] ?? ''), $apiKey, $embedModel);
                if ($e) { $notes[$i]['embedding'] = $e; $dirty = true; }
            }
        }
        if ($dirty) jarvis_notes_save($notes);
    }

    $scored = [];
    foreach ($notes as $n) {
        if ($qv && isset($n['embedding']) && is_array($n['embedding'])) {
            $score = jarvis_cosine($qv, $n['embedding']);
        } else {
            // fallback: normalized substring overlap on title+content
            $hay = jarvis_appt_norm(($n['title'] ?? '') . ' ' . ($n['content'] ?? ''));
            $needle = jarvis_appt_norm($query);
            $score = ($needle !== '' && strpos($hay, $needle) !== false) ? 0.5 : 0.0;
        }
        $scored[] = ['note' => $n, 'score' => $score];
    }
    usort($scored, fn ($a, $b) => $b['score'] <=> $a['score']);

    $best = $scored[0] ?? null;
    $matches = [];
    foreach (array_slice($scored, 0, 5) as $s) {
        if ($s['score'] <= 0.0) continue;
        $matches[] = [
            'id'      => $s['note']['id'] ?? '',
            'title'   => $s['note']['title'] ?? '',
            'score'   => round($s['score'], 3),
            'preview' => jarvis_note_preview((string) ($s['note']['content'] ?? '')),
        ];
    }
    // Require a minimal relevance so we don't read back an unrelated note.
    $note = ($best && $best['score'] >= 0.60) ? $best['note'] : null;
    if ($note) unset($note['embedding']);
    echo json_encode(['ok' => (bool) $note, 'note' => $note ?: null, 'matches' => $matches], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($action === 'delete') {
    [$idx, $note] = jarvis_note_find($notes, (string) ($input['id'] ?? ''), (string) ($input['title'] ?? ''));
    if ($idx === null) {
        echo json_encode(['ok' => false, 'deleted' => 0, 'error' => 'note not found']);
        exit;
    }
    array_splice($notes, $idx, 1);
    jarvis_notes_save($notes);
    echo json_encode(['ok' => true, 'deleted' => 1, 'title' => $note['title'] ?? ''], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(400);
echo json_encode(['ok' => false, 'error' => 'unknown action']);
