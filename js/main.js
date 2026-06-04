/* ============================================================
   JARVIS PWA - bootstrap & main loop
   ============================================================ */
import { bus } from './core/EventBus.js';
import { StateMachine, STATES } from './core/StateMachine.js';
import { AnimationDirector } from './core/AnimationDirector.js';
import { visual } from './core/VisualState.js';
import { SphereRenderer } from './render/SphereRenderer.js';
import { HudRenderer } from './render/HudRenderer.js';
import { BackgroundTelemetry } from './render/BackgroundTelemetry.js';
import { Assistant, FIXED_PHRASES } from './core/Assistant.js';
import { AI } from './core/AI.js';
import { Auth } from './core/Auth.js';
import { Geo } from './core/Geo.js';
import { Appointments } from './core/Appointments.js';
import { Push } from './core/Push.js';
import { Playlists } from './core/Playlists.js';
import { Notes } from './core/Notes.js';
import { Mail } from './core/Mail.js';
import { WidgetManager } from './ui/WidgetManager.js';
import { Clock } from './ui/Clock.js';
import { Weather } from './ui/Weather.js';
import { SystemStats } from './ui/SystemStats.js';
import { Links } from './ui/Links.js';
import { Waveform } from './ui/Waveform.js';
import { MusicWidget } from './ui/MusicWidget.js';
import { AppointmentsWidget } from './ui/AppointmentsWidget.js';
import { Interaction } from './input/Interaction.js';
import { VoiceRecognition } from './input/VoiceRecognition.js';
import { SpeakingSimulator } from './audio/SpeakingSimulator.js';
import { AudioFx } from './audio/AudioFx.js';
import { Speech } from './audio/Speech.js';
import { NeuralTTS } from './audio/NeuralTTS.js';
import { MusicPlayer } from './audio/MusicPlayer.js';
import { MusicLibrary } from './core/MusicLibrary.js';

const $ = (sel) => document.querySelector(sel);

/* ---------- Core systems ---------- */
const sm = new StateMachine('boot');
const director = new AnimationDirector();
const simulator = new SpeakingSimulator();

/* ---------- Renderers ---------- */
const sphere = new SphereRenderer($('#sphere-canvas'));
const hud = new HudRenderer($('#hud-canvas'));
const telemetry = new BackgroundTelemetry($('#telemetry-canvas'));

/* ---------- Location (needed by the weather widget below) ---------- */
const geo = new Geo();

/* ---------- Widgets (content updates even while hidden) ---------- */
const clock = new Clock($('#clock'));
const weather = new Weather($('#weather'), geo);
const stats = new SystemStats($('#stats'));
new Links($('#links'));
const waveform = new Waveform($('#waveform-canvas'), $('[data-wave-label]'));

/* ---------- Voice + speech ---------- */
const audioFx = new AudioFx();
const speech = new Speech({ lang: 'it-IT' });                 // browser fallback voice
const tts = new NeuralTTS({ fallback: speech });              // ElevenLabs via PHP proxy
const voice = new VoiceRecognition({ lang: 'it-IT' });

/* ---------- AI brain ---------- */
const ai = new AI();
const auth = new Auth();
const appointments = new Appointments();
const push = new Push();

/* ---------- Music ---------- */
const music = new MusicPlayer();
const library = new MusicLibrary();
library.load();
const playlists = new Playlists();
const notes = new Notes();
const mail = new Mail();
const musicWidget = new MusicWidget({
  root: $('#music'),
  canvas: $('#music-eq'),
  titleEl: $('[data-music-title]'),
  artistEl: $('[data-music-artist]'),
  player: music,
});

const apptWidget = new AppointmentsWidget({
  root: $('#appointments'),
  listEl: $('[data-appt-list]'),
  appointments,
});

/* ---------- On-demand UI + assistant ---------- */
const widgets = new WidgetManager();
const assistant = new Assistant({ sm, simulator, widgets, speech: tts, voice, ai, auth, music, library, playlists, appointments, push, apptWidget, notes, geo, weather, mail });

