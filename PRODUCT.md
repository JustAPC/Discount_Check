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
- **In manutenzione** (raro, deliberato): apre il popup dalla toolbar per vedere cosa c'è sul
  sito che ha davanti — il badge dice che c'è qualcosa, non che cosa — controllare che il
  catalogo sia aggiornato, cercare un negozio prima di comprare, collegare a mano un'offerta a
  un dominio, o disfare un falso positivo che l'ha infastidito.

## Product Purpose

Ricordare, nel momento in cui serve, che su questo acquisto c'è uno sconto Corporate Benefits
e/o un moltiplicatore RevPoints Revolut. Successo = zero acquisti a prezzo pieno per
dimenticanza. Fallimento = tante notifiche che l'utente silenzia l'estensione.

## Positioning

Tre fonti che **si sommano** e che nessun'altra estensione mette insieme: le convenzioni del
portale aziendale (dietro login, non indicizzabile, senza API), i moltiplicatori RevPoints
Revolut (dati solo dentro l'app, raccolti a mano via `sconti-api`) e il cashback Klarna. Sullo
stesso acquisto si può passare dal portale *e* pagare con Revolut.

## Operating Context

- **Chromium MV3**, distribuita dal Chrome Web Store (visibilità "non in elenco"). Due
  superfici: il popup della toolbar (`dashboard.html`, larghezza fissa ~400px, altezza massima
  ~580px) e la card iniettata nella pagina di checkout (`content.js`, Shadow DOM, in basso a
  destra). Il popup apre sul sito della tab corrente, con le stesse righe della card.
- Il content script **non** sta su ogni pagina: il service worker confronta l'hostname della
  tab con gli indici che ha già e lo inietta solo dove c'è davvero qualcosa. L'accesso ai siti
  è un permesso opzionale, concesso dalla dashboard e revocabile.
- Il crawl del portale usa **email e password salvate dall'utente** in `chrome.storage.local`,
  perché la sessione scade e senza credenziali l'aggiornamento automatico si fermerebbe ogni
  volta. Escono solo verso il portale. Dura minuti e può interrompersi (service worker
  terminato), quindi lo stato "sync in corso" è un'informazione di prima classe nel popup.
- Catalogo Revolut da `sconti-api` self-hosted, Klarna dall'API pubblica del sito; se una fonte
  non risponde vale l'ultima lista scaricata.
- Tutto in `chrome.storage.local`. Nessun backend che sappia chi è l'utente: `sconti-api` serve
  lo stesso catalogo a chiunque e non riceve mai un dato dell'utente.

## Capabilities and Constraints

- Vanilla HTML/CSS/JS, nessun build step, nessuna dipendenza esterna: l'estensione si carica
  da cartella. Niente CDN (CSP delle estensioni), niente font remoti.
- Il service worker MV3 non ha `DOMParser`: il portale si parsa a regex.
- Matching a più livelli: alias manuale > dominio esatto > nome del dominio senza suffisso >
  nome del negozio > una parola sola del nome, e solo se il dominio ci comincia. Per Revolut e
  Klarna un dominio noto **sostituisce** i livelli sul nome invece di affiancarli: dove il sito
  si sa, non si indovina. Dove si indovina ancora, il matching preferisce i falsi positivi.
- I domini di Revolut si curano su `sconti-api` e valgono per tutti entro 24 ore, senza
  aggiornare l'estensione: correggere un dato è più efficace che stringere una regola.
- Stati che la UI deve saper mostrare, tutti reali e frequenti: sync in corso con progresso,
  sessione portale scaduta (`login`), sync fallita, catalogo mai scaricato, catalogo presente
  ma vecchio, catalogo Revolut in cache con server irraggiungibile.
- Il popup è la superficie dove si **vede** e si disfa tutto (unblock, unmute, alias, snooze):
  è il pannello di controllo, non una vetrina. La card al checkout offre gli stessi tre gesti
  nel momento in cui servono, ma solo il popup li mostra anche dopo.

## Brand Commitments

- Nome: **Discount Check**. Interfaccia e copy in italiano, tono asciutto e concreto.
- Codice colore già in uso e da preservare perché è semantica, non decorazione:
  **verde = Corporate Benefits**, **viola = Revolut**, **rosa = Klarna**. Le tre fonti non
  vanno mai confuse, perché si usano in modo diverso: una richiede di passare dal portale, una
  di pagare con una carta specifica, una di comprare dentro un'app.

## Evidence on Hand

- Catalogo reale del portale AlmavivA: ~900 offerte a crawl completo (~50% con dominio del
  brand, ~10% gift card su `it.vouchers-at-work.com`, il resto negozi fisici senza link).
- Catalogo Revolut reale servito da `sconti-api` (`/revolut/offers`): 143 negozi con nome,
  tasso punti e flag "potenziato". Il **dominio non arriva da Revolut** — gli screenshot
  dell'app non lo contengono — quindi è un dato curato a mano, negozio per negozio, e all'inizio
  era vuoto su tutti e 143.
- Catalogo Klarna reale dall'API pubblica del sito: solo i negozi con `cashbackDiscount`, il
  dominio letto da `merchantUrl`.
- Nessun dato di utilizzo, nessuna metrica, nessun altro utente: non inventare numeri di
  risparmio, statistiche di utilizzo o testimonianze.

## Product Principles

1. **L'interruzione va meritata.** La card al checkout è l'unico momento in cui l'estensione
   parla senza essere interpellata; deve essere leggibile in due secondi e sempre congedabile.
   Il badge sull'icona è il grado più basso della stessa scala: si vede su ogni tab, quindi un
   falso positivo lì costa più che nella card.
2. **Le tre fonti restano distinte e visibilmente sommabili.** Mai un badge generico "sconto".
3. **Ogni automatismo è disfabile dall'utente**, e il posto dove si disfa è il popup. Vale
   anche per ciò che l'utente crea di suo: i collegamenti manuali hanno un elenco e si
   staccano da lì.
4. **Lo stato del catalogo non si nasconde.** Un catalogo vecchio, parziale o bloccato dal login
   è la causa numero uno di risultati sbagliati: va detto, non mascherato.
5. **Zero dipendenze, zero configurazione.** Ogni scelta di UI deve reggere senza build step.
6. **Curare un dato batte stringere una regola.** Ogni euristica più severa recupera un falso
   positivo e ne perde uno vero; un dominio scritto su `sconti-api` toglie un negozio dagli
   indovinelli senza togliere niente agli altri, e vale per tutti senza pubblicare nulla.

## Accessibility & Inclusion

Superficie da tastiera oltre che da mouse (il popup si apre e si usa in pochi secondi);
contrasto sufficiente in tema chiaro e scuro, entrambi già supportati via
`prefers-color-scheme`; nessun testo affidato al solo colore, perché verde e viola portano
significato.
