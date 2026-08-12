# CB Reminder

Estensione Chrome/Edge (MV3) che ricorda gli sconti Corporate Benefits mentre fai acquisti online.
Portale: `almaviva.convenzioniaziendali.it`.

## Installazione

1. Chrome → `chrome://extensions` → attiva **Modalità sviluppatore**
2. **Carica estensione non pacchettizzata** → seleziona questa cartella
3. Fai login sul portale in una tab
4. Apri l'estensione → **Aggiorna tutto** (primo crawl: ~900 offerte, qualche minuto)

## Come funziona

- **Badge** sull'icona appena il dominio del sito corrente risulta convenzionato
- **Popup** solo in fase di checkout (URL tipo `/cart`, `/checkout`, `/carrello`… o bottoni "procedi al pagamento", "completa l'ordine"…)
- **Sync** automatica ogni 24h (`chrome.alarms`) di entrambe le fonti + **Aggiorna tutto** in
  dashboard; "Aggiorna Revolut" da solo evita il crawl lungo del portale quando serve solo il
  catalogo punti
- Per Corporate Benefits nessuna credenziale salvata: il crawl riusa la sessione già attiva nel browser, tutto resta in `chrome.storage.local`

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

### Matching a 3 livelli
1. **Alias manuale** (dashboard → "collega a un sito") — vince sempre
2. **Dominio** estratto dal link uscente dell'offerta
3. **Nome brand** normalizzato vs dominio corrente — l'unico che copre gift card e portali dedicati

Tarato per **preferire i falsi positivi**. Quando sbaglia: "Non c'entra nulla" nel popup, oppure la sezione **Segnalazioni di errore** in dashboard (reversibile).

### Login scaduto
Il popup al checkout esce **comunque**, con l'avviso "Sessione scaduta". Il catalogo salvato resta valido per il match. Se il catalogo non è mai stato scaricato, al checkout appare un avviso generico max 1 volta al giorno.

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

## Limiti noti

- Per le convenzioni con tracking, aprire il portale **al checkout è tardi**: il tracking andrebbe fatto prima. Il popup lo segnala, ma il carrello potrebbe non sopravvivere al passaggio dal portale.
- Le offerte dietro affiliate network (`tradetracker` ecc.) sono matchate solo per nome.
- Il rilevamento checkout è euristico: su e-commerce molto custom può non scattare.
