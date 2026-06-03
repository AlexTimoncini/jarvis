# Deploy J.A.R.V.I.S. — guida operativa server

Tutte le azioni da eseguire **dopo aver caricato l'intera cartella del progetto
così com'è** (root + `server/` + `music/`). I comandi assumono accesso SSH; dove
indicato puoi usare il pannello dell'hosting.

> Sostituisci ovunque `https://tuodominio` con il dominio reale e
> `IL_TUO_CRON_SECRET` con il valore che metti in `config.php`.

---

## 0. Prerequisiti del server

- **PHP ≥ 8.1** (consigliato 8.2+).
- Estensioni PHP attive: `curl`, `openssl`, `mbstring`, `json`, e **`gmp`**
  *oppure* **`bcmath`** (servono a `minishlink/web-push` per firmare le notifiche).
  Consigliata anche `intl` (matching accenti più robusto). Per la **lettura email**
  serve l'estensione **`imap`** (altrimenti la funzione mail resta disattivata e JARVIS
  lo dice). Verifica con:
  ```bash
  php -m | grep -Ei 'curl|openssl|mbstring|gmp|bcmath|intl|imap'
  ```
  Se manca `imap`: installala (es. `sudo apt install php-imap && sudo phpenmod imap`,
  oppure abilitala dal pannello dell'hosting) e riavvia PHP.
- **HTTPS obbligatorio** (microfono, installazione PWA e Web Push non funzionano
  in HTTP). `mod_rewrite` attivo per il redirect in `.htaccess`.
- `composer` disponibile (o lo si scarica al passo 2).

---

## 1. File da creare sul server (non presenti nel repo)

Sono esclusi da git ma **necessari a runtime**. Vanno creati sul server:

```bash
cd server
cp config.sample.php config.php
cp profile.sample.json profile.json
```

Le cartelle `server/data/` e `server/cache/` vengono create da sole al primo
uso; se vuoi anticiparle vedi il passo 4.

---

## 2. Composer — dipendenze Web Push

Serve **solo** per le notifiche dei promemoria (`minishlink/web-push`). Il resto
del backend (AI, TTS, note, agenda, musica, auth) funziona anche senza.

```bash
cd server
composer install
```

Se `composer` non è installato globalmente:
```bash
cd server
curl -sS https://getcomposer.org/installer | php
php composer.phar install
```

Risultato atteso: viene creata `server/vendor/` con `autoload.php`.

---

## 3. Configurazione segreti — `server/config.php`

Compila i campi:

| Campo | Dove ottenerlo / cosa mettere |
|-------|-------------------------------|
| `api_key` | ElevenLabs → https://elevenlabs.io → Profilo → **API Keys** |
| `voice_id` | (opzionale) ID di una voce IT femminile dal tuo account ElevenLabs |
| `gemini_api_key` | Google AI Studio → https://aistudio.google.com/apikey (gratuito) |
| `access_code` | la frase di sblocco vocale che preferisci |
| `cron_secret` | token lungo casuale → genera con `openssl rand -hex 24` |
| `vapid_subject` | `mailto:tua@email` |
| `vapid_public` / `vapid_private` | **lasciali vuoti ora**, li generi al passo 5 |
| `timezone` | `Europe/Rome` (già impostato) |

Personalizza anche `server/profile.json` (nome, info, fatti) — è la memoria
di JARVIS.

---

## 4. Permessi cartelle (scrivibili dall'utente PHP)

L'utente del web server (`www-data`, `apache`, ...) deve poter scrivere in:

| Percorso | Perché |
|----------|--------|
| `server/data/` | appuntamenti, **note**, iscrizioni push |
| `server/cache/` | MP3 TTS in cache (frasi fisse) |
| `server/config.php` | **solo** se vuoi il cambio codice a voce ("cambia il codice…") |
| `music/` | (opzionale) per scrivere `music/catalog.json` |

```bash
cd server
mkdir -p data cache
chmod -R 775 data cache
# adatta l'utente al tuo hosting (www-data / apache / nginx):
chown -R www-data:www-data data cache
```

**Verifica protezione dati personali** (deve già esserci `server/data/.htaccess`
con `Deny from all`): la richiesta diretta ai JSON deve restituire **403**.

---

## 5. Genera le chiavi VAPID (notifiche promemoria)

Dopo `composer install`:

1. Apri **una volta** nel browser: `https://tuodominio/server/vapid_gen.php`
2. Copia `vapid_public` e `vapid_private` mostrati dentro `server/config.php`.
3. **Elimina** il file (altrimenti rigenera chiavi nuove ogni volta):
   ```bash
   rm server/vapid_gen.php
   ```

---

## 6. Cron per i promemoria

Le notifiche partono da `server/cron.php`, da chiamare **ogni minuto**:

```cron
* * * * * curl -fsS "https://tuodominio/server/cron.php?key=IL_TUO_CRON_SECRET" >/dev/null 2>&1
```

`key` deve combaciare con `cron_secret` di `config.php`. Senza cron gli
appuntamenti si salvano ma le notifiche push non vengono mai inviate.

---

## 7. Musica (opzionale)

Carica gli audio in `music/<Artista>/<Titolo>.mp3` (formati: mp3, m4a, aac, ogg,
opus, wav, flac). Il catalogo si rigenera **automaticamente** quando il client
chiama `server/music.php` all'avvio. Per forzarlo manualmente apri:
`https://tuodominio/server/music.php`.

---

## 8. Service worker / cache PWA

Ad **ogni** nuovo deploy, incrementa la versione cache in `sw.js` (riga
`const CACHE = 'jarvis-vN';`, ora `jarvis-v7`) così i dispositivi già installati
non restano sulla shell vecchia.

---

## 9. Test da eseguire

### 9.1 Health-check
```bash
curl https://tuodominio/server/index.php
# atteso: {"service":"jarvis","status":"ok",...}
```

### 9.2 Cervello AI (Gemini)
```bash
curl -X POST https://tuodominio/server/ai.php \
  -H 'Content-Type: application/json' \
  -d '{"text":"che ore sono?","history":[]}'
# atteso: JSON con "intent" e "reply".
# "missing gemini api key" -> controlla config.php
```

### 9.3 Voce (ElevenLabs)
```bash
curl -X POST https://tuodominio/server/tts.php \
  -H 'Content-Type: application/json' \
  -d '{"text":"Salve Signore","cache":true}' --output test.mp3
# atteso: file audio MP3. Ripeti: la 2a volta header "X-Cache: HIT".
```

### 9.4 Codice di accesso
```bash
curl -X POST https://tuodominio/server/auth.php \
  -H 'Content-Type: application/json' \
  -d '{"action":"verify","code":"LA TUA FRASE"}'
# atteso: {"ok":true}
```

### 9.5 Agenda
```bash
curl -X POST https://tuodominio/server/appointments.php \
  -H 'Content-Type: application/json' \
  -d '{"action":"add","title":"Test","datetime":"2026-12-31 10:00"}'
curl -X POST https://tuodominio/server/appointments.php \
  -H 'Content-Type: application/json' -d '{"action":"list"}'
```

### 9.6 Note (feature nuova)
```bash
curl -X POST https://tuodominio/server/notes.php \
  -H 'Content-Type: application/json' \
  -d '{"action":"add","title":"Spesa","content":"- Latte\n- Pane"}'
curl -X POST https://tuodominio/server/notes.php \
  -H 'Content-Type: application/json' -d '{"action":"list"}'
# download .txt (verifica header Content-Disposition: attachment):
curl -D - "https://tuodominio/server/notes.php?action=download&title=Spesa"
```

### 9.6b Posta (lettura email via IMAP)
Richiede l'estensione `imap` e il blocco `'mail'` compilato in `config.php`
(host/porta/credenziali; per overcover.com: host `mail.overcover.com`, porta 993, SSL).
```bash
# quante non lette + mittenti recenti:
curl -X POST https://tuodominio/server/mail.php \
  -H 'Content-Type: application/json' -d '{"action":"unread"}'
# atteso: {"ok":true,"count":N,"items":[...]}
# leggi / riassumi l'ultima:
curl -X POST https://tuodominio/server/mail.php -H 'Content-Type: application/json' -d '{"action":"read"}'
curl -X POST https://tuodominio/server/mail.php -H 'Content-Type: application/json' -d '{"action":"summary"}'
```
Errori comuni: `php imap extension not installed` (abilita `imap`), `mail not configured`
(password mancante in `config.php`), errori di connessione → verifica host/porta o prova
`'novalidate' => true` se il certificato del server di posta dà problemi.
La lettura usa `FT_PEEK`: **non** segna i messaggi come letti.

### 9.7 Web Push end-to-end
```bash
# chiave pubblica esposta al client:
curl "https://tuodominio/server/push.php?action=vapid"
# atteso: {"key":"BJ..."}  (se vuoto -> VAPID non configurate, vedi passo 5)
```
Poi, da telefono: apri la PWA → sblocca col codice → accetta le notifiche →
crea un appuntamento con promemoria tra ~2 minuti → forza il dispatcher:
```bash
curl -fsS "https://tuodominio/server/cron.php?key=IL_TUO_CRON_SECRET"
# atteso: {"ok":true,"sent":1,...} e la notifica arriva sul dispositivo
```

### 9.8 Sicurezza (i dati personali NON devono essere pubblici)
```bash
curl -i "https://tuodominio/server/data/appointments.json"
# atteso: 403 Forbidden
```

### 9.9 Browser / PWA
- Apri `https://tuodominio` da Chrome mobile → deve chiedere **microfono** e **posizione**.
- DevTools → *Application*: Manifest senza errori, Service Worker **activated**.
- Pronuncia "**Jarvis**" → saluto vocale; prova "metti musica", "che impegni ho?".
- *Aggiungi a schermata Home* → si avvia a schermo intero in portrait.

---

## 10. Checklist finale

- [ ] `composer install` ok (`server/vendor/` presente)
- [ ] `server/config.php` compilato (Gemini + ElevenLabs + `access_code` + `cron_secret`)
- [ ] `server/profile.json` presente e personalizzato
- [ ] Chiavi **VAPID** generate e `vapid_gen.php` **eliminato**
- [ ] **Cron** attivo ogni minuto
- [ ] `server/data/` e `server/cache/` scrivibili
- [ ] **HTTPS** attivo + redirect da HTTP
- [ ] `server/data/.htaccess` blocca l'accesso (403 verificato)
- [ ] Versione cache in `sw.js` incrementata

---

## Note importanti

- **Senza VAPID** le notifiche non partono; tutto il resto funziona comunque.
- **Senza cron** gli appuntamenti si salvano ma non avvisano.
- `server/config.php` e `server/profile.json` **non** sono nel repo (gitignored):
  vanno creati/aggiornati direttamente sul server e **non** sovrascritti dai deploy.
- Il cambio del codice a voce richiede `config.php` scrivibile dal web server.
