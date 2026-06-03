<?php
/**
 * JARVIS - reminder dispatcher. Call from cron via curl, e.g.:
 *
 *   * * * * * curl -fsS "https://tuodominio/server/cron.php?key=IL_TUO_TOKEN" >/dev/null 2>&1
 *
 * Scans appointments, finds reminders that are due now (not yet sent),
 * sends a Web Push for each, and records them so they fire only once.
 * Recurrences (daily/weekly/monthly/yearly) are expanded on the fly.
 */
header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/lib/push_lib.php';

$cfg = jarvis_cfg();

// ---- auth (token via ?key= or X-Cron-Key header) ----
$secret = (string) ($cfg['cron_secret'] ?? '');
$given  = (string) ($_GET['key'] ?? ($_SERVER['HTTP_X_CRON_KEY'] ?? ''));
if ($secret === '' || !hash_equals($secret, $given)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'forbidden']);
    exit;
}

$tz  = jarvis_tz();
$now = new DateTime('now', $tz);

// Look-ahead must cover the largest reminder offset; 31d is plenty.
$windowStart = (clone $now)->sub(new DateInterval('P1D'));
$windowEnd   = (clone $now)->add(new DateInterval('P31D'));

/** Human label for an offset before the event ("-1d" -> "Domani"). */
function jarvis_reminder_label(string $off): string {
    $secs = jarvis_offset_seconds($off);
    if ($secs <= 0) return 'Ora';
    if ($secs % 604800 === 0) { $n = $secs / 604800; return $n === 1 ? 'Tra una settimana' : "Tra $n settimane"; }
    if ($secs % 86400 === 0)  { $n = $secs / 86400;  return $n === 1 ? 'Domani' : "Tra $n giorni"; }
    if ($secs % 3600 === 0)   { $n = $secs / 3600;   return $n === 1 ? "Tra un'ora" : "Tra $n ore"; }
    $n = max(1, (int) round($secs / 60));
    return "Tra $n minuti";
}

$appts = jarvis_appts_load();
$sent = 0;
$dirty = false;

foreach ($appts as &$appt) {
    $reminders = jarvis_clean_reminders($appt['reminders'] ?? null);
    if (!isset($appt['sent']) || !is_array($appt['sent'])) {
        // stdClass from JSON decodes to array when assoc=true; ensure array
        $appt['sent'] = (array) ($appt['sent'] ?? []);
    }
    $occs = jarvis_occurrences($appt, $windowStart, $windowEnd);

    foreach ($occs as $occ) {
        $occEndGrace = (clone $occ)->add(new DateInterval('PT60S'));
        foreach ($reminders as $off) {
            $secs = jarvis_offset_seconds($off);
            $remTime = (clone $occ)->sub(new DateInterval('PT' . $secs . 'S'));
            $key = jarvis_sent_key($occ, $off);

            // Due if we've reached the reminder time and the event hasn't passed.
            if ($now >= $remTime && $now <= $occEndGrace && empty($appt['sent'][$key])) {
                $when = $occ->format('d/m H:i');
                $payload = [
                    'title' => 'J.A.R.V.I.S. — Promemoria',
                    'body'  => jarvis_reminder_label($off) . ': ' . ($appt['title'] ?? 'Impegno') . " ($when)",
                    'tag'   => ($appt['id'] ?? 'appt') . '|' . $key,
                    'url'   => '/',
                ];
                jarvis_push_send_all($payload);
                $appt['sent'][$key] = $now->format('Y-m-d H:i:s');
                $sent++;
                $dirty = true;
            }
        }
    }

    // Tidy: drop one-off appointments that are well past (and already notified).
    if (($appt['recurrence'] ?? 'none') === 'none') {
        $base = jarvis_parse_dt((string) ($appt['datetime'] ?? ''));
        if ($base && $base < (clone $now)->sub(new DateInterval('P2D'))) {
            $appt['_expired'] = true;
            $dirty = true;
        }
    }
}
unset($appt);

if ($dirty) {
    $appts = array_values(array_filter($appts, fn ($a) => empty($a['_expired'])));
    jarvis_appts_save($appts);
}

echo json_encode(['ok' => true, 'now' => $now->format('Y-m-d H:i'), 'sent' => $sent]);
