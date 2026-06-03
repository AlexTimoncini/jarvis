<?php
/**
 * JARVIS - read-only mailbox access over IMAP.
 *
 * Works in TWO modes, chosen automatically:
 *   1) PHP "imap" extension, when installed.
 *   2) Pure-PHP IMAP client over a TLS socket (stream_socket_client + openssl),
 *      so it also runs on shared hosting (e.g. Hetzner KonsoleH) where the imap
 *      extension can't be installed. Needs only openssl + sockets + mbstring.
 *
 * Public API (backend-agnostic):
 *   [$conn,$err] = jarvis_mail_open($cfg)
 *   jarvis_mail_unread_count($conn): int
 *   jarvis_mail_recent($conn, $limit, $unseenOnly): array
 *   jarvis_mail_body($conn, $id): string
 *   jarvis_mail_close($conn): void
 *
 * Reading never marks messages as read (uses BODY.PEEK / FT_PEEK).
 */

/* =========================== shared helpers =========================== */

function jarvis_mail_to_utf8(string $s, ?string $charset): string {
    $charset = $charset ?: 'UTF-8';
    $u = strtoupper($charset);
    if ($u === 'UTF-8' || $u === 'US-ASCII') return $s;
    $conv = @mb_convert_encoding($s, 'UTF-8', $charset);
    return ($conv !== false && $conv !== null) ? $conv : $s;
}

/** Decode a MIME-encoded header (Subject/From) to UTF-8, ext-independent. */
function jarvis_mail_decode_mime(string $s): string {
    if ($s === '') return '';
    if (function_exists('imap_mime_header_decode')) {
        $out = '';
        foreach (imap_mime_header_decode($s) as $w) {
            $cs = (isset($w->charset) && $w->charset && strtoupper($w->charset) !== 'DEFAULT') ? $w->charset : 'UTF-8';
            $out .= jarvis_mail_to_utf8($w->text, $cs);
        }
        return trim($out);
    }
    if (function_exists('mb_decode_mimeheader')) return trim(mb_decode_mimeheader($s));
    return trim($s);
}

/** Extract a friendly sender name from a "Nome <email>" string. */
function jarvis_mail_sender_name(string $from): string {
    $from = jarvis_mail_decode_mime($from);
    if (preg_match('/^\s*"?([^"<]+?)"?\s*<([^>]+)>/', $from, $m)) {
        $name = trim($m[1]);
        return $name !== '' ? $name : $m[2];
    }
    if (preg_match('/<([^>]+)>/', $from, $m)) return $m[1];
    if (strpos($from, '@') !== false) return trim(explode('@', $from)[0]);
    return trim($from);
}

/** Decode a raw body section per its transfer-encoding, then to UTF-8. */
function jarvis_mail_decode_body(string $raw, int $encoding, ?string $charset): string {
    switch ($encoding) {
        case 3: $raw = (string) base64_decode($raw); break;           // BASE64
        case 4: $raw = (string) quoted_printable_decode($raw); break; // QUOTED-PRINTABLE
        default: break;
    }
    return jarvis_mail_to_utf8($raw, $charset);
}

