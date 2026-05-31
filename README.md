# J.A.R.V.I.S. PWA

Assistente AI a tema JARVIS / Iron Man. Questa repo contiene la **Fase 1**: il
client (vanilla JS + Three.js) con la sfera animata e la dashboard HUD per
**mobile portrait**. La voce e l'AI lato server PHP arriveranno nelle fasi
successive.

## Stack
- **Frontend**: HTML + CSS + vanilla JS (ES modules), nessun build step.
- **3D**: Three.js (vendorizzato in `assets/vendor/`, caricato via `importmap`).
- **Backend**: PHP (placeholder in `server/`, Fase 2).

## Avvio
Serve i file con un qualsiasi server statico dalla root del progetto:

```bash
# Python
python3 -m http.server 8080
# oppure PHP (serve anche l'endpoint placeholder)
php -S localhost:8080
```

Apri `http://localhost:8080` da mobile (o DevTools in modalità device, portrait).

## Interazione
- **Tap** sulla sfera: attiva / disattiva JARVIS (`wake`).
- **Tieni premuto**: `listening` mentre tieni, poi al rilascio parte la pipeline
  simulata `thinking -> speaking -> idle`.
- **DBG** (in alto): pannello debug per forzare stati, lanciare animazioni
  (motifs), pilotare la simulazione audio e iniettare comandi AI casuali.

## Voce (TTS ElevenLabs)
Per la voce neurale femminile:
1. Copia `server/config.sample.php` in `server/config.php`.
2. Inserisci la tua `api_key` ElevenLabs e (opzionale) il `voice_id` di una voce IT femminile.
3. Avvia con `php -S localhost:8080` (necessario per eseguire il proxy `server/tts.php`).

Il client (`js/audio/NeuralTTS.js`) chiama il proxy, riproduce l'MP3 tramite un
`AnalyserNode` (la sfera reagisce all'ampiezza reale) e, se l'API non risponde o
manca la chiave, fa **fallback automatico** alla voce del browser
(`SpeechSynthesis`). Le frasi fisse vengono messe in cache su disco
(`server/cache/`) per non ribillare ElevenLabs.

## Architettura animazioni
La macchina a stati (`js/core/StateMachine.js`) emette gli stati; l'
`AnimationDirector` (`js/core/AnimationDirector.js`) li interpreta, sceglie in
autonomia dei *motifs* (`js/core/motifs.js`) e scrive i parametri visivi in
`VisualState`, letto ogni frame da `SphereRenderer` (3D) e `HudRenderer` (2D).

In futuro il server potrà inviare lo stesso schema di comando a
`director.applyCommand({ state, intensity, accent, motifs, seed })`.

## Struttura
```
index.html
css/        variabili palette, layout portrait, HUD, animazioni
js/core/    EventBus, StateMachine, AnimationDirector, motifs, VisualState, util
js/render/  SphereRenderer (Three.js), HudRenderer (Canvas2D)
js/ui/      Clock, Weather, SystemStats, Links, Waveform, DebugPanel
js/input/   Interaction (tap / press-and-hold)
js/audio/   SpeakingSimulator (livello audio finto)
assets/     vendor (three.module.js), textures
server/     placeholder PHP (Fase 2)
```
