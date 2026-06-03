<?php
/**
 * Copy this file to server/config.php and fill in your keys.
 * server/config.php is gitignored so secrets never get committed.
 */
return [
    // --- ElevenLabs (voce) ---
    'api_key'  => '',                          // <-- your ElevenLabs API key
    'voice_id' => 'Xb7hH8MSUJpSbSDYk0k2',      // Alice (female), works on free plan
    'model_id' => 'eleven_multilingual_v2',    // supports Italian

    // --- Google Gemini (cervello / conversazione) ---
    // Chiave gratuita da https://aistudio.google.com/apikey
    'gemini_api_key' => '',                    // <-- your Google AI Studio API key
    'gemini_model'   => 'gemini-2.5-flash-lite', // free tier generoso e veloce
    // Modello piu' capace per estrarre data/ora degli appuntamenti (flash-lite
    // non risolve bene le date). Usato solo per l'intent appointment.
    'gemini_appt_model' => 'gemini-2.5-flash',

    // --- Codice di attivazione vocale ---
    // Frase da pronunciare per sbloccare JARVIS (aggiornabile a voce).
    'access_code' => 'protocollo casa party',

    // --- Fuso orario per appuntamenti/promemoria ---
    'timezone' => 'Europe/Rome',

    // --- Web Push (notifiche appuntamenti) ---
    // 1) Sul server: `composer install`
    // 2) Apri server/vapid_gen.php nel browser per generare la coppia di chiavi
    // 3) Incolla qui public/private.
    'vapid_public'  => '',
    'vapid_private' => '',
    'vapid_subject' => 'mailto:you@example.com',

    // Token segreto per autorizzare il cron (curl). Scegline uno lungo a caso.
    'cron_secret' => 'cambia-questo-token-lungo-e-casuale',
];
