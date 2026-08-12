# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Andrea, dipendente AlmavivA, mentre compra online sul suo browser. Un solo utente, un solo
account, nessun onboarding multiutente. Due situazioni reali e distinte:

- **In acquisto** (la maggior parte del tempo): sta per pagare su un e-commerce qualsiasi e non
  ricorda se quel negozio è convenzionato. Non ha aperto l'estensione: è l'estensione a farsi
  viva, con la card iniettata al checkout.
- **In manutenzione** (raro, deliberato): apre il popup dalla toolbar per controllare che il
  catalogo sia aggiornato, cercare un negozio prima di comprare, collegare a mano un'offerta a
  un dominio, o disfare un falso positivo che l'ha infastidito.

## Product Purpose

Ricordare, nel momento in cui serve, che su questo acquisto c'è uno sconto Corporate Benefits
e/o un moltiplicatore RevPoints Revolut. Successo = zero acquisti a prezzo pieno per
dimenticanza. Fallimento = tante notifiche che l'utente silenzia l'estensione.

## Positioning

Due fonti che **si sommano** e che nessun'altra estensione mette insieme: le convenzioni del
portale aziendale (dietro login, non indicizzabile, senza API) e i moltiplicatori RevPoints
Revolut (dati solo dentro l'app, raccolti a mano via `sconti-api`). Si può usare il portale
*e* pagare con Revolut sullo stesso acquisto.

## Operating Context

- **Chrome/Edge MV3**, caricata non pacchettizzata. Due superfici: il popup della toolbar
  (`dashboard.html`, larghezza fissa ~400px, altezza massima ~580px) e la card iniettata nella
  pagina di checkout (`content.js`, Shadow DOM, in basso a destra).
- Il crawl del portale riusa la sessione già attiva nel browser: nessuna credenziale salvata.
  Dura minuti e può interrompersi (service worker terminato), quindi lo stato "sync in corso"
  è un'informazione di prima classe nel popup.
- Catalogo Revolut da `sconti-api` self-hosted; se il server non risponde vale l'ultima lista
  scaricata.
- Tutto in `chrome.storage.local`. Nessun backend che sappia chi è l'utente.

## Capabilities and Constraints

- Vanilla HTML/CSS/JS, nessun build step, nessuna dipendenza esterna: l'estensione si carica
  da cartella. Niente CDN (CSP delle estensioni), niente font remoti.
- Il service worker MV3 non ha `DOMParser`: il portale si parsa a regex.
- Matching a 3 livelli: alias manuale > dominio del link uscente > nome brand normalizzato.
  Tarato per preferire i falsi positivi, che l'utente disfa dal popup.
- Stati che la UI deve saper mostrare, tutti reali e frequenti: sync in corso con progresso,
  sessione portale scaduta (`login`), sync fallita, catalogo mai scaricato, catalogo presente
  ma vecchio, catalogo Revolut in cache con server irraggiungibile.
- Il popup è la sola superficie da cui si disfa qualcosa (unblock, unmute, alias): è il pannello
  di controllo, non una vetrina.

## Brand Commitments

- Nome: **Discount Check**. Interfaccia e copy in italiano, tono asciutto e concreto.
- Codice colore già in uso e da preservare perché è semantica, non decorazione:
  **verde = Corporate Benefits**, **viola = Revolut**. Le due fonti non vanno mai confuse,
  perché si usano in modo diverso (una richiede di passare dal portale, l'altra di pagare
  con una carta specifica).

## Evidence on Hand

- Catalogo reale del portale AlmavivA: ~900 offerte a crawl completo (~50% con dominio del
  brand, ~10% gift card su `it.vouchers-at-work.com`, il resto negozi fisici senza link).
- Catalogo Revolut reale servito da `sconti-api` (`/revolut/offers`), con nome negozio,
  dominio, tasso punti e flag "potenziato".
- Nessun dato di utilizzo, nessuna metrica, nessun altro utente: non inventare numeri di
  risparmio, statistiche di utilizzo o testimonianze.

## Product Principles

1. **L'interruzione va meritata.** La card al checkout è l'unico momento in cui l'estensione
   parla senza essere interpellata; deve essere leggibile in due secondi e sempre congedabile.
2. **Le due fonti restano distinte e visibilmente sommabili.** Mai un badge generico "sconto".
3. **Ogni automatismo è disfabile dall'utente**, e il posto dove si disfa è il popup.
4. **Lo stato del catalogo non si nasconde.** Un catalogo vecchio, parziale o bloccato dal login
   è la causa numero uno di risultati sbagliati: va detto, non mascherato.
5. **Zero dipendenze, zero configurazione.** Ogni scelta di UI deve reggere senza build step.

## Accessibility & Inclusion

Superficie da tastiera oltre che da mouse (il popup si apre e si usa in pochi secondi);
contrasto sufficiente in tema chiaro e scuro, entrambi già supportati via
`prefers-color-scheme`; nessun testo affidato al solo colore, perché verde e viola portano
significato.