// Music lifecycle + Bluetooth transport buttons
bus.on('music:ended', () => {
  if (!assistant.musicNext()) { widgets.hide('music'); voice.setMusicPlaying(false); } // nothing left -> resume wake
});
bus.on('music:next', () => assistant.musicNext());
bus.on('music:prev', () => assistant.musicPrev());

// While music actually plays, suspend always-on wake scanning so the mic
// doesn't periodically re-grab the audio session and interrupt playback on
// mobile (tap the sphere/mic to talk). Pausing/stopping resumes scanning.
bus.on('music:started', () => voice.setMusicPlaying(true));
bus.on('music:resumed', () => voice.setMusicPlaying(true));
bus.on('music:stopped', () => voice.setMusicPlaying(false));
bus.on('music:paused', () => voice.setMusicPlaying(false));

/* ---------- Mic + voice wiring ---------- */
// Unlock the audio output contexts on the first user gesture anywhere
// (browsers require a gesture before audio can play).
function unlockAudio() {
  audioFx.ensure();
  tts.ensure();
  music.ensure();
}
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

const micBtn = $('#mic-toggle');
if (!voice.isSupported) {
  micBtn.disabled = true;
  micBtn.title = 'Riconoscimento vocale non supportato da questo browser';
}
micBtn.addEventListener('click', async () => {
  unlockAudio();
  const on = await voice.toggle();
  micBtn.setAttribute('aria-pressed', String(on));
});

bus.on('voice:status', ({ state }) => {
  micBtn.setAttribute('aria-pressed', String(state === 'wake'));
  if (state === 'denied') audioFx.error();
});

// Hands-free terse commands (e.g. "stop", "avanti", "chiudi") recognized
// without the wake word, when JARVIS isn't mid-interaction.
voice.setDirectMatcher((phrase) => assistant.directCommand(phrase));

bus.on('voice:wake', () => {
  assistant.voiceWake(); // greets with a spoken phrase (no beep)
});

bus.on('voice:command', ({ text }) => {
  const clean = (text || '').trim();
  if (!clean) { assistant.abort(); return; } // empty command: ignore
  audioFx.ack();
  console.log('%c[JARVIS] -> AI:%c %s', 'color:#00e5ff;font-weight:bold', 'color:#ffd27a', clean);
  assistant.voiceEnd(clean);
});

// AI classification result
bus.on('ai:result', ({ text, intent, reply, remembered, error }) => {
  if (error) console.warn('[JARVIS] AI error:', error);
  console.log(
    '%c[JARVIS] intent:%c %s%c  reply:%c %s',
    'color:#00e5ff;font-weight:bold', 'color:#ffae3b', intent,
    'color:#00e5ff;font-weight:bold', 'color:#dff6ff', reply || '(frase fissa)',
  );
  if (remembered && remembered.length) {
    console.log('%c[JARVIS] memorizzato:%c %s', 'color:#00e5ff;font-weight:bold', 'color:#ffd27a', remembered.join(' | '));
  }
});

bus.on('voice:error', ({ error }) => {
  if (error === 'no-speech' || error === 'aborted') return; // benign, keep listening
  if (error === 'insecure-origin') {
    console.warn('[voice] microfono bloccato: apri il sito su https:// o su http://localhost. ' +
      'Su un IP di rete (es. http://192.168.x.x) il browser disabilita microfono e riconoscimento vocale.');
    return;
  }
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    console.warn('[voice] permesso microfono negato. Abilitalo dalle impostazioni del sito nel browser e ricarica.');
    return;
  }
  console.warn('[voice]', error);
});

/* ---------- DOM reflection of state ---------- */
const app = $('#app');
const stateLabel = $('#state-label');
const stateHint = $('#state-hint');
bus.on('state:change', ({ to, config }) => {
  app.dataset.state = to;
  stateLabel.textContent = config.label;
  stateHint.textContent = config.hint;
  // duck the music while JARVIS is busy listening / thinking / speaking
  music.duck(to === 'listening' || to === 'thinking' || to === 'speaking');
});

