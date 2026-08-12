---
name: revolut-ingest
description: Estrae i negozi e i moltiplicatori RevPoints dagli screenshot dell'app Revolut e li salva su sconti-api. Usare quando Andrea allega screenshot dell'app Revolut o scrive "ingest revolut".
---

# revolut-ingest

Trasforma screenshot dell'app Revolut nella lista di negozi con moltiplicatore che
l'estensione Discount Check mostra al checkout.

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

### 3-bis. Controllo dei valori letti

Il badge è la parte che si sbaglia più facilmente: due cifre piccole su uno sfondo colorato.
Due controlli, entrambi a costo zero, prima di portare qualcosa al passo 4.

**Tassi mai visti.** Confronta i valori letti con quelli già presenti nella risposta del
passo 1. Revolut usa un insieme discreto e ricorrente di tassi (tipicamente 2, 3, 4, 5, 6, 7,
8, 10, 11, 12, 13, 14, 15, 20). Un valore che **non compare in nessuna offerta esistente** è
quasi sempre una lettura sbagliata: rileggi quella striscia prima di proporlo, e se dopo la
rilettura resta, portalo al passo 4 come voce da confermare, mai scriverlo in silenzio.

**Salti grossi.** Un negozio già a catalogo che passa da `4x` a `9x` è più probabilmente un
errore di lettura che un cambio di offerta. Va in `CAMBIATI` con il valore vecchio accanto,
così la differenza si vede.

Se una striscia produce un valore dubbio, rileggerla **da sola** costa una chiamata: falla,
invece di tirare a indovinare.

### 4. La scheda di revisione

Una risposta sola, con **due tabelle a larghezza fissa**. Andrea le copia, le marca in un
editor e le rimanda indietro: e' l'unico momento in cui decide, quindi deve poterlo fare riga
per riga invece che con un "ok" globale.

Vale una regola sopra tutte:

> **Mai chiedere una conferma senza mostrare il valore esatto che finirebbe nel database.**
> "Confermi i completamenti piu' plausibili?" e' una domanda inutile: Andrea non puo'
> rispondere se non vede cosa stai per scrivere.

#### Chi finisce nella prima tabella

Un negozio si propone per la disattivazione **solo se e' assente da due letture di fila**.
La discriminante e' `last_seen` confrontato con la data dell'ultimo ingest, che e' il
`updated_at` restituito dal passo 1:

| Situazione | Significato | Cosa fare |
|---|---|---|
| compare, con qualunque tasso | vivo, magari cambiato | va in **tabella 2**, mai disattivato |
| non compare, ma `last_seen` == ultimo ingest | c'era l'ultima volta: **probabilmente non l'hai letto** | una riga di nota, **non proporlo** |
| non compare, e `last_seen` < ultimo ingest | assente due volte: **sparito** | va in **tabella 1** |

Un cambio di tasso non e' mai una sparizione, e una singola lettura andata male non puo'
togliere niente dal catalogo.

#### Come si presenta

```
DISATTIVAZIONI — non ne avviene nessuna se non la marchi tu
scrivi  [x]  per disattivare, lascia  [ ]  per lasciare attivo

     negozio                      aveva   assente da   dominio curato
     -------------------------------------------------------------------
[ ]  Corsica Ferries              5x      2 letture    corsicaferries.it
[ ]  Busch Gardens                4x      3 letture    —

non lette stavolta, ma c'erano all'ingest precedente — non tocco niente:
Booking, Dolce & Gabbana, Stanley 1913


DA SCRIVERE — si applicano tutte, tranne quelle che salti
scrivi  [-]  per saltare la riga; il dominio mettilo nell'ultima colonna

     negozio                      valore  cosa cambia   dominio
     -------------------------------------------------------------------
[ ]  Nike                         20x     nuovo         .
[ ]  Corriere dello Sport         10x     nuovo         .
[ ]  LEGO Store                   10x     era 4x        .
[ ]  Apple Store Onli…            4x      nome troncato .
```

Regole di composizione:

- **larghezza fissa con spazi**, mai pipe di markdown: Andrea la edita in un editor qualunque
  e la reincolla in chat, dove le colonne allineate restano leggibili e le pipe no;
- il marcatore sta **all'inizio della riga**, che e' il punto piu' facile da raggiungere;
- il punto `.` nella colonna dominio e' un segnaposto da sovrascrivere: una cella vuota non
  si vede;
- un nome troncato dall'app (`Apple Store Onli…`) si porta cosi' com'e' letto, con
  `nome troncato` nella colonna "cosa cambia": e' Andrea a completarlo scrivendolo di fianco;
- **stesso negozio con tassi diversi** (es. `dott` 10x viola e `Dott` 2x grigio): una riga
  sola con `conflitto: 10x o 2x?` nella colonna "cosa cambia". Non decidere mai da solo — un
  duplicato puo' anche voler dire che si e' letto male un nome, e nasconderlo con una regola
  automatica nasconde un errore;
- se una tabella e' vuota, scrivere `nessuna` invece di omettere la sezione: "non ci sono
  disattivazioni" e "me ne sono dimenticato" non devono avere lo stesso aspetto.

### 5. Interpretare la risposta

Andrea rimanda indietro la scheda, marcata come gli e' comodo. **Interpreta cosa intende, non
pretendere la sintassi**: puo' scrivere `x`, `si`, `disattiva`, puo' correggere un nome
scrivendolo di fianco, puo' aggiungere una nota a parole. La sintassi proposta e' un aiuto,
non un contratto.

