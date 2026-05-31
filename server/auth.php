<?php
/**
 * JARVIS - access code gate.
 *
 * POST JSON:
 *   { action: "verify", code: "..." }  -> { ok: bool }
 *   { action: "update", code: "..." }  -> { ok: bool, code?: string }
 *
 * The access code lives in server/config.php ('access_code'). Updating
 * rewrites that single value in place. Comparison is case/spacing/
 * punctuation insensitive so spoken codes match reliably.
 */

header('Content-Type: application/json; charset=utf-8');

$cfgFile = __DIR__ . '/config.php';

$accessPattern = "/'access_code'\s*=>\s*'((?:[^'\\\\]|\\\\.)*)'/";

/** Read the access code straight from the file text (opcache-proof). */
function jarvis_read_code(string $file, string $pattern): string {
    if (!is_file($file)) return '';
    $src = file_get_contents($file);
    if (preg_match($pattern, $src, $m)) {
        return stripcslashes($m[1]); // undo \\ and \' escaping
    }
    return '';
}

$current = jarvis_read_code($cfgFile, $accessPattern);

$input  = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $input['action'] ?? 'verify';
$code   = (string) ($input['code'] ?? '');

/** Loose normalization for spoken codes: lowercase, drop accents/punct. */
function jarvis_norm(string $s): string {
    $s = mb_strtolower(trim($s), 'UTF-8');
    // strip accents
    $s = strtr($s, [
        'à' => 'a', 'è' => 'e', 'é' => 'e', 'ì' => 'i', 'ò' => 'o', 'ù' => 'u',
    ]);
    // keep only letters/digits/spaces, then collapse whitespace
    $s = preg_replace('/[^a-z0-9\s]/u', '', $s);
    $s = preg_replace('/\s+/u', ' ', $s);
    return trim($s);
}

if ($action === 'verify') {
    $ok = $current !== '' && jarvis_norm($code) === jarvis_norm($current);
    echo json_encode(['ok' => $ok]);
    exit;
}

if ($action === 'update') {
    $new = trim($code);
    if ($new === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'empty code']);
        exit;
    }
    if (!is_writable($cfgFile)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'config not writable']);
        exit;
    }

    $src = file_get_contents($cfgFile);
    // Escape for a single-quoted PHP string literal.
    $escaped = str_replace(['\\', "'"], ['\\\\', "\\'"], $new);
    $replacement = "'access_code' => '" . $escaped . "'";

    $had = (bool) preg_match($accessPattern, $src);
    if ($had) {
        $out = preg_replace($accessPattern, $replacement, $src, 1);
    } else {
        // Key missing: inject it just before the closing "];".
        $out = preg_replace('/\];\s*$/', "    $replacement,\n];\n", $src, 1);
    }

    if ($out === null || ($out === $src && !$had)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'rewrite failed']);
        exit;
    }

    if (function_exists('opcache_invalidate')) @opcache_invalidate($cfgFile, true);

    if (@file_put_contents($cfgFile, $out) === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'write failed']);
        exit;
    }

    echo json_encode(['ok' => true, 'code' => $new]);
    exit;
}

http_response_code(400);
echo json_encode(['ok' => false, 'error' => 'unknown action']);
