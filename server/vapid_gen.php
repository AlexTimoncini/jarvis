<?php
/**
 * JARVIS - one-time VAPID key generator.
 *
 * After `composer install`, open this file in the browser ONCE. Copy the
 * public/private keys into server/config.php (vapid_public / vapid_private),
 * then DELETE this file (or it will keep generating new keys).
 */
header('Content-Type: text/plain; charset=utf-8');

$autoload = __DIR__ . '/vendor/autoload.php';
if (!is_file($autoload)) {
    http_response_code(500);
    echo "vendor/autoload.php non trovato.\nEsegui prima:  cd server && composer install\n";
    exit;
}
require $autoload;

$keys = \Minishlink\WebPush\VAPID::createVapidKeys();

echo "Chiavi VAPID generate. Incollale in server/config.php:\n\n";
echo "    'vapid_public'  => '" . $keys['publicKey'] . "',\n";
echo "    'vapid_private' => '" . $keys['privateKey'] . "',\n\n";
echo "Poi ELIMINA questo file (server/vapid_gen.php).\n";
