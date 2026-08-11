---
name: revolut-ingest
description: Estrae i negozi e i moltiplicatori RevPoints dagli screenshot dell'app Revolut e li salva su sconti-api. Usare quando Andrea allega screenshot dell'app Revolut o scrive "ingest revolut".
---

# revolut-ingest

Trasforma screenshot dell'app Revolut nella lista di negozi con moltiplicatore che
l'estensione CB Reminder mostra al checkout.

Non inventare mai un negozio o un valore: se un tile non è leggibile, si scarta e si dice.

## Configurazione

Le credenziali stanno in `config.env`, **nella stessa cartella di questo file**. Niente
variabili d'ambiente del container: la skill si porta dietro la propria configurazione.

Prima di qualunque chiamata, spostarsi nella cartella della skill e caricare il file:

```bash
cd <cartella da cui hai letto questo SKILL.md>
set -a && . ./config.env && set +a
```

Le variabili valgono per la singola sessione di shell: se un comando successivo gira in una
shell nuova, ricaricare il file.

Se `config.env` non esiste, fermarsi e dire ad Andrea di crearlo da `config.example.env`:
senza `INGEST_TOKEN` la scrittura viene rifiutata e si perde solo tempo.

La lettura (`GET /revolut/offers`) è pubblica e non richiede nulla. La sola scrittura porta
l'header `X-Ingest-Token`.

## Procedura

### 1. Stato attuale

```bash
curl -s "$SCONTI_API/revolut/offers"
```

Serve per il diff del passo 4. Se la chiamata fallisce, fermarsi e dirlo: senza stato
attuale il diff non ha senso e un ingest alla cieca può disattivare offerte vive.

### 2. Split

Gli screenshot sono alti decine di migliaia di pixel. Dati interi a un modello vengono
ridimensionati e i badge diventano illeggibili: **vanno sempre tagliati prima**.

```bash
python split_revolut.py <screenshot> ./crops
```

Lo script taglia sulle bande uniformi dello stitching, quindi nessuna card resta spezzata.
Stampa una riga per striscia con dimensioni e coordinate.

### 3. Lettura

Guardare **una striscia alla volta**, in ordine. Per ogni card leggere:

| Campo | Dove |
|---|---|
| `name` | il testo grande sotto il logo — "Wizz Air", "MR PORTER" |
| `channel` | la riga sotto il nome: `Online` → `online`, `In negozio` → `instore` |
| `badge_raw` | il testo esatto della pillola: `"2 per 10 €"` |
| `boosted` | **colore** della pillola: viola → `true`, grigio → `false` |

Ogni card finisce in una di tre categorie:

1. **Completa** — nome e badge leggibili: va nell'elenco normale.
2. **Nome troncato dall'app** — il testo finisce con `…` (`Apple Store Onli…`) ma il badge si
   legge: **non si scarta**, si porta al passo 4 come voce da confermare. La troncatura è
   nella UI di Revolut, non nel ritaglio: riguardare l'immagine non la risolve.
3. **Illeggibile** — card tagliata dal bordo dell'immagine, senza nome o senza badge: si
   scarta e si conta.

Altre regole:

- Le intestazioni (`Negozi`, `Le tue offerte`, `Scopri di più`), la barra dei tab e il saldo
  punti in alto a destra non sono negozi.
- Lo stesso negozio può comparire in più strisce o in più immagini: si tiene una riga sola.
- **Stesso negozio con tassi diversi** (es. `dott` 10x viola e `Dott` 2x grigio): **non
  decidere da solo, mai.** Va portato al passo 4 come conflitto, mostrando entrambi i valori:
  decide Andrea quale tenere. Un duplicato può anche voler dire che si è letto male un nome,
  quindi nasconderlo con una regola automatica nasconde un errore.

### 4. Nomi troncati e conflitti

Una domanda sola, in blocco, con **due tabelle**. Vale una regola sopra tutte:

> **Mai chiedere una conferma senza mostrare il valore esatto che finirebbe nel database.**
> "Confermi i completamenti più plausibili?" è una domanda inutile: Andrea non può rispondere
> se non vede cosa stai per scrivere.

