<?php
/**
 * JARVIS - notes storage & helpers.
 *
 * Notes live in server/data/notes.json. Each record:
 *   {
 *     "id":         "abc123",
 *     "title":      "Idee progetto",
 *     "content":    "- Punto uno\n- Punto due",   // plain text, may be multi-line
 *     "created_at": "2026-06-03 11:00",
 *     "updated_at": "2026-06-03 11:20"
 *   }
 *
 * Reuses the appointments lib for the timezone, uid and the
 * accent/case-insensitive title normalizer.
 */

require_once __DIR__ . '/appointments_lib.php';

function jarvis_notes_file(): string {
    return jarvis_data_dir() . '/notes.json';
}

function jarvis_notes_load(): array {
    $f = jarvis_notes_file();
    if (!is_file($f)) return [];
    $data = json_decode((string) file_get_contents($f), true);
    return is_array($data) ? $data : [];
}

function jarvis_notes_save(array $notes): bool {
    $f = jarvis_notes_file();
    $json = json_encode(array_values($notes), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    return @file_put_contents($f, $json, LOCK_EX) !== false;
}

function jarvis_note_now(): string {
    return (new DateTime('now', jarvis_tz()))->format('Y-m-d H:i');
}

/**
 * Find a note by id (preferred) or by fuzzy title match.
 * @return array{0:?int,1:?array} [index, note] or [null, null].
 */
function jarvis_note_find(array $notes, string $id = '', string $title = ''): array {
    if ($id !== '') {
        foreach ($notes as $i => $n) {
            if (($n['id'] ?? '') === $id) return [$i, $n];
        }
    }
    $q = jarvis_appt_norm($title);
    if ($q === '') return [null, null];
    // exact normalized title first
    foreach ($notes as $i => $n) {
        if (jarvis_appt_norm((string) ($n['title'] ?? '')) === $q) return [$i, $n];
    }
    // then a forgiving substring match either way
    foreach ($notes as $i => $n) {
        $t = jarvis_appt_norm((string) ($n['title'] ?? ''));
        if ($t !== '' && (strpos($t, $q) !== false || strpos($q, $t) !== false)) return [$i, $n];
    }
    return [null, null];
}

/** Safe ASCII filename for the downloaded .txt (e.g. "idee_progetto.txt"). */
function jarvis_note_filename(string $title): string {
    $base = jarvis_appt_norm($title);              // accents/punctuation stripped, lowercased
    $base = preg_replace('/\s+/', '_', trim($base));
    if ($base === '') $base = 'nota';
    return $base . '.txt';
}

/**
 * Compute a semantic embedding for a piece of text via the Gemini
 * embeddings API (text-embedding-004). Returns a float[] or null on failure.
 */
function jarvis_note_embed(string $text, string $apiKey, string $model = 'gemini-embedding-001'): ?array {
    $text = trim($text);
    if ($text === '' || $apiKey === '') return null;
    // keep the payload small
    if (mb_strlen($text, 'UTF-8') > 8000) $text = mb_substr($text, 0, 8000, 'UTF-8');

    $url = 'https://generativelanguage.googleapis.com/v1beta/models/'
         . rawurlencode($model) . ':embedContent?key=' . rawurlencode($apiKey);
    $payload = json_encode([
        'model'   => 'models/' . $model,
        'content' => ['parts' => [['text' => $text]]],
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT => 15,
    ]);
    $res = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || !is_string($res)) return null;
    $data = json_decode($res, true);
    $vals = $data['embedding']['values'] ?? null;
    if (!is_array($vals) || !count($vals)) return null;
    return array_map('floatval', $vals);
}

/** Cosine similarity between two equal-length vectors (0 if invalid). */
function jarvis_cosine(array $a, array $b): float {
    $n = min(count($a), count($b));
    if ($n === 0) return 0.0;
    $dot = 0.0; $na = 0.0; $nb = 0.0;
    for ($i = 0; $i < $n; $i++) {
        $dot += $a[$i] * $b[$i];
        $na += $a[$i] * $a[$i];
        $nb += $b[$i] * $b[$i];
    }
    if ($na <= 0 || $nb <= 0) return 0.0;
    return $dot / (sqrt($na) * sqrt($nb));
}

/** Render a note as a human-friendly .txt document. */
function jarvis_note_as_text(array $note): string {
    $title   = (string) ($note['title'] ?? 'Nota');
    $created = (string) ($note['created_at'] ?? '');
    $updated = (string) ($note['updated_at'] ?? '');
    $body    = (string) ($note['content'] ?? '');

    $lines = [];
    $lines[] = $title;
    $lines[] = str_repeat('=', max(3, mb_strlen($title, 'UTF-8')));
    if ($created !== '') $lines[] = 'Creata: ' . $created;
    if ($updated !== '' && $updated !== $created) $lines[] = 'Aggiornata: ' . $updated;
    $lines[] = '';
    $lines[] = $body;
    $lines[] = '';
    $lines[] = '— J.A.R.V.I.S.';
    return implode("\n", $lines) . "\n";
}
