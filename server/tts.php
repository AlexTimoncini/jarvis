<?php
/**
 * JARVIS - ElevenLabs TTS proxy.
 *
 * Keeps the API key server-side. Receives JSON { text, voiceId? },
 * returns audio/mpeg. Identical requests are cached on disk to
 * avoid re-billing the fixed phrases (greetings, etc.).
 *
 * Setup: copy server/config.sample.php to server/config.php and
 * set your ElevenLabs api_key (and optionally voice_id).
 */

$cfgFile = __DIR__ . '/config.php';
$cfg = file_exists($cfgFile) ? require $cfgFile : [];

$apiKey = $cfg['api_key'] ?? (getenv('ELEVENLABS_API_KEY') ?: '');
$model  = $cfg['model_id'] ?? 'eleven_multilingual_v2';

$input   = json_decode(file_get_contents('php://input'), true) ?: [];
$text    = trim($input['text'] ?? '');
$voiceId = $input['voiceId'] ?? ($cfg['voice_id'] ?? 'EXAVITQu4vr4xnSDxMaL'); // default: Bella (female)
// Only fixed phrases ask to be cached; dynamic conversation replies do not,
// to avoid filling the disk with one-off audio.
$doCache = !empty($input['cache']);

if ($text === '') {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'empty text']);
    exit;
}
if ($apiKey === '') {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'missing ELEVENLABS api key (see server/config.sample.php)']);
    exit;
}

// ---- disk cache (always READ; only WRITE for fixed phrases) ----
$cacheDir = __DIR__ . '/cache';
$cacheFile = $cacheDir . '/' . md5($voiceId . '|' . $model . '|' . $text) . '.mp3';
if (is_file($cacheFile)) {
    header('Content-Type: audio/mpeg');
    header('X-Cache: HIT');
    readfile($cacheFile);
    exit;
}

// ---- call ElevenLabs ----
$payload = json_encode([
    'text'     => $text,
    'model_id' => $model,
    'voice_settings' => [
        'stability'        => 0.5,
        'similarity_boost' => 0.75,
        'style'            => 0.35,
        'use_speaker_boost'=> true,
    ],
]);

$ch = curl_init('https://api.elevenlabs.io/v1/text-to-speech/' . rawurlencode($voiceId));
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_HTTPHEADER     => [
        'xi-api-key: ' . $apiKey,
        'Content-Type: application/json',
        'Accept: audio/mpeg',
    ],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
]);
$audio = curl_exec($ch);
$code  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($code !== 200 || $audio === false) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'tts upstream failed', 'code' => $code, 'body' => substr((string) $audio, 0, 300)]);
    exit;
}

if ($doCache) {
    if (!is_dir($cacheDir)) @mkdir($cacheDir, 0775, true);
    @file_put_contents($cacheFile, $audio);
}
header('Content-Type: audio/mpeg');
header('X-Cache: ' . ($doCache ? 'MISS' : 'BYPASS'));
echo $audio;