Quindi, per ogni nome troncato, **sempre tre colonne**: quello che si legge, quello che si
salverebbe come `name`, e il dominio associato se lo si sa.

```
NOMI TRONCATI — questi finirebbero a DB così
 #  letto sulla card      name da salvare          dominio           valore
 1  Corriere dello S…     Corriere dello Sport     corrieredellosport.it   10x
 2  Apple Store Onli…     Apple Store Online       apple.com                4x
 3  Lounge by Zala…       Lounge by Zalando ?      zalando.it               2x
 4  The British Cou…      The British Council ?    britishcouncil.org       6x

CONFLITTI — stesso negozio, valori diversi
 5  dott 10x (viola)  vs  Dott 2x (grigio)     → quale tengo?

Correggi con: "2 = Apple Store", "3 dominio zalando.it", "4 scarta", "5 tieni 10x".
Rispondi "ok" per accettare tutto come sopra.
```

Regole:

- il `?` marca le proposte su cui non sei sicuro: è lì che Andrea guarda per primo;
- il **dominio** è la colonna che conta davvero, perché è ciò che aggancia il negozio al sito
  su cui sta comprando. Se non lo sai, lascia la cella vuota invece di inventare;
- se una card resta ambigua dopo la risposta, si scarta: meglio un negozio in meno che una
  riga sbagliata in un catalogo che consiglia la carta al checkout.

### 5. Diff e approvazione

Confrontare con lo stato del passo 1 e mostrare ad Andrea **solo ciò che cambia**:

```
NUOVI       Nike 20x · NordVPN 20x
CAMBIATI    LEGO Store 4x → 10x
SPARITI     Zalando 4x        ← erano attivi, non compaiono negli screenshot
UNIFICATI   dott 10x + Dott 2x → dott 10x
SCARTATI    3 tile illeggibili
```

I valori si mostrano come moltiplicatore: `20 per 10 €` → **`20x`**. Con molti negozi nuovi,
raggrupparli per valore invece di elencarli tutti riga per riga.

Poi **fermarsi e chiedere conferma**. Uno screenshot parziale fa sparire negozi che sono
ancora vivi: è Andrea a decidere cosa disattivare, mai la skill.

### 6. Scrittura

Solo dopo l'ok, e solo con ciò che è stato approvato:

```bash
curl -s -X POST "$SCONTI_API/revolut/ingest" \
  -H "X-Ingest-Token: $INGEST_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "captured_at": "2026-08-11",
    "upsert": [
      {"name": "Wizz Air", "badge_raw": "2 per 10 €", "boosted": false, "channel": "online"},
      {"name": "Nike",     "badge_raw": "20 per 10 €", "boosted": true,  "channel": "online"},
      {"name": "Lounge by Zalando", "badge_raw": "2 per 10 €", "boosted": false,
       "channel": "online", "domain": "zalando.it"}
    ],
    "deactivate": ["zalando"]
  }'
```

`deactivate` prende i `name_key` restituiti da `GET /offers`, non i nomi.

Il server risponde `{upserted, deactivated, skipped}`. Riportare i numeri, e se `skipped`
non è vuoto elencare i nomi: significa che il badge non è stato interpretato.

## Note

- Il server deriva da sé `name_key`, `kind` e `rate` da `name` e `badge_raw`. Non calcolarli
  qui: la regola sta in un posto solo.
- `domain` è **opzionale**: mandalo solo quando lo sai (Andrea l'ha indicato, o il nome del
  negozio non assomiglia al suo sito). Se lo ometti, un dominio già salvato resta dov'è: il
  server non lo azzera.
- `channel: "instore"` si salva ma l'estensione non lo usa. Vale la pena mandarlo comunque.
- Pillow assente in ambiente PEP 668 (installazione di sistema protetta): non insistere con
  `pip install`, usa un venv usa e getta —
  `uv venv /tmp/revolut-ingest-venv && uv pip install --python /tmp/revolut-ingest-venv/bin/python Pillow`,
  poi `/tmp/revolut-ingest-venv/bin/python split_revolut.py …`.
- Le domande ad Andrea costano molto tempo: farne **una sola**, in blocco, al passo 4, e una
  di conferma finale al passo 5. Mai una domanda per singola card.
