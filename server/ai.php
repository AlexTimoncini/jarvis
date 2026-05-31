<?php
/**
 * JARVIS - AI brain proxy (Google Gemini).
 *
 * Receives JSON: { text: string, history?: [{role, text}, ...] }
 * Returns  JSON: { intent: string, reply: string }
 *
 * Intent is one of:
 *   conversation | standby | music | appointment | note
 *
 * Only "conversation" produces a spoken reply here; for the other
 * (not-yet-implemented) actions the client speaks a fixed phrase.
 *
 * Setup: put your free Google AI Studio key in server/config.php
 * (gemini_api_key). Get one at https://aistudio.google.com/apikey
 */

header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/music_lib.php';

$cfgFile = __DIR__ . '/config.php';
$cfg = file_exists($cfgFile) ? require $cfgFile : [];

$apiKey = $cfg['gemini_api_key'] ?? (getenv('GEMINI_API_KEY') ?: '');
$model  = $cfg['gemini_model'] ?? 'gemini-2.0-flash';

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$text  = trim($input['text'] ?? '');
$history = is_array($input['history'] ?? null) ? $input['history'] : [];

if ($text === '') {
    http_response_code(400);
    echo json_encode(['error' => 'empty text']);
    exit;
}
if ($apiKey === '') {
    http_response_code(500);
    echo json_encode(['error' => 'missing gemini api key (see server/config.sample.php)']);
    exit;
}

// ---- load persistent user profile (personal info + learned facts) ----
$profileFile = __DIR__ . '/profile.json';
$profile = ['name' => 'Signore', 'info' => [], 'facts' => []];
if (is_file($profileFile)) {
    $loaded = json_decode(file_get_contents($profileFile), true);
    if (is_array($loaded)) $profile = array_merge($profile, $loaded);
}
if (!is_array($profile['info'] ?? null)) $profile['info'] = [];
if (!is_array($profile['facts'] ?? null)) $profile['facts'] = [];

// Build a human-readable memory block for the prompt
$infoLines = [];
foreach ($profile['info'] as $k => $v) {
    if ($v !== '' && $v !== null) $infoLines[] = "- $k: $v";
}
$factLines = array_map(fn ($f) => "- $f", $profile['facts']);
$memoryBlock = "Informazioni note sull'utente (usale per essere coerente):\n"
    . (count($infoLines) ? implode("\n", $infoLines) : '- (nessuna)')
    . "\n\nFatti appresi nelle conversazioni passate:\n"
    . (count($factLines) ? implode("\n", $factLines) : '- (nessuno)');

// ---- music catalog (so the AI can pick a real track to play) ----
$catalog = jarvis_music_catalog();
$musicLines = [];
foreach ($catalog['artists'] as $artist => $titles) {
    $musicLines[] = "- $artist: " . implode(', ', $titles);
}
// cap to keep the prompt small
if (count($musicLines) > 60) {
    $musicLines = array_slice($musicLines, 0, 60);
    $musicLines[] = '- (altri brani disponibili...)';
}
$musicBlock = count($musicLines)
    ? "Brani musicali disponibili in libreria (artista: titoli):\n" . implode("\n", $musicLines)
    : 'Libreria musicale vuota (nessun brano disponibile).';

$userName = $profile['name'] ?: 'Signore';
$system = <<<SYS
Sei J.A.R.V.I.S., l'assistente AI personale di Iron Man, in italiano.
Personalità: cortese, elegante, asciutto, leggermente ironico. Ti rivolgi
all'utente chiamandolo "Signore" (il suo nome è $userName).

$memoryBlock

$musicBlock

Compito: per OGNI messaggio dell'utente devi:
1) Classificare l'INTENZIONE in UNA di queste etichette:
   - "standby"     : chiede di disattivarti, spegnerti, tornare in standby, "basta", "a dopo".
   - "music"       : qualsiasi richiesta sulla riproduzione musicale. Imposta sempre
     "musicAction" con UNA di queste:
       * "play"    : riprodurre un brano/artista specifico o "metti musica" in generale.
                     Scegli UN brano dalla libreria e mettilo in "musicArtist"/"musicTitle"
                     (copiandoli ESATTAMENTE come elencati). Se non c'e' nulla di pertinente
                     lascia "musicArtist"/"musicTitle" vuoti.
       * "shuffle" : riproduzione casuale / "metti in shuffle" / "musica a caso".
       * "next"    : salta / prossima canzone / "cambia".
       * "prev"    : canzone precedente / "torna indietro".
       * "stop"    : ferma / spegni la musica.
       * "pause"   : metti in pausa.
       * "resume"  : riprendi / continua.
   - "appointment" : chiede di fissare un appuntamento, promemoria, evento in calendario.
   - "note"        : chiede di scrivere/salvare/scaricare una nota o un testo.
   - "update_access_code": chiede di cambiare/aggiornare/modificare il codice di
     accesso/attivazione. In questo caso estrai il NUOVO codice pronunciato e mettilo
     nel campo "accessCode" (solo la frase del codice, senza parole di contorno).
   - "conversation": qualsiasi altra cosa (domande, chiacchiere, informazioni, saluti).
2) Generare "reply":
   - Se intent = "conversation": una risposta naturale, breve (max 2 frasi), in italiano,
     nel tuo stile, sfruttando ciò che sai sull'utente quando pertinente.
   - Se intent è uno degli altri: lascia "reply" come stringa vuota "".
