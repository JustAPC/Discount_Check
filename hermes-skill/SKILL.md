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
RUN_DIR=$(mktemp -d)
python split_revolut.py <screenshot> "$RUN_DIR"
```

Lo script ricava l'altezza dei crop dalle bande di stitching. Se non trova un ritmo regolare,
la ricava dalla larghezza dell'immagine. I crop si sovrappongono e coprono sempre l'intera
altezza. Non assumere una risoluzione o un'altezza fissa.

Per ogni screenshot produce un `<nome>_manifest.json` con dimensioni, strategia, coordinate e
lista esatta dei crop. Analizza solo i file elencati nei manifest. Se un crop contiene troppe
card, oppure nome e badge non sono leggibili insieme, scegli un'altezza più piccola e ripeti:

```bash
python split_revolut.py <screenshot> "$RUN_DIR" --target-height <altezza_scelta>
```

Scegli il nuovo valore guardando il crop problematico, non copiandolo da run precedenti. Lo
split è concluso quando ogni manifest riporta `uncovered_pixels: 0` e tutti i crop sono
leggibili o possono essere classificati come parziali al passo 3.

### 3. Lettura

Guardare **un crop alla volta**, nell'ordine dei manifest. Dopo ogni chiamata vision, appendere
subito una riga JSON a `$RUN_DIR/reads.jsonl`; non affidare l'elenco alla memoria della chat:

```json
{"crop":"/percorso/crop.png","first":"Primo nome","last":"Ultimo nome","cards":[{"name":"Wizz Air","channel":"online","badge_raw":"2 per 1 €","boosted":false}],"discarded":0}
```

`crop` deve essere il percorso esatto del manifest. `first` e `last` sono le prime e ultime
card anche quando sono parziali: servono a controllare la continuità fra crop sovrapposti. Per
ogni card leggere:

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
- Lo stesso negozio può comparire in più crop o più immagini: prima si conserva ogni occorrenza
  in `reads.jsonl`, poi si deduplica. Il numero di occorrenze non deve perdersi.
- **Stesso negozio con tassi diversi** (es. `dott` 10x viola e `Dott` 2x grigio): **non
  decidere da solo, mai.** Va portato al passo 4 come conflitto, mostrando entrambi i valori:
  decide Andrea quale tenere. Un duplicato può anche voler dire che si è letto male un nome,
  quindi nasconderlo con una regola automatica nasconde un errore.
- Ogni negozio letto va tenuto, anche quando è **identico** a com'è già a catalogo: non
  comparirà in nessuna tabella, ma deve finire nell'upsert del passo 6.

Prima di deduplicare, confrontare via codice i percorsi `crop` di `reads.jsonl` con quelli di
tutti i manifest. Devono coincidere esattamente, senza mancanti o duplicati. Se non coincidono,
leggere i crop mancanti e rifare il controllo. Non costruire il diff finché questo criterio non
è soddisfatto.

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

**Seconda lettura obbligatoria.** Riapri il crop di origine per ogni negozio nuovo e per ogni
record con nome, badge, tasso, colore o canale diverso dal catalogo. Conferma il valore anche
quando la differenza è piccola. Se le due letture non coincidono, porta il conflitto al passo 4
già segnato `[-]`.

Prima di compilare la tabella 2, fai un ultimo passaggio vision su tutti i crop con la lista dei
nomi che risulterebbero assenti. Lo scopo di questo passaggio è cercare soltanto quei nomi. Ogni
nome ritrovato torna nell'elenco letto e viene rimosso dalle assenze.

Se un nome nuovo è molto simile a un nome assente, per esempio `Be Your Bag` e `Be You Bag`,
non creare due decisioni indipendenti. Mostrali come possibile rinomina, segnati `[-]`, e lascia
la scelta ad Andrea.

### 4. La scheda di revisione

Una risposta sola, con **tre tabelle a larghezza fissa**, una per tipo di azione: chi entra,
chi si spegne, chi cambia. Andrea le copia, le marca in un editor e le rimanda indietro: e'
l'unico momento in cui decide, quindi deve poterlo fare riga per riga invece che con un "ok"
globale.

Vale una regola sopra tutte:

> **Mai chiedere una conferma senza mostrare il valore esatto che finirebbe nel database.**
> "Confermi i completamenti piu' plausibili?" e' una domanda inutile: Andrea non puo'
> rispondere se non vede cosa stai per scrivere.

Prima delle tabelle mostra: immagini ricevute; crop generati e crop analizzati; occorrenze di
card prima della deduplica e negozi unici dopo; card scartate; negozi a catalogo e data
dell'ultima lettura (`updated_at` dal passo 1); cosa succede se Andrea non tocca niente. I crop
generati e analizzati devono avere lo stesso numero.

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
- Il modello decide la dimensione dei crop in base a ciò che riesce a leggere. Per ridurre le
  chiamate può aumentare `--target-height`, ma deve ripetere i crop in cui nome e badge non sono
  leggibili insieme. Il controllo manifest contro `reads.jsonl` resta obbligatorio.
