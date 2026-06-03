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
require_once __DIR__ . '/lib/appointments_lib.php';

$cfgFile = __DIR__ . '/config.php';
$cfg = file_exists($cfgFile) ? require $cfgFile : [];

// Current date/time in the user's timezone, so the AI can resolve
// relative dates ("domani alle 15", "venerdì prossimo") for appointments.
try { $tz = new DateTimeZone($cfg['timezone'] ?? 'Europe/Rome'); }
catch (Exception $e) { $tz = new DateTimeZone('Europe/Rome'); }
$nowDt = new DateTime('now', $tz);
$giorni = ['Sunday' => 'domenica', 'Monday' => 'lunedì', 'Tuesday' => 'martedì', 'Wednesday' => 'mercoledì', 'Thursday' => 'giovedì', 'Friday' => 'venerdì', 'Saturday' => 'sabato'];
$nowHuman = ($giorni[$nowDt->format('l')] ?? '') . ' ' . $nowDt->format('d/m/Y H:i');
$nowIso = $nowDt->format('Y-m-d H:i');
$todayIso = $nowDt->format('Y-m-d');
$exTomorrow = (clone $nowDt)->modify('+1 day')->format('Y-m-d');

// Pre-computed calendar so the (small) model never has to do date math:
// it only has to pick the right date string and append the time.
$dateHints = [];
$dateHints[] = 'oggi (' . ($giorni[$nowDt->format('l')] ?? '') . ') = ' . $nowDt->format('Y-m-d');
$dateHints[] = 'domani = ' . (clone $nowDt)->modify('+1 day')->format('Y-m-d');
$dateHints[] = 'dopodomani = ' . (clone $nowDt)->modify('+2 days')->format('Y-m-d');
foreach (['monday' => 'lunedì', 'tuesday' => 'martedì', 'wednesday' => 'mercoledì', 'thursday' => 'giovedì', 'friday' => 'venerdì', 'saturday' => 'sabato', 'sunday' => 'domenica'] as $en => $it) {
    $dateHints[] = $it . ' prossimo = ' . (clone $nowDt)->modify('next ' . $en)->format('Y-m-d');
}
$dateBlock = "Calendario gia' calcolato (usa queste date esatte):\n- " . implode("\n- ", $dateHints);

$apiKey = $cfg['gemini_api_key'] ?? (getenv('GEMINI_API_KEY') ?: '');
$model  = $cfg['gemini_model'] ?? 'gemini-2.0-flash';

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$text  = trim($input['text'] ?? '');
$history = is_array($input['history'] ?? null) ? $input['history'] : [];

// Track currently playing (if any), so the AI understands "questa canzone",
// "mettine un'altra", "non mi piace questa", "salva questa nella playlist", ecc.
$np = is_array($input['nowPlaying'] ?? null) ? $input['nowPlaying'] : [];
$npArtist = trim((string) ($np['artist'] ?? ''));
$npTitle  = trim((string) ($np['title'] ?? ''));
$nowPlayingBlock = ($npTitle !== '' || $npArtist !== '')
    ? "Brano attualmente in riproduzione: \"$npTitle\" di \"$npArtist\". Quando l'utente dice "
      . "\"questa\", \"questo brano\", \"mettine un'altra\", \"non mi piace\", \"cambia\", "
      . "si riferisce a QUESTO brano (es. \"un'altra di questo artista\" = altro brano di \"$npArtist\")."
    : 'Nessun brano in riproduzione al momento.';

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

