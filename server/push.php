<?php
/**
 * JARVIS - Web Push subscription endpoint.
 *
 *   GET  ?action=vapid              -> { ok, key }      (VAPID public key)
 *   POST { action:"subscribe", subscription:{...} }  -> { ok }
 *   POST { action:"unsubscribe", endpoint }           -> { ok }
 */
header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/lib/push_lib.php';

$cfg = jarvis_cfg();

$action = $_GET['action'] ?? null;
if ($action === 'vapid') {
    echo json_encode(['ok' => true, 'key' => (string) ($cfg['vapid_public'] ?? '')]);
    exit;
}

$input  = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $input['action'] ?? '';

if ($action === 'subscribe') {
    $sub = $input['subscription'] ?? null;
    if (!is_array($sub) || empty($sub['endpoint'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'invalid subscription']);
        exit;
    }
    echo json_encode(['ok' => jarvis_subs_add($sub)]);
    exit;
}

if ($action === 'unsubscribe') {
    $endpoint = (string) ($input['endpoint'] ?? '');
    if ($endpoint) jarvis_subs_remove($endpoint);
    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(400);
echo json_encode(['ok' => false, 'error' => 'unknown action']);