/** Strip an HTML body down to readable plain text. */
function jarvis_mail_html_to_text(string $html): string {
    $html = preg_replace('#<(script|style)[^>]*>.*?</\1>#is', ' ', $html);
    $html = preg_replace('#<br\s*/?>#i', "\n", $html);
    $html = preg_replace('#</(p|div|li|tr|h[1-6])>#i', "\n", $html);
    return (string) html_entity_decode(strip_tags((string) $html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

/** Tidy text for speech/summary: collapse whitespace, cap length. */
function jarvis_mail_clean_text(string $s, int $max = 1500): string {
    $s = preg_replace("/\r\n?/", "\n", $s);
    $s = preg_replace('/[ \t]+/', ' ', $s);
    $s = preg_replace("/\n{3,}/", "\n\n", $s);
    $s = trim((string) $s);
    if (mb_strlen($s, 'UTF-8') > $max) $s = rtrim(mb_substr($s, 0, $max, 'UTF-8')) . '…';
    return $s;
}

/** Italian short date for speech, from an RFC2822 date string. */
function jarvis_mail_when(string $date): string {
    $ts = strtotime($date);
    if (!$ts) return '';
    if ($ts >= strtotime('today')) return 'oggi alle ' . date('H:i', $ts);
    if ($ts >= strtotime('yesterday')) return 'ieri alle ' . date('H:i', $ts);
    return 'il ' . date('d/m', $ts);
}

/**
 * Summarize an email body in 1-2 Italian sentences via Gemini. Returns the
 * summary, or '' on any failure (caller falls back to a trimmed body).
 */
function jarvis_mail_summarize(string $subject, string $body, string $apiKey, string $model): string {
    if ($apiKey === '' || trim($body) === '') return '';
    $sys = "Riassumi questa email in italiano in 1-2 frasi chiare, dette ad alta voce a "
         . "un assistente vocale. Vai dritto al punto (cosa chiede/comunica e eventuali "
         . "scadenze). Niente preamboli.";
    $user = "Oggetto: $subject\n\n" . mb_substr($body, 0, 6000, 'UTF-8');
    $payload = json_encode([
        'system_instruction' => ['parts' => [['text' => $sys]]],
        'contents' => [['role' => 'user', 'parts' => [['text' => $user]]]],
        'generationConfig' => ['temperature' => 0.3],
    ], JSON_UNESCAPED_UNICODE);

    $url = 'https://generativelanguage.googleapis.com/v1beta/models/'
         . rawurlencode($model) . ':generateContent?key=' . rawurlencode($apiKey);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT => 20,
    ]);
    $res = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || !is_string($res)) return '';
    $data = json_decode($res, true);
    return trim((string) ($data['candidates'][0]['content']['parts'][0]['text'] ?? ''));
}

/* ===================== MIME parsing (no-extension path) ===================== */

/** Split a raw RFC822 message/part into [headerBlock, body] at the blank line. */
function jarvis_mime_split(string $raw): array {
    $raw = preg_replace("/\r\n/", "\n", $raw);
    $pos = strpos($raw, "\n\n");
    if ($pos === false) return [$raw, ''];
    return [substr($raw, 0, $pos), substr($raw, $pos + 2)];
}

/** Parse a header block into a lowercased-key map (with folding unfolded). */
function jarvis_mime_headers(string $head): array {
    $head = preg_replace("/\r\n/", "\n", $head);
    $head = preg_replace("/\n[ \t]+/", ' ', $head); // unfold continuation lines
    $out = [];
    foreach (explode("\n", $head) as $line) {
        if (preg_match('/^([A-Za-z0-9-]+):\s?(.*)$/', $line, $m)) {
            $out[strtolower($m[1])] = $m[2];
        }
    }
    return $out;
}

/** Decode a leaf text part (per CTE + charset). */
function jarvis_mime_decode_text(array $h, string $body): string {
    $cte = strtolower(trim($h['content-transfer-encoding'] ?? '7bit'));
    $charset = 'UTF-8';
    if (preg_match('/charset="?([^";\s]+)"?/i', $h['content-type'] ?? '', $m)) $charset = $m[1];
    $enc = $cte === 'base64' ? 3 : ($cte === 'quoted-printable' ? 4 : 0);
    return jarvis_mail_decode_body($body, $enc, $charset);
}