$nowPlayingBlock

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
       * "playlist_play"   : riproduci una playlist gia' esistente. Metti il nome in "playlistName".
       * "playlist_create" : crea/sostituisci una playlist. Metti il nome in "playlistName"
                             e i brani in "playlistTracks" (scegliendoli dalla libreria qui sopra,
                             copiando artista e titolo ESATTAMENTE come elencati).
       * "playlist_add"    : aggiungi brani a una playlist esistente. "playlistName" + "playlistTracks".
       * "playlist_remove" : togli brani da una playlist. "playlistName" + "playlistTracks"
                             (i brani da rimuovere).
       * "playlist_delete" : elimina una playlist. Metti solo "playlistName".
       * "playlist_list"   : l'utente chiede quali playlist esistono.
     NOTA "mettine un'altra"/"non mi piace questa": usa "next" (o "shuffle"), oppure "play"
     scegliendo un brano DIVERSO da quello in riproduzione; se chiede "un'altra di questo
     artista" usa "play" con "musicArtist" uguale all'artista corrente e "musicTitle" vuoto.
   - "appointment" : QUALSIASI richiesta su impegni/promemoria/appuntamenti (anche
     "ricordami ...": un promemoria E' un appuntamento). NOTA: un singolo messaggio puo'
     contenere PIU' operazioni (es. "cancella tutto oggi e fissa il medico"): verranno
     gestite tutte. Se l'utente NON dice l'ora, NON inventarla.
     Imposta "apptAction" (per il caso semplice a operazione singola):
       * "list"   : l'utente CHIEDE quali impegni ha ("che impegni ho?", "cosa ho in
                    programma", "i miei appuntamenti", "promemoria di domani"). In questo
                    caso lascia gli altri campi appt vuoti.
       * "delete" : chiede di CANCELLARE/eliminare/disdire un impegno. Metti in "apptTitle"
                    il titolo dell'impegno da cancellare (es. "dentista"); gli altri vuoti.
       * "add"    : (default) fissare un NUOVO impegno. Compila i campi sotto.
     ADESSO sono: $nowHuman (fuso Europe/Rome).
     $dateBlock
     Usa il calendario qui sopra per ottenere la data assoluta (per "tra N ore/giorni"
     calcola rispetto ad ADESSO).
     Quando apptAction="add" DEVI OBBLIGATORIAMENTE compilare questi campi (non vuoti):
       * "apptTitle"     : titolo breve (es. "Dentista", "Riunione con Luca").
       * "apptDatetime"  : data e ora ASSOLUTE nel formato ESATTO "YYYY-MM-DD HH:MM" (24h).
                           Se manca l'ora usa "09:00". NON lasciare MAI questo campo vuoto.
       * "apptRecurrence": "none" se una tantum; "daily"/"weekly"/"monthly"/"yearly" se si
                           ripete ("ogni giorno"->daily, "ogni lunedì"/"ogni settimana"->weekly,
                           "ogni mese"->monthly, "ogni anno"->yearly).
       * "apptReminders" : anticipi richiesti, come stringhe: "un giorno prima"->"-1d",
                           "un'ora prima"->"-1h", "mezz'ora prima"->"-30m", "una settimana
                           prima"->"-1w". Se l'utente NON specifica anticipi, lascia la lista
                           VUOTA (il sistema userà il default giorno-prima + ora-prima).
       * "apptNotes"     : dettagli extra, altrimenti "".
     ESEMPIO (se oggi fosse $nowHuman e l'utente dicesse "ricordami il dentista domani
     alle 15:30, avvisami mezz'ora prima"): apptTitle="Dentista",
     apptDatetime="$exTomorrow 15:30", apptRecurrence="none", apptReminders=["-30m"].
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
                    'enum' => [
                        'play', 'shuffle', 'next', 'prev', 'stop', 'pause', 'resume',
                        'playlist_play', 'playlist_create', 'playlist_add',
                        'playlist_remove', 'playlist_delete', 'playlist_list',
                    ],
                ],
                'playlistName' => [
                    'type' => 'string',
                    'description' => 'Nome della playlist per le azioni playlist_*, altrimenti "".',
                ],
                'playlistTracks' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'artist' => ['type' => 'string'],
                            'title'  => ['type' => 'string'],
                        ],
                    ],
                    'description' => 'Brani (artista+titolo, copiati ESATTAMENTE dalla libreria) per '
                        . 'playlist_create/add/remove. Vuoto per le altre azioni.',
                ],
                'apptAction' => [
                    'type' => 'string',
                    'enum' => ['add', 'list', 'delete'],
                    'description' => 'Azione sull\'agenda: add (nuovo), list (elenca), delete (cancella).',
                ],
                'apptTitle' => [
                    'type' => 'string',
                    'description' => "Titolo dell'impegno (da creare con add, o da cancellare con delete), altrimenti \"\".",
                ],
                'apptDatetime' => [
                    'type' => 'string',
                    'description' => "OBBLIGATORIO quando intent=appointment: data e ora assolute nel formato esatto \"YYYY-MM-DD HH:MM\" (24h), risolvendo le date relative col calendario fornito. Es. \"$exTomorrow 15:30\". Per altri intent: \"\".",
                ],
                'apptRecurrence' => [
                    'type' => 'string',
                    'enum' => ['none', 'daily', 'weekly', 'monthly', 'yearly'],
                    'description' => 'Ricorrenza dell\'impegno: none se una tantum.',
                ],
                'apptReminders' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                    'description' => 'Anticipi di notifica richiesti dall\'utente, es. ["-1d","-30m"]. Vuoto se non specificati.',
                ],
                'apptNotes' => ['type' => 'string'],
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

