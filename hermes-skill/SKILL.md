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
   legge: **non si scarta**, va in tabella 1 già segnato `[-]`, con accanto il negozio a
   catalogo a cui somiglia. La troncatura è nella UI di Revolut, non nel ritaglio: riguardare
   l'immagine non la risolve.
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
- Ogni negozio letto va tenuto, anche quando è **identico** a com'è già a catalogo: non
  comparirà in nessuna tabella, ma deve finire nell'upsert del passo 6.

### 3-bis. Controllo dei valori letti

Il badge è la parte che si sbaglia più facilmente: due cifre piccole su uno sfondo colorato.
Due controlli, entrambi a costo zero, prima di portare qualcosa al passo 4.

**Tassi mai visti.** Confronta i valori letti con quelli già presenti nella risposta del
passo 1. Revolut usa un insieme discreto e ricorrente di tassi (tipicamente 2, 3, 4, 5, 6, 7,
8, 10, 11, 12, 13, 14, 15, 20). Un valore che **non compare in nessuna offerta esistente** è
quasi sempre una lettura sbagliata: rileggi quella striscia prima di proporlo, e se dopo la
rilettura resta, portalo in tabella 3 segnato `[-]`, mai scriverlo in silenzio.

**Salti grossi.** Un negozio già a catalogo che passa da `4x` a `9x` è più probabilmente un
errore di lettura che un cambio di offerta. Va in tabella 3 con il valore vecchio accanto,
così la differenza si vede, e segnato `[-]`: se è una lettura sbagliata, non toccare niente
è la cosa giusta.

Se una striscia produce un valore dubbio, rileggerla **da sola** costa una chiamata: falla,
invece di tirare a indovinare.

### 4. La scheda di revisione

Una risposta sola, con **tre tabelle a larghezza fissa**, una per tipo di azione: chi entra,
chi si spegne, chi cambia. Andrea le copia, le marca in un editor e le rimanda indietro: e'
l'unico momento in cui decide, quindi deve poterlo fare riga per riga invece che con un "ok"
globale.

Vale una regola sopra tutte:

> **Mai chiedere una conferma senza mostrare il valore esatto che finirebbe nel database.**
> "Confermi i completamenti piu' plausibili?" e' una domanda inutile: Andrea non puo'
> rispondere se non vede cosa stai per scrivere.

Prima delle tabelle, tre righe di contesto: quanti tile letti e quanti scartati, quanti
negozi ci sono a catalogo e di quando e' l'ultima lettura (`updated_at` dal passo 1), e cosa
succede se non tocca niente.

#### Dove va ogni negozio

| Cosa hai letto | Dove va |
|---|---|
| un nome che non esiste a catalogo | **tabella 1**, nuovo |
| un nome che esiste ma e' `active = 0` | **tabella 1**, con la nota che riscriverlo lo riattiva |
| un nome che esiste, con valori diversi | **tabella 3** |
| un nome che esiste, identico | **nessuna tabella** — ma va comunque nell'upsert, vedi passo 6 |
| niente: il negozio e' a catalogo e non l'hai letto | **tabella 2** |

Un cambio di tasso non e' mai una sparizione: `20x` che diventa `10x` e' una modifica del
record, non una rimozione.

#### La tabella 2 le contiene tutte, ma non le propone tutte

Ogni negozio a catalogo che non hai letto e' una riga, **tutte a `[ ]`**: la disattivazione
non e' mai il default. A distinguerle e' la colonna "assente da", calcolata confrontando
`last_seen` con `updated_at`:

- **1 lettura** — c'era all'ingest precedente. Quasi sempre vuol dire che Andrea non ha
  scrollato fin laggiu', non che il negozio sia sparito.
- **2 letture o piu'** — assente due volte di fila. Qui una `[x]` e' probabilmente giusta.