/** Render a MIME message/part to plain text (prefers text/plain). */
function jarvis_mime_render(array $h, string $body): string {
    $ctype = strtolower($h['content-type'] ?? 'text/plain');
    if (strpos($ctype, 'multipart/') === 0 && preg_match('/boundary="?([^";]+)"?/i', $h['content-type'], $m)) {
        $boundary = $m[1];
        $chunks = preg_split('/--' . preg_quote($boundary, '/') . '(--)?[ \t]*\r?\n?/', $body);
        $plain = ''; $html = '';
        foreach ($chunks as $chunk) {
            if (trim($chunk) === '') continue;
            [$ph, $pb] = jarvis_mime_split($chunk);
            $hh = jarvis_mime_headers($ph);
            $pct = strtolower($hh['content-type'] ?? 'text/plain');
            if (strpos($pct, 'multipart/') === 0) {
                $sub = jarvis_mime_render($hh, $pb);
                if (trim($sub) !== '' && $plain === '') $plain = $sub;
            } elseif (strpos($pct, 'text/plain') === 0 && $plain === '') {
                $plain = jarvis_mime_decode_text($hh, $pb);
            } elseif (strpos($pct, 'text/html') === 0 && $html === '') {
                $html = jarvis_mime_decode_text($hh, $pb);
            }
        }
        if (trim($plain) !== '') return $plain;
        if (trim($html) !== '') return jarvis_mail_html_to_text($html);
        return '';
    }
    $txt = jarvis_mime_decode_text($h, $body);
    if (strpos($ctype, 'text/html') === 0) return jarvis_mail_html_to_text($txt);
    return $txt;
}

/** Full raw RFC822 message -> readable plain text. */
function jarvis_mime_to_text(string $raw): string {
    [$head, $body] = jarvis_mime_split($raw);
    return jarvis_mail_clean_text(jarvis_mime_render(jarvis_mime_headers($head), $body));
}

/* ===================== socket IMAP client (no extension) ===================== */

class JarvisImapSocket {
    private $fp = null;
    private int $seq = 0;
    public string $err = '';

    public function connect(array $cfg): bool {
        $host = (string) ($cfg['host'] ?? '');
        $port = (int) ($cfg['port'] ?? 993);
        $enc  = strtolower((string) ($cfg['encryption'] ?? 'ssl'));
        $transport = ($enc === 'ssl') ? 'ssl' : 'tcp';
        $ssl = ['SNI_enabled' => true];
        if (!empty($cfg['novalidate'])) { $ssl['verify_peer'] = false; $ssl['verify_peer_name'] = false; }
        $ctx = stream_context_create(['ssl' => $ssl]);

        $errno = 0; $errstr = '';
        $this->fp = @stream_socket_client("$transport://$host:$port", $errno, $errstr, 12, STREAM_CLIENT_CONNECT, $ctx);
        if (!$this->fp) { $this->err = $errstr ?: "connessione fallita ($errno)"; return false; }
        stream_set_timeout($this->fp, 12);
        $greeting = fgets($this->fp); // * OK ...
        if ($greeting === false) { $this->err = 'nessuna risposta dal server'; return false; }

        if ($enc === 'tls') { // STARTTLS on a plain connection (e.g. port 143)
            $tag = $this->nextTag();
            $r = $this->send($tag, 'STARTTLS');
            if (!$this->ok($r, $tag)) { $this->err = 'STARTTLS rifiutato'; return false; }
            $method = STREAM_CRYPTO_METHOD_TLS_CLIENT;
            if (defined('STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT')) {
                $method |= STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT;
            }
            if (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT')) {
                $method |= STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT;
            }
            $crypto = @stream_socket_enable_crypto($this->fp, true, $method);
            if ($crypto !== true) {
                $detail = function_exists('error_get_last') ? (error_get_last()['message'] ?? '') : '';
                $this->err = 'handshake TLS fallito' . ($detail ? " ($detail)" : '');
                return false;
            }
        }
        return true;
    }

    public function login(string $user, string $pass): bool {
        $tag = $this->nextTag();
        $r = $this->send($tag, 'LOGIN ' . $this->quote($user) . ' ' . $this->quote($pass));
        if (!$this->ok($r, $tag)) { $this->err = 'login rifiutato (credenziali?)'; return false; }
        return true;
    }

