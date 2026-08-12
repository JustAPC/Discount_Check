# Informativa privacy — Discount Check

Ultimo aggiornamento: 12 agosto 2026

Discount Check è un'estensione per browser che ricorda all'utente gli sconti a cui ha già
diritto mentre sta comprando online. Questa pagina descrive esattamente quali dati tratta,
dove restano e a chi vengono inviati.

**Non esiste alcun account Discount Check, alcun server che sappia chi sei, alcuna analitica
e alcun tracciamento.**

## Dati trattati e dove restano

| Dato                                                        | Dove sta                                   | Esce dal dispositivo?                                             |
| ----------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| Email e password del portale convenzioni aziendali           | `chrome.storage.local`, sul tuo dispositivo | Solo verso il portale stesso, per fare login                       |
| Catalogo delle convenzioni scaricato dal portale             | `chrome.storage.local`                      | No                                                                 |
| Cataloghi Revolut e Klarna                                    | `chrome.storage.local`                      | No                                                                 |
| Indirizzo dei siti che visiti                                 | Confrontato in memoria, non salvato          | **No, mai**                                                        |
| Siti silenziati, offerte nascoste, collegamenti manuali       | `chrome.storage.local`                      | No                                                                 |

`chrome.storage.local` è l'archivio locale del browser: i dati stanno sul tuo computer e li
cancelli rimuovendo l'estensione.

## Credenziali del portale

L'estensione ha bisogno delle tue credenziali del portale convenzioni per una sola ragione:
il catalogo delle convenzioni sta dietro un login e la sessione scade. Senza credenziali
salvate, l'aggiornamento automatico del catalogo si fermerebbe ogni volta.

Le credenziali:

- sono inserite da te nella dashboard dell'estensione e restano in `chrome.storage.local`;
- vengono inviate **esclusivamente** al portale (`*.convenzioniaziendali.it`), nella stessa
  richiesta di login che faresti dal browser;
- non vengono mai inviate all'autore dell'estensione, a `sconti-api` o a terzi;
- non lasciano mai il dispositivo verso nessun'altra destinazione;
- si cancellano dal bottone **Cancella** nella dashboard, o rimuovendo l'estensione.

Sono conservate in chiaro nello storage locale dell'estensione, come qualunque dato di
un'estensione: chi ha accesso fisico al tuo profilo browser può leggerle. Se questo non è
accettabile nel tuo contesto, non inserirle — l'estensione resta utilizzabile con i cataloghi
Revolut e Klarna, che non richiedono login.

## Cronologia di navigazione

L'estensione **non** raccoglie, salva o trasmette la tua cronologia.

Quando apri una pagina, il service worker confronta l'indirizzo del sito con l'indice dei
negozi che ha già in locale. Il confronto avviene interamente sul tuo dispositivo e il
risultato non viene salvato. Il codice dell'estensione viene caricato nella pagina **solo**
se quel sito ha effettivamente una convenzione, un moltiplicatore Revolut o un cashback
Klarna: sulle pagine che non c'entrano non viene eseguito nulla.

L'accesso ai siti è un permesso **opzionale**: non viene richiesto all'installazione e lo
concedi tu dalla dashboard. Puoi revocarlo in qualsiasi momento dalle impostazioni
dell'estensione nel browser.

## Connessioni di rete

L'estensione contatta solo questi indirizzi:

- **`*.convenzioniaziendali.it`** — il portale convenzioni, per il login e per leggere il
  catalogo delle offerte. Riceve le tue credenziali, come quando ci accedi dal browser.
- **`sconti-api.andreapontillo.tech`** — server self-hosted dell'autore, che serve il catalogo
  dei moltiplicatori RevPoints. È una sola richiesta di lettura, senza autenticazione e senza
  alcun dato tuo: la risposta è identica per chiunque la richieda.
- **`www.klarna.com`** — l'API pubblica che alimenta la vetrina negozi di Klarna, per l'elenco
  dei negozi con cashback. Nessuna autenticazione, nessun dato tuo.

Nessuna di queste richieste contiene i siti che visiti, la tua cronologia o un identificativo
che ti riguardi.

## Cosa l'estensione non fa

- Non vende, affitta né condivide dati con nessuno.
- Non usa i dati per pubblicità, profilazione o creazione di profili utente.
- Non contiene analitica, telemetria, crash reporting o identificativi pubblicitari.
- Non carica né esegue codice remoto: tutto ciò che gira è nel pacchetto.
- Non legge il contenuto delle pagine, i moduli, i dati di pagamento o i carrelli.
- Non modifica le pagine oltre al proprio promemoria, che puoi chiudere.

## Cancellare i dati

Rimuovi l'estensione dal browser: il browser cancella l'intero `chrome.storage.local`
dell'estensione, comprese le credenziali. Per cancellare le sole credenziali, usa **Cancella**
nella sezione **Accesso al portale** della dashboard.

## Affiliazioni

Discount Check è un progetto personale e indipendente. Non è affiliato, sponsorizzato né
approvato da AlmavivA, Corporate Benefits, Revolut o Klarna. I nomi e i marchi citati
appartengono ai rispettivi titolari e sono usati solo per indicare la fonte di un vantaggio.

## Contatti

Per domande su questa informativa: [apri una issue](https://github.com/JustAPC/Discount_Check/issues).
