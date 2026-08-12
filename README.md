# Discount Check

Estensione (MV3) per **Chrome, Brave, Edge** e gli altri browser Chromium, che ti ricorda gli sconti a cui hai già diritto **mentre stai per
pagare**, invece di fartene accorgere il giorno dopo.

Tre fonti in una sola riga al checkout:

- **Corporate Benefits** — le convenzioni aziendali del portale `almaviva.convenzioniaziendali.it`
- **Revolut** — i moltiplicatori RevPoints, che si sommano alla convenzione
- **Klarna** — i negozi con cashback (da riscattare dentro la Klarna app)

---

## Installazione

> **Stato: submission allo Store in preparazione.** Finché non è approvata, il link sotto non
> esiste ancora e chi ha l'estensione caricata a mano continua a usarla com'è — non deve fare
> niente e non riceverà avvisi di aggiornamento. La procedura di pubblicazione è in
> [store/listing.md](store/listing.md).

### 1. Installala dal Chrome Web Store

Apri la pagina dell'estensione sullo Store e premi **Aggiungi**. Funziona su Chrome, Brave, Edge,
Vivaldi e gli altri browser Chromium.

Da qui in poi gli aggiornamenti li fa il browser da solo: niente zip, niente script, niente
riavvii. Non serve la Modalità sviluppatore.

Chi ce l'ha già caricata a mano deve **installare quella dello Store e poi rimuovere la vecchia**:
per il browser sono due estensioni diverse, con ID diversi, quindi non si aggiornano a vicenda.
Rimuovendo la vecchia si perdono credenziali, catalogo e segnalazioni: vanno rimesse le
credenziali e rilanciato **Aggiorna tutto**. Si paga una volta sola.

### 2. Consenti l'accesso ai siti di shopping

Clicca l'icona dell'estensione: in cima alla dashboard trovi **"Accesso ai siti non concesso"** →
**Consenti sui siti di shopping** → **Consenti** nella finestra del browser.

Senza questo permesso l'estensione funziona a metà: scarica i cataloghi e la ricerca nella dashboard
va, ma al checkout non compare niente, perché non può sapere su che sito sei.

È un permesso **opzionale** e non viene chiesto all'installazione, così il browser non ti mette
davanti "Leggi e modifica tutti i tuoi dati su tutti i siti web" prima ancora che tu abbia capito a
cosa serve. In pratica l'estensione non esegue codice sulle pagine che non c'entrano nulla: il
controllo lo fa il service worker sul solo indirizzo del sito, e il popup viene caricato **solo**
sulle pagine dove c'è davvero una convenzione, un moltiplicatore Revolut o un cashback Klarna.

### 3. Inserisci le credenziali del portale

Clicca l'icona dell'estensione → **Apri dashboard** → sezione **Accesso al portale** → email e
password del portale Corporate Benefits → **Salva**.

Sono le stesse con cui accedi al sito. Restano in `chrome.storage.local`, su questo computer: non
sono nel repo né nel pacchetto, e ogni installazione ha le sue. La dashboard non le rilegge mai — il
campo password ti dice solo se è salvata.

### 4. Primo aggiornamento del catalogo

Premi **Aggiorna tutto**. Il primo crawl del portale scarica ~900 offerte e dura qualche minuto:
puoi chiudere la dashboard, va avanti da solo. Revolut e Klarna sono immediati.

Da qui in poi non devi fare più nulla: il catalogo si aggiorna da solo ogni 24 ore.

---

## Come si usa

Non si usa: si fa vedere lei.