    /** SELECT INBOX, returning the EXISTS count (or -1 on error). */
    public function selectInbox(string $mailbox = 'INBOX'): int {
        $tag = $this->nextTag();
        $r = $this->send($tag, 'SELECT ' . $this->quote($mailbox));
        if (!$this->ok($r, $tag)) { $this->err = 'SELECT fallito'; return -1; }
        if (preg_match('/\*\s+(\d+)\s+EXISTS/i', $r, $m)) return (int) $m[1];
        return 0;
    }

    public function unreadCount(): int {
        if ($this->selectInbox() < 0) return 0;
        return count($this->searchUnseen());
    }

    /** Returns a list of UNSEEN message sequence numbers. */
    private function searchUnseen(): array {
        $tag = $this->nextTag();
        $r = $this->send($tag, 'SEARCH UNSEEN');
        if (preg_match('/\*\s+SEARCH([0-9 ]*)/i', $r, $m)) {
            $ids = preg_split('/\s+/', trim($m[1]));
            return array_values(array_filter(array_map('intval', $ids)));
        }
        return [];
    }

    public function recent(int $limit, bool $unseenOnly): array {
        $total = $this->selectInbox();
        if ($total < 0) return [];
        if ($unseenOnly) {
            $ids = $this->searchUnseen();
            rsort($ids);
        } else {
            $ids = [];
            for ($i = $total; $i >= 1 && count($ids) < $limit; $i--) $ids[] = $i;
        }
        $ids = array_slice($ids, 0, $limit);

        $items = [];
        foreach ($ids as $n) {
            $tag = $this->nextTag();
            $r = $this->send($tag, "FETCH $n (FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])");
            $seen = (stripos($r, '\\Seen') !== false);
            $hblock = $this->firstLiteral($r);
            $h = jarvis_mime_headers($hblock);
            $from = (string) ($h['from'] ?? '');
            $items[] = [
                'msgno'    => (int) $n,
                'uid'      => null,
                'from'     => jarvis_mail_decode_mime($from),
                'fromName' => jarvis_mail_sender_name($from),
                'subject'  => jarvis_mail_decode_mime((string) ($h['subject'] ?? '')) ?: '(senza oggetto)',
                'date'     => (string) ($h['date'] ?? ''),
                'seen'     => $seen,
            ];
        }
        return $items;
    }

    public function body(int $seq): string {
        $tag = $this->nextTag();
        $r = $this->send($tag, "FETCH $seq (BODY.PEEK[])");
        $raw = $this->firstLiteral($r);
        if ($raw === '') return '';
        return jarvis_mime_to_text($raw);
    }

    public function close(): void {
        if ($this->fp) {
            $tag = $this->nextTag();
            @$this->send($tag, 'LOGOUT');
            @fclose($this->fp);
            $this->fp = null;
        }
    }

    /* ---- low level ---- */

    private function nextTag(): string { return 'a' . (++$this->seq); }

    private function send(string $tag, string $command): string {
        if (!$this->fp) return '';
        @fwrite($this->fp, $tag . ' ' . $command . "\r\n");
        return $this->readUntilTag($tag);
    }

    /** Read a full tagged response, consuming IMAP literals ({n}) inline. */
    private function readUntilTag(string $tag): string {
        $buf = '';
        $guard = 0;
        while ($this->fp && !feof($this->fp) && $guard++ < 100000) {
            $line = fgets($this->fp);
            if ($line === false) break;
            $buf .= $line;
            if (preg_match('/\{(\d+)\}\r?\n$/', $line, $m)) {
                $need = (int) $m[1];
                $data = '';
                while (strlen($data) < $need && $this->fp && !feof($this->fp)) {
                    $chunk = fread($this->fp, $need - strlen($data));
                    if ($chunk === false || $chunk === '') break;
                    $data .= $chunk;
                }
                $buf .= $data;
                continue;
            }
            if (preg_match('/^' . preg_quote($tag, '/') . ' (OK|NO|BAD)/i', $line)) break;
            $meta = stream_get_meta_data($this->fp);
            if (!empty($meta['timed_out'])) break;
        }
        return $buf;
    }

