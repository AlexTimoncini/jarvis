<?php
/**
 * JARVIS - appointments API.
 *
 * POST JSON:
 *   { action: "add", title, datetime, recurrence?, reminders?[], notes? }
 *        -> { ok, appointment }
 *   { action: "list" }            -> { ok, appointments: [...] }
 *   { action: "delete", id }      -> { ok }
 *
 * Times are interpreted in the configured timezone (Europe/Rome).
 */
header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/lib/appointments_lib.php';

$input  = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $input['action'] ?? 'list';

if ($action === 'list') {
    echo json_encode(['ok' => true, 'appointments' => array_values(jarvis_appts_load())], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'add') {
    $title = trim((string) ($input['title'] ?? ''));
    $dtRaw = (string) ($input['datetime'] ?? '');
    $dt = jarvis_parse_dt($dtRaw);
    if ($title === '' || !$dt) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'title and valid datetime required']);
        exit;
    }
    // All-day if the user gave no time (date-only) or the client says so.
    $allDay = !empty($input['all_day']) || jarvis_is_date_only($dtRaw);
    $rec = strtolower(trim((string) ($input['recurrence'] ?? 'none')));
    if (!in_array($rec, ['none', 'daily', 'weekly', 'monthly', 'yearly'], true)) $rec = 'none';

    $appt = [
        'id'         => jarvis_uid(),
        'title'      => $title,
        'datetime'   => $dt->format('Y-m-d H:i'), // all-day events anchor at 09:00 for reminders
        'all_day'    => $allDay,
        'recurrence' => $rec,
        // all-day default: only the day-before reminder (no "hour before").
        'reminders'  => jarvis_clean_reminders($input['reminders'] ?? null, $allDay ? ['-1d'] : ['-1d', '-1h']),
        'notes'      => trim((string) ($input['notes'] ?? '')),
        'created_at' => (new DateTime('now', jarvis_tz()))->format('Y-m-d H:i'),
        'sent'       => new stdClass(),
    ];

    $appts = jarvis_appts_load();
    $appts[] = $appt;
    if (!jarvis_appts_save($appts)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'could not save (check server/data writable)']);
        exit;
    }
    echo json_encode(['ok' => true, 'appointment' => $appt], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'delete') {
    $appts = jarvis_appts_load();
    $before = count($appts);
    $deleted = [];

    $all   = !empty($input['all']);
    $date  = trim((string) ($input['date'] ?? ''));
    $id    = (string) ($input['id'] ?? '');
    $title = trim((string) ($input['title'] ?? ''));

    if ($all) {
        $deleted = array_map(fn ($a) => $a['title'] ?? '', $appts);
        $appts = [];
    } elseif ($date !== '') {
        // delete every appointment with an occurrence on that day
        $kept = [];
        foreach ($appts as $a) {
            if (jarvis_appt_on_date($a, $date)) $deleted[] = $a['title'] ?? '';
            else $kept[] = $a;
        }
        $appts = $kept;
    } elseif ($id !== '') {
        $kept = [];
        foreach ($appts as $a) {
            if (($a['id'] ?? '') === $id) $deleted[] = $a['title'] ?? '';
            else $kept[] = $a;
        }
        $appts = $kept;
    } elseif ($title !== '') {
        $q = jarvis_appt_norm($title);
        $kept = [];
        foreach ($appts as $a) {
            $t = jarvis_appt_norm((string) ($a['title'] ?? ''));
            $hit = $q !== '' && ($t === $q || strpos($t, $q) !== false || strpos($q, $t) !== false);
            if ($hit) $deleted[] = $a['title'] ?? '';
            else $kept[] = $a;
        }
        $appts = $kept;
    }

    jarvis_appts_save($appts);
    echo json_encode([
        'ok'      => count($appts) < $before,
        'deleted' => count($deleted),
        'titles'  => array_values(array_filter($deleted)),
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(400);
echo json_encode(['ok' => false, 'error' => 'unknown action']);