/* ---------- Interaction: a tap on the sphere = saying "JARVIS" ---------- */
// (manual fallback for when the wake word isn't picked up). No special
// click animation: it runs the exact same flow as the voice wake word.
new Interaction($('#stage'));
bus.on('input:tap', () => { unlockAudio(); assistant.voiceWake(); });

/* ---------- Resize ---------- */
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  sphere.resize(w, h);
  hud.resize(w, h);
  telemetry.resize(w, h);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));

/* ---------- Boot sequence ---------- */
const bootEl = $('#boot');
const bootProgress = $('#boot-progress');
const bootText = $('#boot-text');
const BOOT_STEPS = ['CORE ONLINE', 'CALIBRATING SENSORS', 'NEURAL LINK', 'READY'];
function runBoot() {
  let p = 0;
  const tick = () => {
    p = Math.min(1, p + 0.018 + Math.random() * 0.03);
    bootProgress.style.width = `${(p * 100).toFixed(0)}%`;
    visual.bootProgress = p;
    bootText.textContent = BOOT_STEPS[Math.min(BOOT_STEPS.length - 1, (p * BOOT_STEPS.length) | 0)];
    if (p < 1) requestAnimationFrame(tick);
    else setTimeout(() => {
      bootEl.classList.add('is-done');
      sm.force('idle');
    }, 350);
  };
  tick();
}

/* ---------- Main render loop ---------- */
let last = performance.now();
function frame(t) {
  let dt = (t - last) / 1000;
  last = t;
  if (dt > 0.1) dt = 0.1; // clamp after tab-switch / hitch

  // audio level owner: real TTS amplitude > listening/response simulator >
  // music bass (reactor pulses to the beat) > silence
  const level = tts.speaking ? tts.sample(dt)
    : (simulator.active ? simulator.sample(dt)
    : (music.playing ? music.bassLevel(dt) : 0));
  director.setLevel(level);

  director.update(dt);
  telemetry.update(dt);
  sphere.update(dt);
  hud.update(dt);

  clock.update();
  stats.update(dt, visual.energy);
  waveform.update(dt);
  musicWidget.update(dt);
  updateSpeedHud(t);

  requestAnimationFrame(frame);
}

/* ---------- Movement speed HUD (from GPS) ---------- */
const speedEl = $('#speedo');
const speedValEl = speedEl ? speedEl.querySelector('[data-speed]') : null;
let _lastSpeedShown = -1;
let _lastSpeedAt = 0;
function updateSpeedHud(t) {
  if (!speedEl || t - _lastSpeedAt < 300) return; // ~3 updates/sec
  _lastSpeedAt = t;
  const kmh = geo.speedKmh();
  if (kmh === null) {
    speedEl.classList.remove('is-active'); // no GPS speed (e.g. desktop / stationary)
    return;
  }
  speedEl.classList.add('is-active');
  if (kmh !== _lastSpeedShown) {
    speedValEl.textContent = String(kmh);
    _lastSpeedShown = kmh;
  }
}

/* ---------- Go ---------- */
onResize();
requestAnimationFrame(frame);
runBoot();

// Request the permissions we need up-front: microphone (always-on voice)
// and location (for future features). The mic stays listening for "JARVIS".
function startSensors() {
  if (!voice.active) voice.start();   // prompts for mic, then listens continuously
  geo.request();                      // prompts for location
  // If already unlocked on this device, register for push reminders now.
  if (assistant.authenticated && push.supported) push.enable();
  apptWidget.refresh(); // preload upcoming reminders into the HUD widget
}
startSensors();
// Some browsers only grant the mic prompt after a user gesture: retry then.
window.addEventListener('pointerdown', startSensors, { once: true });
window.addEventListener('keydown', startSensors, { once: true });

// Pre-cache all fixed phrases (already-cached ones cost nothing).
setTimeout(() => tts.warm(FIXED_PHRASES), 2500);

// expose for console experimentation
window.JARVIS = { sm, director, simulator, assistant, widgets, voice, audioFx, speech, tts, ai, music, library, playlists, notes, mail, geo, weather, appointments, push, visual };
