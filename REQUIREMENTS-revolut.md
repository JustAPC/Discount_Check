# Macrofunzione Revolut — requisiti

Seconda fonte di offerte accanto a Corporate Benefits: i **moltiplicatori RevPoints** e i
cashback del Marketplace Revolut, estratti da screenshot dell'app e serviti all'estensione
via API sul TrueNAS.

## Flusso

```
screenshot (app Revolut, anche stitchati lunghi)
  → allegati alla chat Hermes (dashboard web, da qualunque device)
  → skill `revolut-ingest`:
        GET /revolut/offers      (stato attuale)
        split in strisce (Pillow) → vision → JSON
        nomi troncati e conflitti → una domanda sola, in blocco
        diff mostrato in chat → Andrea approva
        POST /revolut/ingest     (solo ciò che è stato approvato)
  → revolut_offer (stato corrente)
  → GET /revolut/offers          (1x/giorno dall'estensione, alarm `daily` esistente)
  → cache in chrome.storage.local + indice nomi
  → popup al carrello: "Revolut: 2x RevPoints"
```

## Chi fa cosa

| Attore | Responsabilità |
|---|---|
| Andrea | screenshot → allegato in chat Hermes → `ingest revolut` → approva il diff **nella stessa chat** |
| **Hermes Agent** | split immagine, lettura crop (vision), diff vs stato attuale, `POST /ingest` |
| **sconti-api** (Docker su TrueNAS) | legge e scrive `revolut_offer`. Non vede mai immagini, non decide nulla |
| Estensione | `GET /offers` 1x/giorno, cache, match, popup. **Sola lettura** |

Due punti fermi:

- l'estrazione **non dipende dalla macchina** su cui gira l'estensione: Hermes si usa dal
  telefono via URL;
- la skill parla **solo HTTP**, mai il client mysql. Così è identica dal container TrueNAS
  e dal client Hermes Desktop, anche fuori casa. Un solo code path.

## Decisioni prese

| Tema | Scelta |
|---|---|
| Cattura | 1-2 screenshot lunghi stitchati, si analizza tutto ciò che c'è nell'immagine |
| Split | dentro Hermes, `code_execution` + Pillow, strisce da 6-8 tile |
| Vision | il modello che Hermes usa già: `gpt-5.5` via provider `openai-codex` — nessuna chiave nuova |
| Mapping nome→dominio | **il campo `domain` sul server**, curato negozio per negozio. Il matcher sui nomi resta solo per chi non ce l'ha |
| Host API | `sconti-api.andreapontillo.tech` via Cloudflare Tunnel |
| Auth | **Una sola chiave, `INGEST_TOKEN`, solo in scrittura.** Lettura pubblica: il catalogo non è sensibile e così i client non gestiscono credenziali. Niente Cloudflare Access |
| Review | diff in chat Hermes: al server arriva solo ciò che hai approvato, quindi niente si spegne da sé |
| Attivazione offerta | non modellata: il messaggio esce nel popup al carrello in ogni caso |

### Perché lo split è obbligatorio
Gli screenshot stitchati sono ~100 tile di altezza. Qualunque modello vision ridimensiona
l'immagine in ingresso e i badge `2x` — piccoli e sovrapposti al logo — sono i primi
caratteri a diventare illeggibili. Si taglia prima, si analizza dopo.

### Matching: permissivo solo dove il dominio non si sa
Scritto all'inizio come "si accetta il rumore", perché il falso positivo sembrava costare
poco: con Revolut si paga comunque. **Non ha retto all'uso.** Il badge si vede su ogni tab,
e il rumore lì è permanente e visibile: "Qatar Airways" compariva su `ita-airways.com` e
"Corriere dello Sport" su `corriere.it`, perché i nomi di due parole producevano chiavi come
`airways` e `corriere`.

La correzione non è stata stringere le euristiche — ogni giro più severo recupera un falso
positivo e ne perde uno vero — ma **curare il dato**: un negozio con `domain` esce dagli
indici sui nomi ed entra solo in quelli sul dominio. Dove il sito si sa, non si indovina; e
un dominio scritto sul server vale per tutti entro 24 ore senza pubblicare nulla.

Il pattern `blocked` esistente resta come rimedio immediato e locale, con chiave separata
dalle offerte CB.

## Schema MariaDB