I default sono asimmetrici, ed e' voluto:

- **una riga non marcata in tabella 1 non disattiva niente.** Aggiungere un negozio sbagliato
  si vede e si disfa; spegnerne uno vivo e' silenzioso, e ce ne si accorge settimane dopo;
- **una riga non marcata in tabella 2 si scrive.** E' il caso normale e non ha senso chiedere
  trenta conferme per trenta negozi nuovi.

Se una riga resta **ambigua** dopo la risposta — non si capisce se il segno vuol dire una cosa
o l'altra — non indovinare: saltala, e dillo fra i risultati. Su un'azione distruttiva
l'incertezza non si risolve tirando a indovinare.

Non serve una seconda conferma: scrivi, e poi riporta esattamente cosa hai scritto.

### 6. Scrittura

Solo dopo la scheda rimandata indietro, e solo con ciò che ne risulta. In particolare
`deactivate` contiene **soltanto le righe marcate a mano**: se Andrea non ha marcato niente,
`deactivate` è un array vuoto, non l'elenco degli assenti.

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

Il server risponde `{upserted, deactivated, skipped}`. Il resoconto ad Andrea non sono i
numeri del server ma **cosa è successo a ciò che aveva marcato**, in quattro righe:

```
scritti        Nike 20x, Corriere dello Sport 10x, LEGO Store 4x → 10x
domini         corrieredellosport.it su Corriere dello Sport
disattivati    Corsica Ferries
saltati        Apple Store Onli… (nome ambiguo, non ho capito la correzione)
```

`skipped` dal server è un caso a parte e va sempre elencato per nome: vuol dire che il badge
non è stato interpretato, cioè che quel negozio **non è stato scritto** pur essendo stato
approvato.

## Correggere un dominio

Il dominio è ciò che aggancia il negozio al sito su cui Andrea sta comprando, ed è l'unico
campo che non si legge da uno screenshot: si decide guardando dove si compra davvero. Quando
è giusto, l'estensione smette di indovinare per nome su quel negozio — ed è così che si
evitano scambi come "Qatar Airways" mostrato su `ita-airways.com`.

Si scrive da solo, senza toccare tassi né badge:

```bash
curl -s -X POST "$SCONTI_API/revolut/domains" \
  -H "X-Ingest-Token: $INGEST_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "itaairways": "ita-airways.com",
    "qatarairways": "https://www.qatarairways.com/it-it/homepage"
  }'
```

- la chiave può essere il `name_key` o il nome visibile del negozio: il server normalizza;
- il valore può essere un dominio nudo o un URL intero incollato dalla barra: il server tiene
  solo l'host e toglie `www.`;
- valore vuoto o `null` **cancella** il dominio, per disfare una scrittura sbagliata;
- risponde `{set, unset, unknown}`. **`unknown` va sempre riportato ad Andrea**: sono chiavi
  che non corrispondono a nessun negozio, quasi sempre un nome scritto a mano, e in silenzio
  sembrerebbe che l'operazione sia riuscita.

La modifica arriva a tutte le estensioni entro 24 ore da sola, o subito se Andrea preme
**Aggiorna tutto** o **Aggiorna Revolut**. Non serve pubblicare niente.

## Note

- Il server deriva da sé `name_key`, `kind` e `rate` da `name` e `badge_raw`. Non calcolarli
  qui: la regola sta in un posto solo.
- `domain` è **opzionale** e l'ingest può solo riempirlo dove è vuoto: un dominio già
  salvato vince sempre, che tu lo ometta o che ne mandi uno diverso. Mandalo quando lo sai
  e il negozio non ce l'ha ancora; per **correggerne** uno sbagliato serve l'endpoint
  dedicato qui sotto, che è esplicito per costruzione.
- `channel: "instore"` si salva ma l'estensione non lo usa. Vale la pena mandarlo comunque.
- Pillow assente in ambiente PEP 668 (installazione di sistema protetta): non insistere con
  `pip install`, usa un venv usa e getta —
  `uv venv /tmp/revolut-ingest-venv && uv pip install --python /tmp/revolut-ingest-venv/bin/python Pillow`,
  poi `/tmp/revolut-ingest-venv/bin/python split_revolut.py …`.
- Le domande ad Andrea costano molto tempo: la scheda del passo 4 è **l'unica**. Mai una
  domanda per singola card, e nessuna conferma finale: i default sono asimmetrici apposta
  perché scrivere senza richiedere sia sicuro.
- Un negozio che non compare negli screenshot **non è una sparizione finché non manca due
  volte di fila**. È la regola che ha fatto perdere Booking quando non c'era: era assente per
  la prima volta e fu disattivato lo stesso.
- **Non abbassare il reasoning effort per andare più veloce.** Con effort basso i badge
  vengono letti male in modo silenzioso: nel run del 12/08/2026 sono comparsi valori `9x`
  inesistenti (Samsung letto 9x invece di 4x, Ralph Lauren 9x invece di 5x) che a effort alto
  non si erano presentati. Qui un errore non si vede: entra a catalogo e ci resta.
- Il tempo di questo lavoro sta nelle chiamate vision, una per striscia — non nel modello.
  Se serve accorciarlo, raggruppa più strisce per chiamata invece di sacrificare l'accuratezza.
