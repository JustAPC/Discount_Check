# Discount Check

Estensione Chrome/Edge (MV3) che ricorda gli sconti Corporate Benefits mentre fai acquisti online.
Portale: `almaviva.convenzioniaziendali.it`.

## Installazione

1. Chrome → `chrome://extensions` → attiva **Modalità sviluppatore**
2. **Carica estensione non pacchettizzata** → seleziona questa cartella
3. Apri l'estensione → **Accesso al portale** → email e password → **Salva**
4. **Aggiorna tutto** (primo crawl: ~900 offerte, qualche minuto)

Le credenziali stanno in `chrome.storage.local`, sulla macchina di chi usa l'estensione: non sono
nel repo né nel pacchetto, e ogni installazione ha le sue. Il background non le restituisce mai
alla dashboard — il campo password mostra solo se è salvata.

## Come funziona

- **Badge** sull'icona appena il dominio del sito corrente risulta convenzionato
- **Popup** solo in fase di checkout (URL tipo `/cart`, `/checkout`, `/carrello`… o bottoni "procedi al pagamento", "completa l'ordine"…)
- **Sync** automatica ogni 24h (`chrome.alarms`) di tutte e tre le fonti + **Aggiorna tutto** in
  dashboard; "Aggiorna Revolut" e "Aggiorna Klarna" da soli evitano il crawl lungo del portale
  quando serve solo l'altro catalogo
- **Login automatico**: quando la sessione del portale scade, il service worker rifà il login da solo con le credenziali salvate e riprende il crawl. Nessun intervento manuale, la sync giornaliera è autonoma. Tutto resta in `chrome.storage.local`

## Seconda fonte: Revolut

Il popup mostra anche i **moltiplicatori RevPoints** dei negozi Revolut, che si sommano alla
convenzione CB: si può usare il portale *e* pagare con Revolut.

Il catalogo Revolut non si può crawlare — sta dentro l'app. Arriva quindi da `sconti-api`,
un servizio self-hosted (vedi [server/](server/)) che l'estensione interroga una volta al
giorno.

Nessuna configurazione e nessuna credenziale: l'endpoint sta in `REVOLUT_API` in cima a
`background.js`. L'estensione legge soltanto, e quali negozi diano punti non è un dato
sensibile — l'unica chiave del sistema (`INGEST_TOKEN`) protegge la scrittura e vive solo
sul server e nella skill Hermes.

Se il server non risponde, l'ultima lista scaricata resta valida: il match continua a
funzionare offline.

## Terza fonte: Klarna