```sql
CREATE TABLE revolut_offer (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,              -- "Wizz Air"
  name_key   VARCHAR(120) NOT NULL,              -- "wizzair"
  kind       ENUM('points','cashback') NOT NULL DEFAULT 'points',
  rate       DECIMAL(6,2) NOT NULL,              -- punti ogni 10 € (2, 4, 10, 20) | % se cashback
  badge_raw  VARCHAR(48)  NOT NULL,              -- "2 per 10 €", testo esatto letto dal tile
  boosted    TINYINT(1)   NOT NULL DEFAULT 0,    -- badge viola = tasso potenziato
  channel    ENUM('online','instore','both') NOT NULL DEFAULT 'online',
  domain     VARCHAR(190) NULL,                  -- curato a mano: vince sull'ingest
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  first_seen DATE NOT NULL,
  last_seen  DATE NOT NULL,
  UNIQUE KEY uq_offer (name_key, channel)
);
```

Una tabella sola. Non serve una coda di approvazione: l'approvazione è già avvenuta in chat
prima della POST.

### Semantica dei badge (verificata sugli screenshot reali)

Non esistono moltiplicatori `Nx`: il badge è un **tasso di accumulo**, `"N per 10 €"` —
punti RevPoints ogni 10 € spesi. Rilevati: `2` (Wizz Air, Aer Lingus), `4` (Marketplace
generico, Michael Kors), `10` (LEGO Store, Hugo Boss, The North Face), `20` (Nike, NordVPN,
Levi's, Google Store).

Il **colore del badge** è informazione, non decorazione: viola = tasso potenziato, grigio =
tasso base. Va letto e salvato in `boosted`.

**Come si mostra**: il numero con la `x` — `2 per 10 €` → **`2x`**, `20 per 10 €` → **`20x`**.
L'etichetta la costruisce il server (campo `label`), i client non formattano nulla. In DB
resta il valore numerico più il `badge_raw` originale, così se un giorno cambia la resa non
serve rifare l'ingest.

`channel = instore` viene salvato ma non servito all'estensione: scartarlo in ingest sarebbe
irreversibile.

## API — `sconti-api.andreapontillo.tech`

Lettura pubblica; la scrittura richiede l'header `X-Ingest-Token`. Se il token non e'
configurato il server rifiuta di scrivere (503) invece di accettare tutto.

| Metodo | Path | Body / Risposta |
|---|---|---|
| GET | `/revolut/offers` | `{updated_at, offers:[{id, name, name_key, kind, rate, badge_raw, boosted, channel}]}` |
| POST | `/revolut/ingest` | `{captured_at, upsert:[{name, badge_raw, boosted, channel, domain?}], deactivate:[name_key]}` → `{upserted, deactivated, skipped}` |
| POST | `/revolut/domains` | `{name_key: dominio}` → `{set, unset, unknown}`. Scrive e corregge i domini senza toccare i tassi |

`name_key`, `kind` e `rate` li deriva il server dal testo del badge: un solo parser, non
una regola replicata nella skill.

Tre endpoint di scrittura e lettura, poche righe l'uno. Il server **esegue letteralmente**
ciò che riceve: non inferisce le rimozioni dall'assenza nella lista. Uno snapshot parziale quindi non può cancellare
niente — è Hermes, con te che approvi, a decidere cosa disattivare.

`GET /offers` serve sia l'estensione (filtrata: solo `active`, `channel != instore`) sia
Hermes, che la usa come stato di partenza per il diff.

Il **dominio** è l'unico campo che non arriva dagli screenshot: si decide guardando dove si
compra davvero. Per questo `/ingest` può solo riempirlo dove è vuoto — `COALESCE(domain,
VALUES(domain))` — e non lo sovrascrive mai: la skill lo *propone* al passo 4, dove un "ok"
distratto lo cancellerebbe in silenzio. Per scriverlo o correggerlo c'è `/revolut/domains`,
che è esplicito per costruzione.

Gli alias locali della dashboard restano, ma sono un ripiego per-dispositivo: quando il server
impara il dominio di quel negozio, l'estensione li cancella da sola, o resterebbero applicati
sopra il dato buono appena arrivato.

Hardening opzionale: una regola di rate limiting Cloudflare su `/revolut/ingest`. L'endpoint
è pubblico, quindi raggiungibile dagli scanner: il codice è minimo e le query parametrizzate,
ma una rete di sicurezza gratuita non guasta.

## Modifiche all'estensione

- **`background.js`**: fetch Revolut nell'alarm `daily` già presente, senza credenziali; cache in `storage.local` (`revolut`, `ridx`); `matchRevolut(host)`;
  fallimento del fetch = si tiene la cache, mai svuotarla.
- **`content.js`**: sezione Revolut nell'overlay con la `label` (`20x`). Il popup al carrello
  **esce anche se CB non matcha** e c'è solo Revolut. CB e Revolut sono cumulabili:
  nessun messaggio che li presenti come alternativi.
- **`dashboard.js`**: stato ultima sync Revolut, lista offerte con gestione alias, bottone di
  aggiornamento manuale. Nessuna coda di review (sta in Hermes) e niente configurazione:
  l'endpoint è la costante `REVOLUT_API` in `background.js`, non ci sono segreti da inserire.
- **`README.md`**: la frase "nessuna chiamata a server terzi" non è più vera e va riscritta.

## Skill Hermes `revolut-ingest`

Vive in `hermes-skill/` in questa repo e si copia a mano nel profilo Hermes come
`skills/revolut-ingest/` (la sync automatica del profilo è stata abbandonata). Le credenziali
stanno in `config.env` accanto a `SKILL.md`, non in variabili del container: la skill si
porta dietro la propria configurazione. Contiene: `split_revolut.py`, le regole di lettura dei tile
(nome, `Online`/`In negozio`, testo del badge, **colore** del badge), dedup per `name_key`,
calcolo del diff vs `GET /offers`, presentazione del diff per l'approvazione, `POST /ingest`
con l'header `X-Ingest-Token`.

Regola di scarto: le card tagliate ai bordi dell'immagine, senza nome o senza badge
leggibile, si ignorano e si riporta quante ne sono state scartate.

È qui che vive tutta l'intelligenza del sistema. Il server è deliberatamente stupido.

## Non-goals

Niente scraping delle API Revolut. Niente VLM/OCR self-hosted. Niente automazione Android.
Niente date di scadenza (non sono negli screenshot): si usa `last_seen` + conferma manuale.
Niente differenze per piano carta (Standard/Premium/Metal).

## Ambiente verificato (2026-08-11)

- Hermes toolsets attivi: `vision`, `code_execution`, `file`, `terminal`, `web`, `cronjob`
- Docker su TrueNAS per `sconti-api`; MariaDB `negozi_revolut` già presente
- Python 3.11 + Pillow 12.2 anche sul PC (utile solo per test locali dello split)

## Split — verificato sugli screenshot reali (2026-08-11)

`split_revolut.py` taglia sulle bande uniformi lasciate dallo stitching, non a passo fisso:
nessuna card spezzata. Misurato su `Screenshot_20260811_174533` (720×27110) → 27 strisce e
`_174623` (720×14562) → 14 strisce, tutte 720×1080 tranne testa e coda. Passo delle bande:
1080 px. A quella dimensione nome, badge e colore sono letti senza errori.

Fallback già nel codice: se le bande non ci sono (screenshot non stitchato), taglia a passo
fisso con `MAX_STRIP`.

## Esito del primo run reale (2026-08-12)

Tutte le incognite sono cadute:

- il toolset `vision` di Hermes **legge i crop da disco**, non solo gli allegati della chat:
  era il perno dell'intero flusso;
- 41 strisce dalle due immagini, **143 tile letti**, badge e colori interpretati correttamente;
- Pillow non è installabile a sistema (ambiente PEP 668): la skill usa un venv usa e getta
  con `uv`. La procedura è nella skill, non va reimparata ogni volta;
- ingest completato e scritto su MariaDB.

Costo reale: qualche minuto per due immagini, quasi tutto speso nelle chiamate vision
sequenziali (una per striscia). Il modello non è il collo di bottiglia — il numero di
chiamate lo è. Se un giorno desse fastidio: abbassare il reasoning effort e raggruppare
più strisce per chiamata, prima di pensare a modelli diversi.

Due cose emerse dall'uso, entrambe già risolte nella skill:

- **i nomi lunghi sono troncati dall'app Revolut stessa** (`Apple Store Onli…`): nessun
  ritaglio migliore li recupera, vanno proposti e confermati mostrando il valore esatto che
  finirebbe a DB;
- **i duplicati non si risolvono da soli**: uno stesso negozio con due tassi può anche essere
  un nome letto male, quindi si mostra il conflitto e decide Andrea.

Resta aperto solo questo: se esistono tab con cashback in `%` (non viste negli screenshot
finora), lo schema le regge già con `kind='cashback'`.