- **Badge sull'icona** appena apri un sito convenzionato — sai subito che c'è qualcosa da guardare
- **Popup al checkout** (URL tipo `/cart`, `/checkout`, `/carrello`, o bottoni "procedi al
  pagamento", "completa l'ordine"), con le convenzioni che valgono per quel sito
- **Il sito su cui sei, in cima alla dashboard**: le stesse righe della card, raggiungibili sempre.
  Il badge dice che c'è qualcosa, questo dice *che cosa* — e da qui togli un abbinamento sbagliato
  senza dover arrivare a un checkout
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

**Il badge o il popup escono dove non c'entrano nulla**

Dove il dominio non si sa, il matching indovina dal nome e preferisce i falsi positivi ai silenzi.
Il rimedio immediato è il **divieto** (⊘) sulla riga, in cima alla dashboard o nella card: nasconde
quell'offerta **su quel sito soltanto**, ed è reversibile da **Segnalazioni di errore**.

Se il negozio è di Revolut, il rimedio definitivo è un altro: scrivergli il dominio giusto su
`sconti-api`. Da quel momento quel negozio smette di essere indovinato per nome — non solo per te,
ma per chiunque abbia l'estensione, entro 24 ore. Vedi [hermes-skill](hermes-skill/SKILL.md).

**Nota:** "collega a un sito" non serve a questo. Aggiunge un dominio a un negozio, non lo toglie
da un altro.

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
  riprende la coda. Vive **solo durante un crawl**: viene creato quando parte la fase offerte e
  tolto quando finisce o fallisce, altrimenti sarebbero ~1440 risvegli al giorno per leggere una
  coda vuota
- **Iniezione condizionale**: `content.js` non è dichiarato nel manifest. Il service worker ascolta
  `tabs.onUpdated`, confronta l'hostname con gli indici che ha già e chiama `scripting.executeScript`
  solo dove c'è almeno un vantaggio. Sui siti che non c'entrano non gira una riga di codice nostro
- **Crollo sospetto**: se un crawl trova meno della metà delle offerte del precedente, il catalogo
  vecchio **non** viene sostituito e la dashboard lo dice. Se al giro dopo il portale racconta la
  stessa cosa, il calo è vero e si accetta — altrimenti un cambio di layout del portale svuoterebbe
  il catalogo lasciando scritto "aggiornato adesso"

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

### Matching

Dal più affidabile al più euristico:

1. **Alias manuale** (dashboard → "collega a un sito") — vince sempre, vale solo su questo computer
2. **Dominio esatto** dell'offerta
3. **Nome del dominio**, senza suffisso: un `nike.com` conosciuto aggancia anche `nike.it`
4. **Nome del negozio** appiccicato (`thespacecinema`), come sottostringa nei due versi
5. **Una parola sola** del nome, da 7 caratteri in su, **solo se il dominio ci comincia**

Il livello 5 è severo apposta. I marchi costruiscono il dominio col nome davanti e il
settore dietro, quindi `mondadori` è un prefisso di `mondadoristore` mentre `airways` è solo
un suffisso di `itaairways`: senza la regola del prefisso, "Qatar Airways" compariva su
`ita-airways.com`.

**Per Revolut e Klarna il dominio sostituisce i livelli 4 e 5**, non li affianca: quando si
sa dov'è il negozio non c'è niente da indovinare. Vale solo per quelle due fonti perché il
loro dominio è davvero del negozio — curato a mano per Revolut, letto da `merchantUrl` per
Klarna. Il link del portale no: un'offerta su cinque punta a un portale convenzione dedicato,
quindi lì il nome resta indicizzato anche quando un link c'è.

Ne segue che **curare un dominio su `sconti-api` è più efficace che stringere una regola**:
toglie quel negozio dalla zona a indovinelli senza togliere niente agli altri. E l'alias
locale per un negozio che ha ottenuto un dominio dal server viene cancellato al primo
aggiornamento, o resterebbe a sovrascrivere per sempre il dato buono appena arrivato.

Dove si indovina ancora, il matching è tarato per **preferire i falsi positivi**: un
promemoria di troppo si chiude, uno sconto perso no.

---

## Distribuzione

**Chrome Web Store, visibilità "non in elenco".** Il browser aggiorna da solo: pubblicare una
versione nuova basta a farla arrivare a tutti, di solito entro qualche ora.

Ogni push su `main` fa girare [build.yml](.github/workflows/build.yml), che lancia i test e
produce `discount-check.zip` come **artifact** della run — non come GitHub Release, perché nessuno
deve più installare a mano da un link. Per pubblicare: scarichi l'artifact dalla run e lo carichi
sul Developer Dashboard.

Se i test falliscono il pacchetto non si costruisce: il parsing del portale è a regex e si rompe
in silenzio, quindi un pacchetto che trova zero offerte non deve nemmeno esistere.

`manifest.json` va bumpato a ogni submission: lo Store rifiuta un pacchetto con una `version` già
caricata.

Attenzione a **quando** bumparlo. Le installazioni caricate a mano leggono una volta al giorno la
`version` dal manifest che GitHub Pages serve dalla root di `main`, e mostrano l'avviso di
aggiornamento se è più alta della loro. Finché resta gente su installazioni manuali, alzare quella
`version` significa mandargli un avviso che non possono soddisfare, perché le release non vengono
più pubblicate. Per questo la prima submission parte da `1.0.9`, la stessa che vedono adesso: si
bumpa quando la migrazione allo Store è finita.

I testi della scheda, le giustificazioni dei permessi e le dichiarazioni sull'uso dei dati stanno
in [store/listing.md](store/listing.md), così alla submission successiva non si riparte dal foglio
bianco. L'informativa privacy è [PRIVACY.md](PRIVACY.md) ed è l'URL dichiarato allo Store.

## Struttura

| File                | Ruolo                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| `background.js`     | crawl del portale, parsing, indici, matching, badge                         |
| `content.js`        | rilevamento checkout + overlay (Shadow DOM)                                 |
| `dashboard.html/js` | stato sync, ricerca catalogo, alias, segnalazioni, mute                     |
| `test.js`           | test delle funzioni di parsing e matching (`node test.js`)                  |
| `store/`            | testi e giustificazioni della scheda Chrome Web Store                       |
| `PRIVACY.md`        | informativa privacy, dichiarata come URL allo Store                         |
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
