 JARVIS - Libreria musicale
===========================

Organizza i brani in cartelle per artista:

  music/
    Daft Punk/
      Get Lucky.mp3
      Harder Better Faster Stronger.mp3
    Hans Zimmer/
      Time.mp3
    ...

Regole:
- Una cartella per ogni ARTISTA (il nome della cartella e' l'artista).
- Dentro, i file audio: il nome del file (senza estensione) e' il TITOLO.
- Formati supportati: mp3, m4a, aac, ogg, opus, wav, flac.
- I file messi direttamente in music/ (senza cartella artista) finiscono
  sotto l'artista "Vari".

JARVIS scansiona automaticamente questa cartella (server/music.php) e genera
il manifest music/catalog.json, che l'AI usa per sapere cosa puo' riprodurre.
Non devi generare nulla a mano: aggiungi i file e basta.