    private function ok(string $resp, string $tag): bool {
        return (bool) preg_match('/^' . preg_quote($tag, '/') . ' OK/im', $resp);
    }

    private function firstLiteral(string $raw): string {
        if (preg_match('/\{(\d+)\}\r?\n/', $raw, $m, PREG_OFFSET_CAPTURE)) {
            $n = (int) $m[1][0];
            $start = $m[0][1] + strlen($m[0][0]);
            return substr($raw, $start, $n);
        }
        return '';
    }

    private function quote(string $s): string {
        return '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $s) . '"';
    }
}

/* ===================== extension backend helpers ===================== */

function jarvis_mail_string(array $cfg): string {
    $host = (string) ($cfg['host'] ?? '');
    $port = (int) ($cfg['port'] ?? 993);
    $enc  = strtolower((string) ($cfg['encryption'] ?? 'ssl'));
    $flags = '/imap';
    if ($enc === 'ssl') $flags .= '/ssl';
    elseif ($enc === 'tls') $flags .= '/tls';
    else $flags .= '/notls';
    if (!empty($cfg['novalidate'])) $flags .= '/novalidate-cert';
    $mbox = (string) ($cfg['mailbox'] ?? 'INBOX') ?: 'INBOX';
    return '{' . $host . ':' . $port . $flags . '}' . $mbox;
}

function jarvis_mail_charset($part): string {
    foreach (['parameters', 'dparameters'] as $k) {
        if (!empty($part->$k) && is_array($part->$k)) {
            foreach ($part->$k as $p) {
                if (isset($p->attribute) && strtoupper($p->attribute) === 'CHARSET') return (string) $p->value;
            }
        }
    }
    return 'UTF-8';
}

function jarvis_mail_ext_find_part($imap, int $msgno, $structure, string $wantSubtype, string $prefix = ''): ?string {
    if (!empty($structure->parts) && is_array($structure->parts)) {
        foreach ($structure->parts as $i => $part) {
            $pn = $prefix === '' ? (string) ($i + 1) : ($prefix . '.' . ($i + 1));
            $found = jarvis_mail_ext_find_part($imap, $msgno, $part, $wantSubtype, $pn);
            if ($found !== null) return $found;
        }
        return null;
    }
    $type = (int) ($structure->type ?? 0);
    $sub  = strtoupper((string) ($structure->subtype ?? ''));
    if ($type === 0 && $sub === $wantSubtype) {
        $pn = $prefix === '' ? '1' : $prefix;
        $raw = (string) imap_fetchbody($imap, $msgno, $pn, FT_PEEK);
        return jarvis_mail_decode_body($raw, (int) ($structure->encoding ?? 0), jarvis_mail_charset($structure));
    }
    return null;
}

function jarvis_mail_ext_body($imap, int $msgno): string {
    $structure = @imap_fetchstructure($imap, $msgno);
    if (!$structure) return jarvis_mail_clean_text(jarvis_mail_decode_body((string) imap_body($imap, $msgno, FT_PEEK), 0, 'UTF-8'));
    $plain = jarvis_mail_ext_find_part($imap, $msgno, $structure, 'PLAIN');
    if ($plain !== null && trim($plain) !== '') return jarvis_mail_clean_text($plain);
    $html = jarvis_mail_ext_find_part($imap, $msgno, $structure, 'HTML');
    if ($html !== null && trim($html) !== '') return jarvis_mail_clean_text(jarvis_mail_html_to_text($html));
    $raw = (string) imap_body($imap, $msgno, FT_PEEK);
    return jarvis_mail_clean_text(jarvis_mail_decode_body($raw, (int) ($structure->encoding ?? 0), jarvis_mail_charset($structure)));
}

