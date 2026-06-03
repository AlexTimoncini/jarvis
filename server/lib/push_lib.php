<?php
/**
 * JARVIS - Web Push helpers (subscriptions store + sending).
 *
 * Subscriptions live in server/data/subscriptions.json, keyed by endpoint.
 * Sending uses minishlink/web-push (install with `composer install`).
 */
require_once __DIR__ . '/appointments_lib.php';

function jarvis_cfg(): array {
    static $cfg = null;
    if ($cfg === null) {
        $f = __DIR__ . '/../config.php';
        $cfg = is_file($f) ? (require $f) : [];
        if (!is_array($cfg)) $cfg = [];
    }
    return $cfg;
}

function jarvis_subs_file(): string {
    return jarvis_data_dir() . '/subscriptions.json';
}

function jarvis_subs_load(): array {
    $f = jarvis_subs_file();
    if (!is_file($f)) return [];
    $data = json_decode((string) file_get_contents($f), true);
    return is_array($data) ? $data : [];
}

function jarvis_subs_save(array $subs): bool {
    return @file_put_contents(
        jarvis_subs_file(),
        json_encode(array_values($subs), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT),
        LOCK_EX
    ) !== false;
}

/** Add or replace a subscription (deduped by endpoint). */
function jarvis_subs_add(array $sub): bool {
    $endpoint = $sub['endpoint'] ?? '';
    if (!$endpoint) return false;
    $subs = jarvis_subs_load();
    $subs = array_filter($subs, fn ($s) => ($s['endpoint'] ?? '') !== $endpoint);
    $subs[] = $sub;
    return jarvis_subs_save($subs);
}

function jarvis_subs_remove(string $endpoint): void {
    $subs = jarvis_subs_load();
    $subs = array_values(array_filter($subs, fn ($s) => ($s['endpoint'] ?? '') !== $endpoint));
    jarvis_subs_save($subs);
}

/**
 * Send a push payload to every stored subscription. Returns the number of
 * successful deliveries. Stale subscriptions (404/410) are pruned.
 * @param array $payload  e.g. ['title'=>..., 'body'=>..., 'tag'=>...]
 */
function jarvis_push_send_all(array $payload): int {
    $autoload = __DIR__ . '/../vendor/autoload.php';
    if (!is_file($autoload)) {
        error_log('[jarvis push] vendor/autoload.php missing - run composer install');
        return 0;
    }
    require_once $autoload;

    $cfg = jarvis_cfg();
    $pub = $cfg['vapid_public'] ?? '';
    $priv = $cfg['vapid_private'] ?? '';
    $subject = $cfg['vapid_subject'] ?? 'mailto:admin@example.com';
    if ($pub === '' || $priv === '') {
        error_log('[jarvis push] VAPID keys not configured');
        return 0;
    }

    $auth = ['VAPID' => ['subject' => $subject, 'publicKey' => $pub, 'privateKey' => $priv]];
    $webPush = new \Minishlink\WebPush\WebPush($auth);

    $subs = jarvis_subs_load();
    if (!$subs) return 0;

    $body = json_encode($payload, JSON_UNESCAPED_UNICODE);
    $queued = [];
    foreach ($subs as $s) {
        try {
            $subscription = \Minishlink\WebPush\Subscription::create([
                'endpoint' => $s['endpoint'] ?? '',
                'publicKey' => $s['keys']['p256dh'] ?? ($s['publicKey'] ?? ''),
                'authToken' => $s['keys']['auth'] ?? ($s['authToken'] ?? ''),
            ]);
            $webPush->queueNotification($subscription, $body);
            $queued[$s['endpoint'] ?? ''] = true;
        } catch (Throwable $e) {
            error_log('[jarvis push] bad subscription: ' . $e->getMessage());
        }
    }

    $ok = 0;
    foreach ($webPush->flush() as $report) {
        $endpoint = method_exists($report, 'getEndpoint') ? $report->getEndpoint() : '';
        if ($report->isSuccess()) {
            $ok++;
        } else if (method_exists($report, 'isSubscriptionExpired') && $report->isSubscriptionExpired()) {
            if ($endpoint) jarvis_subs_remove($endpoint);
        }
    }
    return $ok;
}
