<?php
/**
 * JARVIS - appointments storage & scheduling helpers.
 *
 * Appointments live in server/data/appointments.json. Each record:
 *   {
 *     "id":         "abc123",
 *     "title":      "Dentista",
 *     "datetime":   "2026-06-10 15:30",   // local (Europe/Rome), base occurrence
 *     "recurrence": "none|daily|weekly|monthly|yearly",
 *     "reminders":  ["-1d", "-1h"],       // offsets BEFORE the occurrence
 *     "notes":      "",
 *     "created_at": "2026-06-01 14:00",
 *     "sent":       { "2026-06-10 15:30|-1d": 1, ... }  // dedupe per occurrence+offset
 *   }
 *
 * All times are handled in the configured timezone (default Europe/Rome).
 */

const JARVIS_TZ_DEFAULT = 'Europe/Rome';

function jarvis_tz(): DateTimeZone {
    static $tz = null;
    if ($tz) return $tz;
    $cfgFile = __DIR__ . '/../config.php';
    $cfg = is_file($cfgFile) ? require $cfgFile : [];
    $name = $cfg['timezone'] ?? JARVIS_TZ_DEFAULT;
    try { $tz = new DateTimeZone($name); }
    catch (Exception $e) { $tz = new DateTimeZone(JARVIS_TZ_DEFAULT); }
    return $tz;
}

function jarvis_data_dir(): string {
    $dir = __DIR__ . '/../data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir;
}

function jarvis_appts_file(): string {
    return jarvis_data_dir() . '/appointments.json';
}

function jarvis_appts_load(): array {
    $f = jarvis_appts_file();
    if (!is_file($f)) return [];
    $data = json_decode((string) file_get_contents($f), true);
    return is_array($data) ? $data : [];
}

function jarvis_appts_save(array $appts): bool {
    $f = jarvis_appts_file();
    $json = json_encode(array_values($appts), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    return @file_put_contents($f, $json, LOCK_EX) !== false;
}

/** Normalize a reminder offset like "-1d","1h","30m","-2w" to seconds (>=0). */
function jarvis_offset_seconds(string $off): int {
    $off = strtolower(trim($off));
    if ($off === '' || $off === '0') return 0;
    if (!preg_match('/^-?\s*(\d+)\s*([smhdw])$/', $off, $m)) return 0;
    $n = (int) $m[1];
    $unit = $m[2];
    $mul = ['s' => 1, 'm' => 60, 'h' => 3600, 'd' => 86400, 'w' => 604800][$unit] ?? 0;
    return $n * $mul;
}

/** Sanitize a reminders array; fall back to the defaults if empty/invalid. */
function jarvis_clean_reminders($reminders, array $default = ['-1d', '-1h']): array {
    $out = [];
    if (is_array($reminders)) {
        foreach ($reminders as $r) {
            $r = strtolower(trim((string) $r));
            if ($r === '') continue;
            // normalize to a leading "-" form
            if ($r[0] !== '-') $r = '-' . $r;
            if (preg_match('/^-(\d+)([smhdw])$/', $r)) $out[$r] = true;
        }
    }
    $out = array_keys($out);
    if (!$out) $out = $default; // default: day before + hour before (all-day: day before)
    return $out;
}

/** True if the string carries only a date (no time component). */
function jarvis_is_date_only(string $s): bool {
    $s = trim(str_replace('T', ' ', $s));
    return (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $s);
}

/** Normalize a title for forgiving matching (accents/case/punct insensitive). */
function jarvis_appt_norm(string $s): string {
    $s = mb_strtolower(trim($s), 'UTF-8');
    if (class_exists('Normalizer')) {
        $n = Normalizer::normalize($s, Normalizer::FORM_D);
        if (is_string($n)) $s = preg_replace('/\p{Mn}+/u', '', $n);
    }
    $s = preg_replace('/[^a-z0-9]+/', ' ', $s);
    return trim($s);
}

/** True if the appointment has at least one occurrence on the given day. */
function jarvis_appt_on_date(array $appt, string $dateYmd): bool {
    $day = jarvis_parse_dt($dateYmd);
    if (!$day) return false;
    $from = (clone $day)->setTime(0, 0, 0);
    $until = (clone $day)->setTime(23, 59, 59);
    return count(jarvis_occurrences($appt, $from, $until)) > 0;
}

/** Parse a "Y-m-d H:i[:s]" local string into a DateTime, or null. */
function jarvis_parse_dt(string $s): ?DateTime {
    $s = trim($s);
    if ($s === '') return null;
    // accept ISO "T" separator too
    $s = str_replace('T', ' ', $s);
    foreach (['Y-m-d H:i:s', 'Y-m-d H:i', 'Y-m-d'] as $fmt) {
        $dt = DateTime::createFromFormat($fmt, $s, jarvis_tz());
        if ($dt instanceof DateTime) {
            if ($fmt === 'Y-m-d') $dt->setTime(9, 0); // default morning
            return $dt;
        }
    }
    try { return new DateTime($s, jarvis_tz()); } catch (Exception $e) { return null; }
}

/**
 * Occurrences of an appointment within [$from, $until] (inclusive of edges
 * by a small grace). Handles recurrence. Returns DateTime[] (local tz).
 */
function jarvis_occurrences(array $appt, DateTime $from, DateTime $until): array {
    $base = jarvis_parse_dt((string) ($appt['datetime'] ?? ''));
    if (!$base) return [];
    $rec = strtolower((string) ($appt['recurrence'] ?? 'none'));
    $out = [];

    if ($rec === 'none' || $rec === '') {
        if ($base >= $from && $base <= $until) $out[] = clone $base;
        return $out;
    }

    $step = [
        'daily'   => 'P1D',
        'weekly'  => 'P1W',
        'monthly' => 'P1M',
        'yearly'  => 'P1Y',
    ][$rec] ?? null;
    if (!$step) {
        if ($base >= $from && $base <= $until) $out[] = clone $base;
        return $out;
    }

    $interval = new DateInterval($step);
    $cur = clone $base;
    // fast-forward to just before $from without an unbounded loop
    $guard = 0;
    while ($cur < $from && $guard < 100000) { $cur->add($interval); $guard++; }
    while ($cur <= $until && $guard < 100000) {
        if ($cur >= $from) $out[] = clone $cur;
        $cur = (clone $cur)->add($interval);
        $guard++;
    }
    return $out;
}

/** Stable per-occurrence+offset key for dedupe. */
function jarvis_sent_key(DateTime $occ, string $offset): string {
    return $occ->format('Y-m-d H:i') . '|' . $offset;
}

function jarvis_uid(): string {
    return substr(bin2hex(random_bytes(8)), 0, 12);
}
