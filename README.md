# Discount Check

Estensione Chrome/Edge (MV3) che ti ricorda gli sconti a cui hai già diritto **mentre stai per
pagare**, invece di fartene accorgere il giorno dopo.

Tre fonti in una sola riga al checkout:

- **Corporate Benefits** — le convenzioni aziendali del portale `almaviva.convenzioniaziendali.it`
- **Revolut** — i moltiplicatori RevPoints, che si sommano alla convenzione
- **Klarna** — i negozi con cashback (da riscattare dentro la Klarna app)

---

## Installazione

Serve una volta sola, cinque minuti.

**1. Scarica il pacchetto**

Vai alla [release più recente](https://github.com/JustAPC/Discount_Check/releases/latest) e scarica
`discount-check.zip`.

**2. Scompattalo in una cartella che non sposterai**

Chrome carica l'estensione **da quella cartella**, non ne fa una copia: se la sposti o la cancelli
l'estensione smette di funzionare. Una `Documenti/discount-check` va benissimo, la cartella
Download no.

**3. Caricala in Chrome**

1. apri `chrome://extensions`
2. attiva **Modalità sviluppatore** (in alto a destra)
3. **Carica estensione non pacchettizzata** → seleziona la cartella del punto 2

**4. Inserisci le credenziali del portale**

Clicca l'icona dell'estensione → **Apri dashboard** → sezione **Accesso al portale** → email e
password del portale Corporate Benefits → **Salva**.

Sono le stesse con cui accedi al sito. Restano in `chrome.storage.local`, su questo computer: non
sono nel repo né nel pacchetto, e ogni installazione ha le sue. La dashboard non le rilegge mai — il
campo password ti dice solo se è salvata.

**5. Primo aggiornamento**

Premi **Aggiorna tutto**. Il primo crawl del portale scarica ~900 offerte e dura qualche minuto:
puoi chiudere la dashboard, va avanti da solo. Revolut e Klarna sono immediati.

Da qui in poi non devi fare più nulla: l'aggiornamento è automatico ogni 24 ore.

---

## Aggiornare l'estensione senza perdere i dati

Quando esce una versione nuova la dashboard te lo dice in cima, con un **`!` rosso** sull'icona.

1. scarica il nuovo `discount-check.zip`
2. scompattalo **sopra la cartella esistente**, sostituendo i file
3. `chrome://extensions` → **Aggiorna** (l'icona di ricarica sulla scheda dell'estensione)

> ⚠️ **Non usare "Rimuovi" e poi "Carica estensione non pacchettizzata".** Quando rimuovi
> un'estensione Chrome cancella anche il suo `chrome.storage.local`: perdi credenziali, catalogo,
> alias e segnalazioni, e devi rifare tutto da capo. Sostituire i file + **Aggiorna** lascia tutto
> al suo posto.

---

## Come si usa

Non si usa: si fa vedere lei.

- **Badge sull'icona** appena apri un sito convenzionato — sai subito che c'è qualcosa da guardare
- **Popup al checkout** (URL tipo `/cart`, `/checkout`, `/carrello`, o bottoni "procedi al
  pagamento", "completa l'ordine"), con le convenzioni che valgono per quel sito
- **Dashboard** per cercare nel catalogo, collegare a mano un'offerta a un sito, silenziare i siti
  che non ti interessano e correggere gli abbinamenti sbagliati

I bottoni **Aggiorna Revolut** e **Aggiorna Klarna** aggiornano solo quella fonte, senza aspettare
il crawl lungo del portale. **Aggiorna tutto** le muove tutte e tre.

---

## Se qualcosa non va

**Il catalogo Corporate Benefits resta a 0 anche se la sync dice di aver letto centinaia di offerte**

Al primo accesso di ogni sessione il portale mostra il popup **"Riservatezza sulle convenzioni!"** e
finché non lo confermi risponde con la home al posto di ogni scheda offerta: il crawl gira a vuoto.
L'estensione lo riconosce e lo conferma da sola. Se la dashboard ti mostra comunque **"Conferma
richiesta dal portale"**, apri il portale, premi **Conferma** sul popup e rilancia **Aggiorna tutto**.

**"Credenziali mancanti" o "Login al portale fallito"**

Le prime volte capita dopo un cambio password sul portale: riapri **Accesso al portale** e
risalvale. Il catalogo già scaricato resta valido nel frattempo, e il popup al checkout continua ad
uscire con l'avviso "Sessione scaduta".

**Le sezioni Revolut o Klarna sono vuote**

Premi il bottone della singola fonte. Se resta vuota, la dashboard mostra l'errore dell'ultimo
tentativo sotto il titolo della sezione: Revolut dipende da `sconti-api` (self-hosted), Klarna
dall'API pubblica di `klarna.com`. In entrambi i casi l'ultima lista buona resta in cache e il match
continua a funzionare.

**Il popup non esce su un sito che so essere convenzionato**

Il rilevamento del checkout è euristico e su e-commerce molto custom può non scattare. Se invece è
il match a mancare, apri la dashboard, cerca l'offerta e usa **"collega a un sito"**: l'alias
manuale vince su tutto.

**Il popup esce dove non c'entra nulla**

È voluto: il matching preferisce i falsi positivi ai silenzi. Usa **"Non c'entra nulla"** nel popup,
oppure la sezione **Segnalazioni di errore** in dashboard. È sempre reversibile.

---

## Come funziona dentro

- **Sync** automatica ogni 24h (`chrome.alarms`) di tutte e tre le fonti; all'installazione partono
  subito tutte e tre, senza aspettare il primo alarm
- **Login automatico**: quando la sessione del portale scade, il service worker rifà il login da
  solo con le credenziali salvate e riprende il crawl
- **Gate riservatezza**: il popup del portale viene confermato via `POST /` con
  `disclaimerAccept=1`. Il form non ha CSRF token. Senza questo passaggio il portale serve la home
  al posto di ogni scheda e il catalogo finisce vuoto
- **Crawl ripartibile**: il service worker MV3 può essere terminato a metà, l'alarm `resume` (1 min)
  riprende la coda

### Seconda fonte: Revolut

Il catalogo Revolut non si può crawlare — sta dentro l'app. Arriva quindi da `sconti-api`, un
servizio self-hosted (vedi [server/](server/)) che l'estensione interroga una volta al giorno.

Nessuna configurazione e nessuna credenziale: l'endpoint sta in `REVOLUT_API` in cima a
`background.js`. L'estensione legge soltanto, e quali negozi diano punti non è un dato sensibile —
l'unica chiave del sistema (`INGEST_TOKEN`) protegge la scrittura e vive solo sul server e nella
skill Hermes.

Se il server non risponde, l'ultima lista scaricata resta valida: il match continua a funzionare
offline.

### Terza fonte: Klarna

I negozi con cashback arrivano da `klarna.com/it/store`. La pagina è alimentata da un'API JSON
pubblica e senza chiave, quindi la chiama direttamente il service worker: nessun crawl, nessun
server, tre richieste in tutto (l'API si ferma a 100 record per pagina). Endpoint in `KLARNA_API`.

Si tengono **solo** i negozi con `cashbackDiscount` — oggi 282 su ~1700. Il dominio vero si legge
dal parametro `merchantUrl` dentro `otcUrl`: `storeUrl` è uno slug di klarna.com, non del negozio.
Il tasso arriva in centesimi di punto (`150` = 1,5%).

Il cashback Klarna **non scatta pagando sul sito**: si sblocca comprando dentro la Klarna app.
Perciò la riga nel popup è un promemoria senza bottone, e il chip dice "fino a X%" quando Klarna
dichiara un tetto (`showUpToPrefix`), che è quasi sempre.

### Matching a 3 livelli

1. **Alias manuale** (dashboard → "collega a un sito") — vince sempre
2. **Dominio** estratto dal link uscente dell'offerta
3. **Nome brand** normalizzato vs dominio corrente — l'unico che copre gift card e portali dedicati

Tarato per **preferire i falsi positivi**: un promemoria di troppo si chiude, uno sconto perso no.

---

## Distribuzione

Niente Chrome Web Store: ogni push su `main` fa girare [release.yml](.github/workflows/release.yml),
che impacchetta `discount-check.zip` (solo i file che Chrome carica) e lo pubblica su GitHub
Releases con tag `v<version del manifest>`.

Il tag **è** la version di `manifest.json`. Se non la bumpi, la release esistente viene riscritta
in silenzio e nessuno viene avvisato: bumpare `manifest.json` è il gesto che dice "questa vale la
pena scaricarla".

L'estensione controlla una volta al giorno la `version` nel manifest servito da GitHub Pages
(`justapc.github.io/Discount_Check/manifest.json`) — non l'API di GitHub, che ha 60 richieste/ora
per IP e risponde 403 quando le esaurisci con altro. Se è più recente di quella installata: riga
cliccabile in cima alla dashboard e **`!` rosso sul badge** dell'icona. Il badge del conteggio
offerte ha però la precedenza sui siti convenzionati — lì il `!` non compare, perché sapere che c'è
uno sconto vale più che sapere che c'è un aggiornamento.

## Struttura

| File                | Ruolo                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| `background.js`     | crawl del portale, parsing, indici, matching, badge                         |
| `content.js`        | rilevamento checkout + overlay (Shadow DOM)                                 |
| `dashboard.html/js` | stato sync, ricerca catalogo, alias, segnalazioni, mute                     |
| `test.js`           | test delle funzioni di parsing e matching (`node test.js`)                  |
| `server/`           | `sconti-api`: il servizio che tiene il catalogo Revolut (Docker su TrueNAS) |
| `hermes-skill/`     | skill Hermes che legge gli screenshot Revolut e riempie il catalogo         |

## Note tecniche (le cose che non sono ovvie)

- Il portale è **server-rendered senza API JSON**: si parsa l'HTML.
- Gli URL nei `data-href` sono **HTML-encoded** (`https&#x3A;&#x2F;&#x2F;…`). Il service worker MV3 **non ha `DOMParser`**, quindi serve il decoder manuale in `dec()`. Senza, il crawl perde ~50% delle offerte.
- Il gate riservatezza risponde `200` e con `/logout` dentro: sembra una pagina valida, quindi non basta il controllo di sessione per accorgersene. La sentinella sul titolo della home è ciò che evita di riempire il catalogo di righe tutte uguali.
- La classe `cbg3-discount-and-location--uppercase` contiene **sia lo sconto sia la distanza in KM**: si tiene il valore con `%`.
- Il link firmato `/generic-link?link=…&sig=…` ha token a scadenza: si salva **solo il dominio**, mai il link.
- ~50% delle offerte punta al dominio del brand, ~20% a portali convenzione dedicati (`convenzionipiaggio.com`, `iltuoticket.it`), ~10% al gift card shop `it.vouchers-at-work.com`, il resto sono negozi fisici senza link.
- L'API Klarna **non è documentata**: è quella del sito. Se cambia forma, `klSync` va in errore e la lista in cache resta quella dell'ultima volta — le altre due fonti non se ne accorgono.
- Klarna elenca lo stesso brand più volte con tassi diversi (`G-Star Raw` 4% e `G Star RAW` 2%): a parità di chiave si tiene il tasso migliore.

## Limiti noti

- Per le convenzioni con tracking, aprire il portale **al checkout è tardi**: il tracking andrebbe fatto prima. Il popup lo segnala, ma il carrello potrebbe non sopravvivere al passaggio dal portale.
- Le offerte dietro affiliate network (`tradetracker` ecc.) sono matchate solo per nome.
- Il rilevamento checkout è euristico: su e-commerce molto custom può non scattare.
- Il cashback Klarna richiede di **rifare l'acquisto dentro la Klarna app**: al checkout è un'informazione, non un'azione. Ed è quasi sempre un "fino a", non un tasso garantito.
- Il catalogo Klarna è solo **italiano** (`/it/` e `IT` nell'endpoint): su store esteri non matcha.