// ---- appointment operations ----
// A single message may contain several operations (e.g. "cancella tutto oggi e
// fissa il medico"). For the appointment intent we always escalate to a stronger
// model that returns a list of operations with absolute dates resolved.
$appointmentOps = [];
if (($parsed['intent'] ?? '') === 'appointment') {
    $apptModel = $cfg['gemini_appt_model'] ?? 'gemini-2.5-flash';
    $appointmentOps = jarvis_extract_appointment_ops($text, $apptModel, $apiKey, $nowHuman, $dateBlock, $exTomorrow, $todayIso);

    // Fallback: if extraction yields nothing, synthesize one op from the
    // primary (flash-lite) classification so simple requests still work.
    if (!$appointmentOps) {
        $fbAction = (string) ($parsed['apptAction'] ?? 'add');
        if (!in_array($fbAction, ['add', 'list', 'delete'], true)) $fbAction = 'add';
        $appointmentOps[] = [
            'action'      => $fbAction,
            'title'       => (string) ($parsed['apptTitle'] ?? ''),
            'datetime'    => (string) ($parsed['apptDatetime'] ?? ''),
            'allDay'      => false,
            'recurrence'  => (string) ($parsed['apptRecurrence'] ?? 'none'),
            'reminders'   => is_array($parsed['apptReminders'] ?? null) ? array_values($parsed['apptReminders']) : [],
            'notes'       => (string) ($parsed['apptNotes'] ?? ''),
            'deleteScope' => $fbAction === 'delete' ? 'title' : '',
            'deleteDate'  => '',
        ];
    }
}

echo json_encode([
    'intent' => $parsed['intent'],
    'reply'  => (string) ($parsed['reply'] ?? ''),
    'accessCode' => (string) ($parsed['accessCode'] ?? ''),
    'musicArtist' => (string) ($parsed['musicArtist'] ?? ''),
    'musicTitle' => (string) ($parsed['musicTitle'] ?? ''),
    'musicAction' => (string) ($parsed['musicAction'] ?? ''),
    'playlistName' => (string) ($parsed['playlistName'] ?? ''),
    'playlistTracks' => is_array($parsed['playlistTracks'] ?? null) ? array_values($parsed['playlistTracks']) : [],
    'appointmentOps' => $appointmentOps,
    'remembered' => $remembered,
], JSON_UNESCAPED_UNICODE);

/**
 * Extract a LIST of appointment operations from one message, with a capable
 * model (flash-lite can't resolve dates reliably). Returns an array of ops or [].
 */
