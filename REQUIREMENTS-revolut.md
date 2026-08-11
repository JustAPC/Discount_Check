# Macrofunzione Revolut — requisiti

Seconda fonte di offerte accanto a Corporate Benefits: i **moltiplicatori RevPoints** e i
cashback del Marketplace Revolut, estratti da screenshot dell'app e serviti all'estensione
via API sul TrueNAS.

## Flusso

```
screenshot lunghi (app Revolut)
  → cartella locale
  → routine in chat: split in strisce (6-8 tile) → estrazione JSON
  → POST /revolut/ingest  (Cloudflare Tunnel + bearer)
  → delta in revolut_pending
  → dashboard estensione: diff review → approve
  → revolut_offer (stato corrente)
  → GET /revolut/offers  (1x/giorno dall'estensione, alarm `daily` esistente)
  → cache in chrome.storage.local + indice nomi
  → popup al carrello: "Revolut: 2x RevPoints"
```

Nessun modello self-hosted, nessun OCR. Il container su TrueNAS è **solo API + MariaDB**.
Motivo: volume massimo ~2 immagini/giorno, l'inferenza locale costerebbe più manutenzione
di quanto rende.

## Decisioni prese

| Tema | Scelta |
|---|---|
| Cattura | 1-2 screenshot lunghi stitchati, split lato routine in strisce da 6-8 tile |
| Estrazione | modello in chat → JSON validato server-side. Solo `POST /ingest`, nessun endpoint immagine |
| Mapping nome→dominio | matcher esistente (`nameKeys`/`etld1`) + alias manuali dalla dashboard |
| Trasporto | Cloudflare Tunnel + bearer token, token in `storage.local` (mai nel repo) |
| Review | diff review in dashboard: si approva solo il delta, le sparizioni non spengono nulla finché non confermi |
| Attivazione offerta | non modellata: il messaggio esce nel popup al carrello in ogni caso |

### Perché lo split è obbligatorio
Gli screenshot stitchati sono ~100 tile di altezza. Qualunque modello vision ridimensiona
l'immagine in ingresso e i badge `2x` — piccoli e sovrapposti al logo — sono i primi
caratteri a diventare illeggibili. Si taglia prima, si analizza dopo.

### Matching conservativo (diverso da CB)
CB è tarato per **preferire i falsi positivi**. Revolut no: un falso positivo qui consiglia
la carta sbagliata, cioè fa perdere punti invece di farne guadagnare.

Regola: match **solo** su uguaglianza esatta tra `name_key` (token normalizzati concatenati,
es. `Wizz Air` → `wizzair`) e la label del dominio corrente, oppure su alias manuale.
Nessun substring match. Copre i brand puliti del Marketplace; il resto si aggiunge a mano.

## Schema MariaDB

```sql
CREATE TABLE revolut_offer (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,              -- "Wizz Air"
  name_key   VARCHAR(120) NOT NULL,              -- "wizzair"
  kind       ENUM('multiplier','cashback') NOT NULL,
  value      DECIMAL(5,2) NOT NULL,              -- 2.00 = 2x | 10.00 = 10%
  value_raw  VARCHAR(32)  NOT NULL,              -- "2x" | "Fino a 10%"
  channel    ENUM('online','instore','both') NOT NULL DEFAULT 'online',
  domain     VARCHAR(190) NULL,                  -- alias manuale
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  first_seen DATE NOT NULL,
  last_seen  DATE NOT NULL,
  UNIQUE KEY uq_offer (name_key, kind, channel)
);

CREATE TABLE revolut_pending (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  batch      CHAR(36) NOT NULL,
  op         ENUM('add','update','remove') NOT NULL,
  offer_id   INT NULL,
  payload    JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY k_batch (batch)
);
```

`channel = instore` viene salvato ma non servito all'estensione: scartarlo in ingest sarebbe
irreversibile.

## API (bearer obbligatorio su tutto)

| Metodo | Path | Body / Risposta |
|---|---|---|
| POST | `/revolut/ingest` | `{captured_at, complete, offers:[{name, badge, channel}]}` → `{batch, add, update, remove}` |
| GET | `/revolut/pending` | batch aperto con le righe da approvare |
| POST | `/revolut/pending/:batch/approve` | `{reject_ids:[…]}` → applica il resto a `revolut_offer` |
| GET | `/revolut/offers` | `{updated_at, offers:[{name, name_key, kind, value, value_raw, domain}]}` — solo `active` e `channel != instore` |
| POST | `/revolut/offers/:id/alias` | `{domain}` — l'alias vive server-side, non solo nel browser |

`complete: false` (snapshot parziale) → nessun `remove` nel delta.

## Modifiche all'estensione

- **`background.js`**: fetch Revolut nell'alarm `daily` già presente; cache in
  `storage.local` (`revolut`, `ridx`); `matchRevolut(host)` con la regola exact-match;
  fallimento del fetch = si tiene la cache, mai svuotarla.
- **`content.js`**: sezione Revolut nell'overlay, con `value_raw` e l'indicazione di pagare
  con Revolut. Il popup al carrello **esce anche se CB non matcha** e c'è solo Revolut.
  CB e Revolut sono cumulabili: nessun messaggio che li presenti come alternativi.
- **`dashboard.js`**: config endpoint + token, stato ultima sync Revolut, coda diff review,
  gestione alias.
- **`README.md`**: la frase "nessuna chiamata a server terzi" non è più vera. Va riscritta:
  il catalogo Revolut arriva da un endpoint self-hosted, tutto il resto resta locale.

## Non-goals

Niente scraping delle API Revolut. Niente VLM/OCR self-hosted. Niente automazione Android.
Niente date di scadenza (non sono negli screenshot): si usa `last_seen` + conferma manuale.
Niente differenze per piano carta (Standard/Premium/Metal).

## Da verificare prima di implementare

1. Tool per lo split immagine sulla macchina Windows: Python + Pillow oppure ImageMagick.
2. Dove gira il container (stack Docker su TrueNAS), hostname del tunnel, credenziali MariaDB.
3. Quali tab dell'app entrano nello snapshot: Marketplace intero o anche "Le tue offerte".