3) Memoria: se l'utente condivide informazioni personali DURATURE e utili da
   ricordare in futuro (nome, città, lavoro, gusti, preferenze, persone, progetti),
   inseriscile come brevi frasi in "remember". NON ripetere fatti già noti elencati
   sopra. Se non c'è nulla di nuovo da ricordare, lascia "remember" come lista vuota.

Rispondi SOLO con l'oggetto JSON richiesto, senza testo aggiuntivo.
SYS;

// Build conversation contents (recent history + current message)
$contents = [];
foreach ($history as $h) {
    $role = ($h['role'] ?? 'user') === 'model' ? 'model' : 'user';
    $contents[] = ['role' => $role, 'parts' => [['text' => (string) ($h['text'] ?? '')]]];
}
$contents[] = ['role' => 'user', 'parts' => [['text' => $text]]];

$payload = json_encode([
    'system_instruction' => ['parts' => [['text' => $system]]],
    'contents' => $contents,
    'generationConfig' => [
        'temperature' => 0.8,
        'responseMimeType' => 'application/json',
        'responseSchema' => [
            'type' => 'object',
            'properties' => [
                'intent' => [
                    'type' => 'string',
                    'enum' => ['conversation', 'standby', 'music', 'appointment', 'note', 'update_access_code'],
                ],
                'reply' => ['type' => 'string'],
                'accessCode' => ['type' => 'string'],
                'musicArtist' => ['type' => 'string'],
                'musicTitle' => ['type' => 'string'],
                'musicAction' => [
                    'type' => 'string',
                    'enum' => ['play', 'shuffle', 'next', 'prev', 'stop', 'pause', 'resume'],
                ],
                'remember' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
            ],
            'required' => ['intent', 'reply'],
        ],
    ],
], JSON_UNESCAPED_UNICODE);

$url = 'https://generativelanguage.googleapis.com/v1beta/models/'
     . rawurlencode($model) . ':generateContent?key=' . rawurlencode($apiKey);

/**
 * Fire one request to Gemini. Returns [httpCode, responseBody].
 */
function gemini_call(string $url, string $payload): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
    ]);
    $res  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, $res];
}

/** Extract the suggested retry delay (seconds) from a 429 body, if any. */
function gemini_retry_delay(?string $body): float {
    if (!$body) return 0.0;
    if (preg_match('/"retryDelay"\s*:\s*"?(\d+(?:\.\d+)?)s/', $body, $m)) {
        return (float) $m[1];
    }
    return 0.0;
}

// On a 429 (per-minute rate limit on the free tier) retry a couple of
// times, honouring the server-suggested delay but capped so JARVIS never
// hangs for long.
$maxAttempts = 3;
$capSeconds  = 5.0;
[$code, $res] = gemini_call($url, $payload);
for ($attempt = 1; $attempt < $maxAttempts && $code === 429; $attempt++) {
    $delay = gemini_retry_delay(is_string($res) ? $res : null);
    if ($delay <= 0) $delay = 1.5 * $attempt;        // gentle backoff fallback
    usleep((int) (min($delay, $capSeconds) * 1_000_000));
    [$code, $res] = gemini_call($url, $payload);
}

if ($code !== 200 || $res === false) {
    http_response_code(502);
    echo json_encode([
        'error' => 'ai upstream failed',
        'code'  => $code,
        'body'  => substr((string) $res, 0, 500),
    ]);
    exit;
}

$data = json_decode($res, true);
$jsonText = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';
$parsed = json_decode($jsonText, true);

if (!is_array($parsed) || !isset($parsed['intent'])) {
    // Defensive fallback: treat as conversation with raw text if present
    echo json_encode([
        'intent' => 'conversation',
        'reply'  => is_string($jsonText) && $jsonText !== '' ? $jsonText : 'Mi perdoni Signore, non ho compreso.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ---- persist newly learned facts (deduped, capped) ----
$remembered = [];
$newFacts = is_array($parsed['remember'] ?? null) ? $parsed['remember'] : [];
if ($newFacts) {
    $existingLower = array_map('mb_strtolower', $profile['facts']);
    foreach ($newFacts as $fact) {
        $fact = trim((string) $fact);
        if ($fact === '') continue;
        if (in_array(mb_strtolower($fact), $existingLower, true)) continue;
        $profile['facts'][] = $fact;
        $existingLower[] = mb_strtolower($fact);
        $remembered[] = $fact;
    }
    // keep the most recent 50 facts
    if (count($profile['facts']) > 50) {
        $profile['facts'] = array_slice($profile['facts'], -50);
    }
    if ($remembered) {
        @file_put_contents(
            $profileFile,
            json_encode($profile, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)
        );
    }
}

echo json_encode([
    'intent' => $parsed['intent'],
    'reply'  => (string) ($parsed['reply'] ?? ''),
    'accessCode' => (string) ($parsed['accessCode'] ?? ''),
    'musicArtist' => (string) ($parsed['musicArtist'] ?? ''),
    'musicTitle' => (string) ($parsed['musicTitle'] ?? ''),
    'musicAction' => (string) ($parsed['musicAction'] ?? ''),
    'remembered' => $remembered,
], JSON_UNESCAPED_UNICODE);