Vanno ordinate dalla piu' assente alla meno, cosi' le candidate vere stanno in cima. Erano
una nota in prosa e sono diventate righe perche' **se e' una decisione, dev'essere una riga**:
sapere che un negozio non e' stato letto senza poterlo marcare costringe a un secondo giro.

#### Come si presenta

```
1. NUOVI — si aggiungono tutti, tranne quelli che salti
   scrivi  [-]  per saltare la riga; il dominio mettilo nell'ultima colonna

     negozio                 valore  nota                              dominio
     ------------------------------------------------------------------------------
[ ]  Mareluna Beauty         6x                                        .
[ ]  Tecnobit                3x                                        .
[ ]  Pontedoro               4x      era a catalogo, disattivato il    .
                                     02/08. Riscriverlo lo riattiva.
[-]  Orsini Sport Onli…      4x      nome troncato dall'app. Sembra    .
                                     "Orsini Sport Online", gia' a
                                     catalogo a 8x: cosi' creerebbe un
                                     doppione. Correggi il nome.


2. DA DISATTIVARE — non ne avviene nessuna se non la marchi tu
   scrivi  [x]  per disattivare, lascia  [ ]  per lasciare attivo

     negozio                 aveva   assente da   dominio curato
     -------------------------------------------------------------------
[ ]  Bellagio Viaggi         12x     3 letture    bellagioviaggi.it
[ ]  Casa Verdi              5x      2 letture    —
[ ]  NordFly                 8x      1 lettura    nordfly.com
[ ]  Fioreria Bianchi        4x      1 lettura    —


3. MODIFICHE A RECORD ESISTENTI — si applicano tutte, tranne quelle che salti
   scrivi  [-]  per saltare la riga

     negozio                 da      a       cosa cambia
     -------------------------------------------------------------------
[ ]  Verdi Farmacie          8x      4x      tasso
[-]  Cicli Ferrari           20x     ?       conflitto: letto 20x (viola)
                                             e 5x (grigio). Dimmi quale tengo.
```

Regole di composizione:

- **larghezza fissa con spazi**, mai pipe di markdown: Andrea la edita in un editor qualunque
  e la reincolla in chat, dove le colonne allineate restano leggibili e le pipe no;
- il marcatore sta **all'inizio della riga**, che e' il punto piu' facile da raggiungere;
- il punto `.` nella colonna dominio e' un segnaposto da sovrascrivere: una cella vuota non
  si vede;
- **le righe su cui hai un dubbio partono gia' a `[-]`**, con la ragione scritta di fianco.
  Il default "si scrive" vale per le righe pulite, non per quelle incerte: un nome troncato
  scritto com'e' creerebbe un doppione, ed e' esattamente il modo in cui un negozio vivo
  finisce spento e sostituito da un gemello;
- **stesso negozio con tassi diversi** (es. `dott` 10x viola e `Dott` 2x grigio): una riga
  sola in tabella 3, con `conflitto: 10x o 2x?` nella colonna "cosa cambia". Non decidere mai
  da solo — un duplicato puo' anche voler dire che si e' letto male un nome, e nasconderlo
  con una regola automatica nasconde un errore;
- se una tabella e' vuota, scrivere `nessuna` invece di omettere la sezione: "non ci sono
  disattivazioni" e "me ne sono dimenticato" non devono avere lo stesso aspetto.

### 5. Interpretare la risposta

Andrea rimanda indietro la scheda, marcata come gli e' comodo. **Interpreta cosa intende, non
pretendere la sintassi**: `[]` senza spazio, `[ x]` con lo spazio di troppo, `si`, `no`,
`disattiva`, un nome corretto scritto di fianco, una nota a parole. La sintassi proposta e'
un aiuto, non un contratto.

I default sono asimmetrici, ed e' voluto:

- **una riga non marcata in tabella 2 non disattiva niente.** Aggiungere un negozio sbagliato
  si vede e si disfa; spegnerne uno vivo e' silenzioso, e ce ne si accorge settimane dopo;
