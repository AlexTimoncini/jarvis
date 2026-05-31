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

    // --- Codice di attivazione vocale ---
    // Frase da pronunciare per sbloccare JARVIS (aggiornabile a voce).
    'access_code' => 'protocollo casa party',
];
