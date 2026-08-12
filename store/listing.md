# Scheda Chrome Web Store — testi da incollare

Questo file non finisce nel pacchetto: è il promemoria di cosa scrivere nel Developer
Dashboard, così alla prossima submission non si riparte dal foglio bianco.

Visibilità consigliata: **Non in elenco (unlisted)**. L'estensione serve a chi ha accesso a un
portale convenzioni aziendale: non ha senso in una vetrina pubblica, ma chiunque abbia il link
può installarla e ricevere gli aggiornamenti automatici.

---

## Nome

```
Discount Check
```

## Descrizione breve (max 132 caratteri)

```
Ti ricorda gli sconti a cui hai già diritto — convenzioni aziendali, punti Revolut, cashback Klarna — mentre stai per pagare.
```

## Descrizione completa

```
Discount Check ti ricorda gli sconti che hai già, nel momento in cui servono: mentre stai per
pagare, non il giorno dopo.

Mette insieme tre fonti che di solito stanno in tre posti diversi:

• Corporate Benefits — le convenzioni del portale aziendale, quelle dietro login che nessun
  motore di ricerca indicizza
• Revolut — i moltiplicatori RevPoints, che si sommano alla convenzione
• Klarna — i negozi con cashback

Quando apri un negozio che ha uno di questi vantaggi, l'icona nella barra mostra quanti ne ha
trovati. Quando arrivi al carrello o alla cassa, compare un promemoria in basso a destra con
cosa ti spetta e cosa devi fare per prenderlo: passare dal portale, pagare con una carta
specifica, o comprare dall'app.

Se un promemoria non ti serve, si chiude. Se un negozio non ti interessa, lo silenzi. Se un
abbinamento è sbagliato, lo togli. Tutto dalla dashboard, tutto reversibile.

COSA NON FA

Non raccoglie la tua cronologia, non ha un account, non ha analitica, non manda i siti che
visiti a nessuno. Il controllo su che sito sei avviene sul tuo computer, e il codice viene
caricato nella pagina solo quando quel sito ha davvero un vantaggio: sugli altri non gira
niente.

L'accesso ai siti è un permesso opzionale: non viene chiesto all'installazione, lo concedi tu
dalla dashboard quando hai capito a cosa serve, e lo revochi quando vuoi.

PER FUNZIONARE SERVE

Un account su un portale convenzioni Corporate Benefits. I cataloghi Revolut e Klarna
funzionano anche senza.

Discount Check è un progetto personale e indipendente, non affiliato né approvato da AlmavivA,
Corporate Benefits, Revolut o Klarna.
```

## Categoria

`Shopping`

## Lingua

`Italiano`

## URL informativa privacy

```
https://github.com/JustAPC/Discount_Check/blob/main/PRIVACY.md
```

---

## Scopo unico (single purpose)

Lo Store chiede una frase, non un elenco. Il punto è che le tre fonti servono **la stessa**
funzione, non tre funzioni diverse.

```
Ricordare all'utente, mentre sta completando un acquisto online, gli sconti e i vantaggi a cui
ha già diritto su quel negozio.
```

## Giustificazione dei permessi

Da compilare campo per campo nella sezione "Privacy practices". Sono le risposte che fanno
passare o bloccare la review: vanno collegate a una funzione visibile, non a una generica utilità.

| Permesso                            | Giustificazione                                                                                                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                           | Conserva in locale il catalogo delle offerte, le credenziali del portale inserite dall'utente e le sue scelte (siti silenziati, offerte nascoste, collegamenti manuali). Nessun dato lascia il dispositivo. |
| `alarms`                            | Pianifica l'aggiornamento giornaliero dei tre cataloghi e riprende un aggiornamento interrotto dalla terminazione del service worker.                                                                 |
| `scripting`                         | Inserisce il promemoria nella pagina solo quando il sito visitato ha effettivamente una convenzione, un moltiplicatore o un cashback. Evita di eseguire codice sui siti che non c'entrano.             |
| Host `*.convenzioniaziendali.it`    | Effettua il login con le credenziali dell'utente e legge il catalogo delle convenzioni del suo portale aziendale, che non ha API pubbliche.                                                            |
| Host `sconti-api.andreapontillo.tech` | Scarica il catalogo dei moltiplicatori RevPoints. Sola lettura, senza autenticazione e senza inviare dati dell'utente.                                                                                |
| Host `www.klarna.com`               | Scarica dall'API pubblica di Klarna l'elenco dei negozi con cashback. Sola lettura, nessun dato dell'utente.                                                                                          |
| Host opzionale `http/https://*/*`   | Riconosce il negozio su cui si trova l'utente per mostrargli il promemoria al momento del pagamento. È opzionale, concesso dall'utente dalla dashboard e revocabile.                                   |

## Uso dei dati — dichiarazioni da spuntare

- **Informazioni di autenticazione**: sì. Email e password del portale convenzioni, inserite
  dall'utente, conservate in locale e inviate solo al portale stesso per il login.
- **Attività sui siti web**: no. L'indirizzo del sito viene confrontato in locale e non è
  salvato né trasmesso.
- Tutto il resto: no.

Le tre certificazioni finali (non vendo i dati, non li uso per scopi estranei alla funzione
dichiarata, non li uso per valutare il merito creditizio) si possono spuntare tutte.

## Codice remoto

**No.** Nessuno script esterno, nessun CDN, nessun `eval`. Tutto quello che gira è nel
pacchetto — è anche il motivo per cui non c'è alcun build step.

---

## Screenshot richiesti

Servono da 1 a 5 immagini, **1280×800** o 640×400. Le tre che raccontano il prodotto:

1. Il promemoria al checkout su un sito con più fonti insieme (verde + viola).
2. La dashboard con lo stato del catalogo e la ricerca compilata.
3. La sezione delle fonti aperta, che mostra i tre cataloghi.

Su macOS: `⇧⌘4` poi barra spaziatrice per catturare la sola finestra. Poi ritaglia a 1280×800.