- **una riga non marcata in tabella 1 o 3 si applica.** E' il caso normale e non ha senso
  chiedere trenta conferme per trenta negozi nuovi.

**Cio' che Andrea scrive vince su un marcatore pre-impostato.** Se una riga porta `[-]` messo
da te e lui ci scrive accanto "tieni 20x", ha risposto alla domanda che la riga poneva: quel
`[-]` era una tua cautela, non una sua scelta. Applica, e dillo nel resoconto cosi' che un
fraintendimento si veda. L'ambiguita' vera esiste solo fra due cose che ha scritto lui.

Una correzione puo' **spostare una riga di tabella**: `Orsini Sport Onli…` con il nome
completato smette di essere un negozio nuovo e diventa una modifica del record esistente
(`8x → 4x`). Segui l'intenzione, non la posizione in cui la riga era stampata.

Se una riga resta **ambigua** — due indicazioni sue che si contraddicono — non indovinare:
saltala, e dillo fra i risultati. Su un'azione distruttiva l'incertezza non si risolve
tirando a indovinare.

Non serve una seconda conferma: scrivi, e poi riporta esattamente cosa hai scritto.

### 6. Scrittura

Solo dopo la scheda rimandata indietro, e solo con cio' che ne risulta.

**`upsert` contiene tutto quello che hai letto, non solo cio' che cambia.** E' la regola meno
ovvia di tutta la procedura, ed e' obbligatoria: `last_seen` si aggiorna **solo** con un
upsert, e la colonna "assente da" della tabella 2 lo confronta con `updated_at`. Un negozio
letto ma non riscritto perche' identico resterebbe con la data vecchia, e al prossimo ingest
risulterebbe assente da una lettura; a quello dopo da due, e finirebbe proposto per la
disattivazione pur essendo stato letto ogni volta. Riscrivere un record invariato non cambia
niente nei valori: serve a dire "questo l'ho visto".

**`deactivate` contiene soltanto le righe marcate a mano.** Se Andrea non ha marcato niente,
e' un array vuoto — mai l'elenco degli assenti.

```bash
curl -s -X POST "$SCONTI_API/revolut/ingest" \
  -H "X-Ingest-Token: $INGEST_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "captured_at": "2026-08-12",
    "upsert": [
      {"name": "Mareluna Beauty", "badge_raw": "6 per 10 €", "boosted": false, "channel": "online"},
      {"name": "Tecnobit", "badge_raw": "3 per 10 €", "boosted": false, "channel": "online"},
      {"name": "Orsini Sport Online", "badge_raw": "4 per 10 €", "boosted": false,
       "channel": "online", "domain": "orsinisport.it"}
    ],
    "deactivate": ["bellagioviaggi"]
  }'
```

`deactivate` prende i `name_key` restituiti da `GET /offers`, non i nomi.

Il resoconto ad Andrea non sono i numeri del server ma **cosa e' successo a cio' che aveva
marcato**, una riga per tipo di esito:

```
scritti        Mareluna Beauty 6x, Tecnobit 3x
riattivati     Pontedoro 4x
modificati     Verdi Farmacie 8x → 4x, Orsini Sport Online 8x → 4x  (nome corretto da te)
confermati     Cicli Ferrari 20x — conflitto risolto come hai detto, valore invariato
disattivati    Bellagio Viaggi
invariati      30 negozi riscritti senza modifiche, solo per segnarli come visti
domini         orsinisport.it su Orsini Sport Online
saltati        nessuno
```

Vanno sempre dette anche le righe dove hai deciso qualcosa al posto suo — un `[-]` scavalcato
da una sua istruzione, una riga spostata di tabella — perche' e' l'unico modo in cui un
fraintendimento si vede prima del prossimo ingest.

`skipped` dal server e' un caso a parte e va elencato per nome: vuol dire che il badge non e'
stato interpretato, cioe' che quel negozio **non e' stato scritto** pur essendo stato
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
