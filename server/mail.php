<?php
/**
 * JARVIS - mailbox API (read-only) over IMAP.
 *
 * POST JSON:
 *   { action: "unread" }                 -> { ok, count, items:[{fromName,subject,when,...}] }
 *   { action: "list" }                   -> { ok, items:[...] }
 *   { action: "read",    unseen?:bool }  -> { ok, mail:{fromName,subject,when,body} }
 *   { action: "summary", unseen?:bool }  -> { ok, mail:{fromName,subject,when,summary} }
 *
 * Reading uses FT_PEEK, so it never marks messages as read.
 * Credentials live in server/config.php -> 'mail' (never exposed to the web).
 */

require __DIR__ . '/lib/mail_lib.php';

header('Content-Type: application/json; charset=utf-8');

$cfgFile = __DIR__ . '/config.php';
$cfg = file_exists($cfgFile) ? require $cfgFile : [];
$mailCfg = is_array($cfg['mail'] ?? null) ? $cfg['mail'] : [];
$apiKey = $cfg['gemini_api_key'] ?? (getenv('GEMINI_API_KEY') ?: '');
$model  = $cfg['gemini_model'] ?? 'gemini-2.5-flash-lite';

$input  = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $input['action'] ?? 'unread';
$max    = max(1, (int) ($mailCfg['max'] ?? 6));

[$conn, $err] = jarvis_mail_open($mailCfg);
if (!$conn) {
    echo json_encode(['ok' => false, 'error' => $err]);
    exit;
}

try {
    if ($action === 'unread') {
        $count = jarvis_mail_unread_count($conn);
        $items = jarvis_mail_recent($conn, min($max, 5), true);
        echo json_encode(['ok' => true, 'count' => $count, 'items' => jarvis_mail_pub($items)], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'list') {
        $items = jarvis_mail_recent($conn, $max, false);
        echo json_encode(['ok' => true, 'items' => jarvis_mail_pub($items)], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'read' || $action === 'summary') {
        $unseen = !empty($input['unseen']);
        $list = jarvis_mail_recent($conn, 1, $unseen);
        if (!$list && $unseen) $list = jarvis_mail_recent($conn, 1, false); // none unread -> newest
        if (!$list) { echo json_encode(['ok' => false, 'error' => 'mailbox empty']); exit; }

        $m = $list[0];
        $body = jarvis_mail_body($conn, (int) $m['msgno']);
        $mail = [
            'fromName' => $m['fromName'],
            'from'     => $m['from'],
            'subject'  => $m['subject'],
            'date'     => $m['date'],
            'when'     => jarvis_mail_when($m['date']),
        ];
        if ($action === 'summary') {
            $sum = jarvis_mail_summarize($m['subject'], $body, $apiKey, $model);
            $mail['summary'] = $sum;
            if ($sum === '') $mail['body'] = mb_substr($body, 0, 700, 'UTF-8'); // fallback
        } else {
            $mail['body'] = $body;
        }
        echo json_encode(['ok' => true, 'mail' => $mail], JSON_UNESCAPED_UNICODE);
        exit;
    }

    echo json_encode(['ok' => false, 'error' => 'unknown action']);
} finally {
    jarvis_mail_close($conn);
}

/** Strip internal fields (msgno/uid) from a list before sending to the client. */
function jarvis_mail_pub(array $items): array {
    return array_map(fn ($i) => [
        'fromName' => $i['fromName'],
        'from'     => $i['from'],
        'subject'  => $i['subject'],
        'when'     => jarvis_mail_when($i['date']),
        'seen'     => $i['seen'],
    ], $items);
}
