<?php
/**
 * JARVIS - server placeholder (Fase 2).
 *
 * In futuro questo endpoint riceve il testo/utterance e restituisce
 * la risposta dell'AI insieme a un "comando di animazione" JSON che
 * il client passa a AnimationDirector.applyCommand():
 *
 *   {
 *     "reply":  "testo della risposta",
 *     "anim": {
 *       "state": "speaking",
 *       "intensity": 0.8,
 *       "accent": "#00e5ff",
 *       "motifs": ["pulse", "ripple"],
 *       "seed": 12345
 *     }
 *   }
 *
 * Per ora risponde solo con un ping di health-check.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

echo json_encode([
    'service' => 'jarvis',
    'status'  => 'ok',
    'phase'   => 1,
    'message' => 'AI backend non ancora implementato',
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