Il popup mostra anche i negozi Klarna che danno **cashback**, presi da
`klarna.com/it/store`. La pagina è alimentata da un'API JSON pubblica e senza chiave, quindi
la chiama direttamente il service worker: nessun crawl, nessun server, tre richieste in tutto
(l'API si ferma a 100 record per pagina). Endpoint in `KLARNA_API` in cima a `background.js`.

Si tengono **solo** i negozi con `cashbackDiscount` — oggi 282 su ~1700. Il dominio vero si
legge dal parametro `merchantUrl` dentro `otcUrl`: `storeUrl` è uno slug di klarna.com, non
del negozio. Il tasso arriva in centesimi di punto (`150` = 1,5%).

Il cashback Klarna **non scatta pagando sul sito**: si sblocca comprando dentro la Klarna app.
Perciò la riga nel popup è un promemoria senza bottone, e il chip dice "fino a X%" quando
Klarna dichiara un tetto (`showUpToPrefix`), che è quasi sempre.

Come per Revolut, una risposta vuota o un errore non svuotano la cache: l'ultima lista buona
resta valida.

### Matching a 3 livelli
1. **Alias manuale** (dashboard → "collega a un sito") — vince sempre
2. **Dominio** estratto dal link uscente dell'offerta
3. **Nome brand** normalizzato vs dominio corrente — l'unico che copre gift card e portali dedicati

Tarato per **preferire i falsi positivi**. Quando sbaglia: "Non c'entra nulla" nel popup, oppure la sezione **Segnalazioni di errore** in dashboard (reversibile).

### Login fallito
Se il re-login automatico non riesce (credenziali mai inserite, o password cambiata) la dashboard lo
dice esplicitamente, con una scorciatoia al campo, e il popup al checkout esce **comunque**, con
l'avviso "Sessione scaduta". Il catalogo salvato resta valido per il match. Se il catalogo non è mai stato scaricato, al checkout appare un avviso generico max 1 volta al giorno.

## Distribuzione

Niente Chrome Web Store: ogni push su `main` fa girare [release.yml](.github/workflows/release.yml),
che impacchetta `discount-check.zip` (solo i file che Chrome carica) e lo pubblica su GitHub
Releases con tag `v<version del manifest>`.

Il tag **è** la version di `manifest.json`. Se non la bumpi, la release esistente viene riscritta
in silenzio e nessuno viene avvisato: bumpare `manifest.json` è il gesto che dice "questa vale la
pena scaricarla".

L'estensione controlla una volta al giorno l'ultima release su GitHub. Se è più recente di quella
installata: riga cliccabile in cima alla dashboard e **`!` rosso sul badge** dell'icona. Il badge
del conteggio offerte ha però la precedenza sui siti convenzionati — lì il `!` non compare, perché
sapere che c'è uno sconto vale più che sapere che c'è un aggiornamento.

Aggiornare resta manuale: scarica lo zip, scompatta sopra la cartella, `chrome://extensions` →
**Aggiorna**. Le credenziali e i cataloghi stanno in `chrome.storage.local` e sopravvivono.

## Struttura

| File | Ruolo |
|---|---|
| `background.js` | crawl del portale, parsing, indici, matching, badge |
| `content.js` | rilevamento checkout + overlay (Shadow DOM) |
| `dashboard.html/js` | stato sync, ricerca catalogo, alias, segnalazioni, mute |
| `test.js` | test delle funzioni di parsing e matching (`node test.js`) |
| `server/` | `sconti-api`: il servizio che tiene il catalogo Revolut (Docker su TrueNAS) |
| `hermes-skill/` | skill Hermes che legge gli screenshot Revolut e riempie il catalogo |

## Note tecniche (le cose che non sono ovvie)

- Il portale è **server-rendered senza API JSON**: si parsa l'HTML.
- Gli URL nei `data-href` sono **HTML-encoded** (`https&#x3A;&#x2F;&#x2F;…`). Il service worker MV3 **non ha `DOMParser`**, quindi serve il decoder manuale in `dec()`. Senza, il crawl perde ~50% delle offerte.
- La classe `cbg3-discount-and-location--uppercase` contiene **sia lo sconto sia la distanza in KM**: si tiene il valore con `%`.
- Il link firmato `/generic-link?link=…&sig=…` ha token a scadenza: si salva **solo il dominio**, mai il link.
- Il crawl è **ripartibile**: il service worker MV3 può essere terminato a metà, l'alarm `resume` (1 min) riprende la coda.
- ~50% delle offerte punta al dominio del brand, ~20% a portali convenzione dedicati (`convenzionipiaggio.com`, `iltuoticket.it`), ~10% al gift card shop `it.vouchers-at-work.com`, il resto sono negozi fisici senza link.
- L'API Klarna **non è documentata**: è quella del sito. Se cambia forma, `klSync` va in errore e la lista in cache resta quella dell'ultima volta — le altre due fonti non se ne accorgono.
- Klarna elenca lo stesso brand più volte con tassi diversi (`G-Star Raw` 4% e `G Star RAW` 2%): a parità di chiave si tiene il tasso migliore.

## Limiti noti

- Per le convenzioni con tracking, aprire il portale **al checkout è tardi**: il tracking andrebbe fatto prima. Il popup lo segnala, ma il carrello potrebbe non sopravvivere al passaggio dal portale.
- Le offerte dietro affiliate network (`tradetracker` ecc.) sono matchate solo per nome.
- Il rilevamento checkout è euristico: su e-commerce molto custom può non scattare.
- Il cashback Klarna richiede di **rifare l'acquisto dentro la Klarna app**: al checkout è un'informazione, non un'azione. Ed è quasi sempre un "fino a", non un tasso garantito.
- Il catalogo Klarna è solo **italiano** (`/it/` e `IT` nell'endpoint): su store esteri non matcha.