function jarvis_mail_ext_recent($imap, int $limit, bool $unseenOnly): array {
    $total = @imap_num_msg($imap);
    if (!$total || $total < 1) return [];
    if ($unseenOnly) {
        $nums = @imap_search($imap, 'UNSEEN');
        $nums = is_array($nums) ? $nums : [];
        rsort($nums);
    } else {
        $nums = [];
        for ($i = $total; $i >= 1 && count($nums) < $limit; $i--) $nums[] = $i;
    }
    $nums = array_slice($nums, 0, $limit);
    $items = [];
    foreach ($nums as $n) {
        $ov = @imap_fetch_overview($imap, (string) $n, 0);
        $o = is_array($ov) && isset($ov[0]) ? $ov[0] : null;
        if (!$o) continue;
        $from = (string) ($o->from ?? '');
        $items[] = [
            'msgno'    => (int) $n,
            'uid'      => isset($o->uid) ? (int) $o->uid : null,
            'from'     => jarvis_mail_decode_mime($from),
            'fromName' => jarvis_mail_sender_name($from),
            'subject'  => jarvis_mail_decode_mime((string) ($o->subject ?? '')) ?: '(senza oggetto)',
            'date'     => (string) ($o->date ?? ''),
            'seen'     => !empty($o->seen),
        ];
    }
    return $items;
}

/* ===================== public API (dispatches per backend) ===================== */

/**
 * Open the mailbox. Returns [conn|null, ?errorString]. `conn` is an opaque
 * array used by the functions below.
 */
function jarvis_mail_open(array $cfg) {
    if (empty($cfg['enabled'])) return [null, 'mail disabled'];
    if (($cfg['host'] ?? '') === '' || ($cfg['username'] ?? '') === '' || ($cfg['password'] ?? '') === '') {
        return [null, 'mail not configured'];
    }

    // Prefer the native extension when present.
    if (function_exists('imap_open')) {
        if (function_exists('imap_timeout')) { @imap_timeout(IMAP_OPENTIMEOUT, 12); @imap_timeout(IMAP_READTIMEOUT, 12); }
        $imap = @imap_open(jarvis_mail_string($cfg), (string) $cfg['username'], (string) $cfg['password'], 0, 1);
        if ($imap) return [['type' => 'ext', 'imap' => $imap], null];
        // fall through to the socket client below
    }

    // Fallback: pure-PHP IMAP over a TLS socket (no extension required).
    if (!function_exists('stream_socket_client')) {
        return [null, 'no imap extension and sockets are disabled'];
    }
    $c = new JarvisImapSocket();
    if (!$c->connect($cfg)) return [null, 'imap socket: ' . $c->err];
    if (!$c->login((string) $cfg['username'], (string) $cfg['password'])) return [null, 'imap socket: ' . $c->err];
    return [['type' => 'sock', 'sock' => $c], null];
}

function jarvis_mail_unread_count($conn): int {
    if (!is_array($conn)) return 0;
    if ($conn['type'] === 'ext') {
        $r = @imap_search($conn['imap'], 'UNSEEN');
        return is_array($r) ? count($r) : 0;
    }
    return $conn['sock']->unreadCount();
}

function jarvis_mail_recent($conn, int $limit, bool $unseenOnly = false): array {
    if (!is_array($conn)) return [];
    if ($conn['type'] === 'ext') return jarvis_mail_ext_recent($conn['imap'], $limit, $unseenOnly);
    return $conn['sock']->recent($limit, $unseenOnly);
}

function jarvis_mail_body($conn, int $id): string {
    if (!is_array($conn)) return '';
    if ($conn['type'] === 'ext') return jarvis_mail_ext_body($conn['imap'], $id);
    return $conn['sock']->body($id);
}

function jarvis_mail_close($conn): void {
    if (!is_array($conn)) return;
    if ($conn['type'] === 'ext') { @imap_close($conn['imap']); return; }
    $conn['sock']->close();
}