function jarvis_extract_appointment_ops(string $text, string $model, string $apiKey, string $nowHuman, string $dateBlock, string $exTomorrow, string $todayIso): array {
    $sys = <<<ASYS
Estrai TUTTE le operazioni su impegni/promemoria dal messaggio dell'utente, in italiano.
Un messaggio puo' contenere PIU' operazioni (es. "cancella tutto oggi e fissa il medico"
-> due operazioni). ADESSO sono: $nowHuman (fuso Europe/Rome).
$dateBlock

Restituisci SOLO un oggetto JSON: { "operations": [ ... ] }.
Ogni operazione ha:
- "action": "add" (nuovo impegno/promemoria) | "delete" (cancella) | "list" (elenca).
- Per "add":
  * "title": titolo breve (es. "Medico", "Dentista").
  * "datetime": data e ora ASSOLUTE "YYYY-MM-DD HH:MM" (24h). Se l'utente NON dice l'ora,
    restituisci SOLO la data "YYYY-MM-DD" (NON inventare l'ora). Se non dice nemmeno il
    giorno, usa oggi ($todayIso). Risolvi "domani", "venerdì prossimo", ecc. col calendario.
  * "recurrence": "none"|"daily"|"weekly"|"monthly"|"yearly".
  * "reminders": anticipi ("un giorno prima"->"-1d","un'ora prima"->"-1h","mezz'ora prima"
    ->"-30m","una settimana prima"->"-1w"); vuota se non specificati.
  * "notes": dettagli extra o "".
- Per "delete":
  * "deleteScope": "all" se "cancella tutto"/"cancella tutti gli impegni" senza data;
    "date" se "cancella tutto oggi/domani/<giorno>" (TUTTI gli impegni di quel giorno);
    "title" se indica un impegno specifico (es. "cancella il dentista").
  * "deleteDate": "YYYY-MM-DD" quando deleteScope="date".
  * "title": il titolo da cancellare quando deleteScope="title".
- Per "list": nessun altro campo.

Esempi:
"cancella tutto oggi, sono malato, e fissa un appuntamento col medico" ->
{"operations":[{"action":"delete","deleteScope":"date","deleteDate":"$todayIso"},
{"action":"add","title":"Medico","datetime":"$todayIso","recurrence":"none","reminders":[],"notes":"malato"}]}
"ricordami il dentista domani alle 15:30, avvisami mezz'ora prima" ->
{"operations":[{"action":"add","title":"Dentista","datetime":"$exTomorrow 15:30","recurrence":"none","reminders":["-30m"],"notes":""}]}
ASYS;

    $payload = json_encode([
        'system_instruction' => ['parts' => [['text' => $sys]]],
        'contents' => [['role' => 'user', 'parts' => [['text' => $text]]]],
        'generationConfig' => [
            'temperature' => 0.2,
            'responseMimeType' => 'application/json',
            'responseSchema' => [
                'type' => 'object',
                'properties' => [
                    'operations' => [
                        'type' => 'array',
                        'items' => [
                            'type' => 'object',
                            'properties' => [
                                'action'      => ['type' => 'string', 'enum' => ['add', 'delete', 'list']],
                                'title'       => ['type' => 'string'],
                                'datetime'    => ['type' => 'string'],
                                'recurrence'  => ['type' => 'string', 'enum' => ['none', 'daily', 'weekly', 'monthly', 'yearly']],
                                'reminders'   => ['type' => 'array', 'items' => ['type' => 'string']],
                                'notes'       => ['type' => 'string'],
                                'deleteScope' => ['type' => 'string', 'enum' => ['all', 'date', 'title', '']],
                                'deleteDate'  => ['type' => 'string'],
                            ],
                            'required' => ['action'],
                        ],
                    ],
                ],
                'required' => ['operations'],
            ],
        ],
    ], JSON_UNESCAPED_UNICODE);

    $url = 'https://generativelanguage.googleapis.com/v1beta/models/'
         . rawurlencode($model) . ':generateContent?key=' . rawurlencode($apiKey);
    [$code, $res] = gemini_call($url, $payload);
    if ($code !== 200 || !is_string($res)) return [];
    $data = json_decode($res, true);
    $json = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';
    $parsed = json_decode($json, true);
    $ops = is_array($parsed['operations'] ?? null) ? $parsed['operations'] : [];

    $out = [];
    foreach ($ops as $op) {
        if (!is_array($op)) continue;
        $action = (string) ($op['action'] ?? 'add');
        if (!in_array($action, ['add', 'delete', 'list'], true)) $action = 'add';
        $dt = trim((string) ($op['datetime'] ?? ''));
        $out[] = [
            'action'      => $action,
            'title'       => (string) ($op['title'] ?? ''),
            'datetime'    => $dt,
            'allDay'      => $dt !== '' && jarvis_is_date_only($dt),
            'recurrence'  => (string) ($op['recurrence'] ?? 'none'),
            'reminders'   => is_array($op['reminders'] ?? null) ? array_values($op['reminders']) : [],
            'notes'       => (string) ($op['notes'] ?? ''),
            'deleteScope' => (string) ($op['deleteScope'] ?? ''),
            'deleteDate'  => (string) ($op['deleteDate'] ?? ''),
        ];
    }
    return $out;
}
