---
name: Discount Check
description: Sistema visivo dell'estensione che ricorda sconti Corporate Benefits, punti Revolut e cashback Klarna prima di pagare.
colors:
  ground: "#fbfbfc"
  surface: "#ffffff"
  raise: "#f1f3f5"
  line: "#e4e7ea"
  line-soft: "#eef0f2"
  ink: "#14161a"
  ink-2: "#59626e"
  ink-3: "#69727d"
  cb-ink: "#067a52"
  cb-bg: "#e6f5ee"
  rev-ink: "#6b28d9"
  rev-bg: "#f0eafd"
  kl-ink: "#b0114c"
  kl-bg: "#fde8ef"
  run: "#1d4ed8"
  warn-ink: "#8a5106"
  warn-bg: "#fdf3e2"
  warn-line: "#f2d9a8"
  err-ink: "#a4231a"
  err-bg: "#fdeceb"
  err-line: "#f3c3bf"
  focus: "#2563eb"
  selection: "#dbe6ff"
typography:
  title:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "14.5px"
    fontWeight: 650
    lineHeight: 1.45
    letterSpacing: "-0.015em"
  body:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
    fontFeature: "tabular-nums"
  label:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.06em"
rounded:
  chip: "6px"
  control: "8px"
  card: "14px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "15px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 11px"
  button-primary-hover:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.surface}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 11px"
  button-ghost-hover:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
  chip-cb:
    backgroundColor: "{colors.cb-bg}"
    textColor: "{colors.cb-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "4px 6px"
    width: "46px"
  chip-kl:
    backgroundColor: "{colors.kl-bg}"
    textColor: "{colors.kl-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "4px 6px"
    width: "46px"
  chip-rev:
    backgroundColor: "{colors.rev-bg}"
    textColor: "{colors.rev-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "4px 6px"
    width: "46px"
  chip-none:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "4px 6px"
    width: "46px"
  input-search:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 30px 8px 31px"
  row-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 6px"
  row-item-hover:
    backgroundColor: "{colors.raise}"
  card-checkout:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "15px 16px 14px"
    width: "400px"
---

# Design System: Discount Check

## Overview

**Creative North Star: "Lo strumento affilato"**

Discount Check non è una vetrina di sconti: è uno strumento che si apre per pochi secondi, dice
lo stato di un catalogo e risponde a una domanda ("questo negozio ce l'ho?"), poi sparisce.
Il sistema è costruito su una sola unità — la riga — separata da filetti da 1px, senza card
annidate e senza griglie di riquadri statistici. La densità è alta perché lo spazio è poco
(400px di popup) e perché l'utente sta scansionando, non leggendo.

Il colore non decora niente. Ogni tinta ha esattamente un significato e ricorre identica su
tutte e due le superfici dell'estensione: il popup della toolbar e la card iniettata nella
pagina di checkout. Verde vuol dire Corporate Benefits, viola vuol dire Revolut, rosa vuol
dire Klarna, e la distinzione conta perché le tre fonti si usano in modo diverso — una chiede
di passare dal portale, una di pagare con una certa carta, una di comprare dentro un'app.

L'anti-riferimento dichiarato è il popup di estensione che apre con quattro tessere-statistica
e un gradiente: qui le cifre stanno su una riga sola da 11px e la prima cosa a fuoco è il
campo di ricerca.

**Key Characteristics:**
- Riga + filetto come unica struttura di lista; nessuna card dentro una card.
- Tre soli gradi tipografici, font di sistema, cifre tabulari ovunque compaiano numeri.
- Colore esclusivamente semantico, sei significati, zero accenti decorativi.
- Un solo contenitore scorrevole per superficie.
- Stato del catalogo sempre visibile, mai mascherato.

## Colors

Fondo neutro freddo, inchiostro quasi nero, e sei colori che parlano: tre per le fonti dati,
tre per lo stato del sistema.

### Primary
- **Verde convenzione** (`#067a52`, su `#e6f5ee`): Corporate Benefits, e nient'altro. Chip
  sconto, pallino del gruppo di risultati, cifre del catalogo CB. In scuro `#34d399` su `#06301f`.

### Secondary
- **Viola RevPoints** (`#6b28d9`, su `#f0eafd`): Revolut, e nient'altro. Chip moltiplicatore,
  pallino del gruppo, cifra dei negozi Revolut. In scuro `#c4b5fd` su `#2e1065`.
- **Rosa Klarna** (`#b0114c`, su `#fde8ef`, 5.9:1): Klarna, e nient'altro. Chip cashback,
  pallino del gruppo, cifra dei negozi Klarna. In scuro `#f9a8c8` su `#450a25`. È il rosa di
  Klarna portato a un valore leggibile: il `#FFB3C7` del brand non regge il testo.

### Tertiary
- **Blu sync** (`#1d4ed8`): sincronizzazione in corso — pallino pulsante e barra di avanzamento.
  È l'unico colore animato del sistema.
- **Ambra login** (`#8a5106` su `#fdf3e2`, bordo `#f2d9a8`): sessione del portale scaduta. Stato
  recuperabile dall'utente.
- **Rosso guasto** (`#a4231a` su `#fdeceb`, bordo `#f3c3bf`): sync fallita o service worker non
  raggiungibile. Stato non recuperabile con un'azione sola.

### Neutral
- **Fondo** (`#fbfbfc`): il piano su cui scorre il contenuto.
- **Superficie** (`#ffffff`): testata, riga in hover, controlli a riposo. Un solo gradino sopra il fondo.
- **Rialzo** (`#f1f3f5`): hover dei bottoni e riempimento della riga; il gradino che si deve *vedere*.
- **Filetto** (`#e4e7ea`) e **filetto tenue** (`#eef0f2`): separatori di riga e di sezione.
- **Inchiostro** (`#14161a`) / **secondario** (`#59626e`) / **terziario** (`#69727d`): titoli, testo
  di dettaglio, etichette e icone a riposo. Il terziario è tarato a 4.7:1 sul fondo chiaro: è il
  valore minimo, non un grigio libero.

### Named Rules
**La regola un colore, un significato.** Sei tinte, sei significati, nessuna eccezione:
verde = Corporate Benefits, viola = Revolut, rosa = Klarna, blu = sync in corso,
ambra = login scaduto, rosso = guasto. Una tinta usata "perché sta bene" è un bug. Un colore non porta mai
un'informazione da solo: accanto c'è sempre un'etichetta o un'icona.

**La regola del chip onesto.** Il chip colorato contiene solo un valore che si legge come
sconto (`%`, `€`, "sconto", "gratis"). Il portale scrive nello stesso campo anche distanze e
note libere: quelle scendono nella riga di dettaglio e il chip diventa neutro con un trattino.
Un chip verde su un dato che sconto non è mente all'utente nel momento in cui sta pagando.

## Typography

**Font unico:** `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
**Numeri:** `font-variant-numeric: tabular-nums` su tutto il sistema.

**Character:** nessuna voce display. Un UI stack ben tarato porta titoli, etichette, dati e
corpo; il carattere del prodotto sta nella densità e nei filetti, non nella lettera.

### Hierarchy
- **Title** (650, 14.5px, -0.015em): nome dell'estensione nella testata e titolo della card al
  checkout. Un solo elemento per superficie.
- **Body** (400–550, 12.5px, 1.45): tutto il resto — righe, bottoni, campo di ricerca, avvisi,
  titoli delle offerte (550).
- **Label** (600, 11px, 0.06em, maiuscolo): intestazioni di sezione e di gruppo, conteggi,
  metadati di riga, chip. Il maiuscolo distingue l'etichetta dal contenuto senza cambiare peso.

### Named Rules
**La regola dei tre gradi.** 11 / 12.5 / 14.5 e basta. I passi sono 1.136 e 1.16, dentro la
banda 1.125–1.2 che `reference/operate.md` prescrive alle UI di prodotto. Il detector generico
chiede 1.25 per gradino: è un numero da superficie di brand, e applicarlo qui porterebbe il
titolo a 17px dentro un popup da 400px. Deviazione deliberata e motivata, non un difetto aperto.
Rank ulteriori si esprimono con peso e con `ink-2` / `ink-3`, mai con una quarta misura.

## Layout

Popup a larghezza fissa 400px, altezza massima 580px (limite di Chrome: 600). Colonna flex con
`overflow: hidden` sul body: testata `flex: none`, `main` unico elemento scorrevole. La card di
checkout è larga 400px, `max-height: 80vh`, fissa in basso a destra con 16px di margine.

**La regola di un solo scorrimento.** Per superficie esiste un solo contenitore che scorre.
Liste dentro liste con `max-height` proprio sono vietate: erano il difetto della versione
precedente e rendono impossibile capire dove si è.

Ritmo: 6/8 dentro un gruppo (padding di riga, gap tra controlli), 12 per la testata, 15 sopra
un'intestazione di sezione contro 10 sotto — sopra un titolo c'è sempre più aria che sotto.
Le intestazioni di gruppo nei risultati sono `position: sticky` in cima allo scorrimento: sono
la spina dorsale che tiene orientati quando le righe sono tante.

Nessun breakpoint: entrambe le superfici hanno larghezza fissa per costruzione.

## Elevation & Depth

Sistema sostanzialmente piatto. La profondità si fa con la tonalità e con i filetti da 1px, non
con le ombre: fondo → superficie → rialzo sono tre gradini di grigio, e ogni lista è tenuta
insieme da separatori, non da contenitori.

L'unica ombra vera del sistema è quella della card al checkout, che deve staccarsi da una pagina
di terzi sconosciuta.

### Shadow Vocabulary
- **Card fluttuante** (`box-shadow: 0 12px 32px rgba(9,12,17,.22), 0 2px 6px rgba(9,12,17,.10)`):
  solo la card iniettata. Due strati, entrambi con offset e sfocatura.
- **Anello del controllo** (`box-shadow: inset 0 0 0 1px var(--ink-3)`): bordo interno del
  bottone-icona in hover, per distinguere il bersaglio cliccabile dalla riga evidenziata.
- **Alone di fuoco** (`box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 18%, transparent)`):
  solo sul campo di ricerca a fuoco, in aggiunta al bordo che cambia colore.

**La regola del bordo e basta.** La card di checkout porta bordo *e* ombra perché il fondo su cui
atterra è ignoto e il bordo è l'unico contorno garantito. È l'unica eccezione: altrove si dichiara
o il bordo o l'ombra, mai i due insieme.

## Shapes

Tre raggi, assegnati per classe di elemento e mai a occhio: **6px** per i chip e i bottoni-icona,
**8px** (`--r`) per bottoni, campi, avvisi e righe in hover, **14px** per la card. I pallini di
stato e i marcatori di gruppo sono cerchi da 6–7px.

Le icone sono un set disegnato a mano su griglia 24, tratto 1.5, estremi e giunzioni tondi,
`currentColor`. Nel popup vivono in uno sprite `<symbol>`; nella card sono ridisegnate in JS
perché lo sprite della pagina non attraversa lo Shadow DOM. Nessuna emoji, nessun glifo unicode
al posto di un'icona.

## Components

### Buttons
- **Shape:** raggio del controllo (8px), altezza data dal padding `8px 11px`, gap 6px tra icona
  ed etichetta.
- **Primary:** fondo inchiostro, testo superficie. Uno solo per superficie ("Aggiorna tutto" nel
  popup, "Apri" nella card).
- **Ghost:** fondo superficie, bordo filetto, testo inchiostro. Hover: fondo rialzo, bordo terziario.
- **Hover / Focus / Active:** transizione 160ms su fondo/bordo/colore; `active` sposta di 0.5px;
  `:focus-visible` è un anello da 2px sul colore di fuoco con 2px di stacco.
- **Disabled vs busy:** sono due cose diverse. `:disabled` spegne il colore; la rotazione
  dell'icona sta su `.busy`. Un bottone disabilitato non deve dichiarare di star lavorando.

### Chips
- **Style:** pillola 6px, minimo 46px, massimo 76px con ellissi, etichetta 11px/650 centrata.
- **Varianti:** `cb` (verde), `rev` (viola), `none` (rialzo + terziario) quando il valore non è
  uno sconto. La variante è semantica, mai estetica.

### Rows
- **Struttura:** chip, blocco testo (titolo 12.5px/550 troncato + dettaglio 11px in `ink-2`),
  bottoni-icona a destra.
- **Separazione:** `box-shadow: 0 -1px 0 var(--line-soft)` tra righe consecutive, mai un bordo
  che sparisce in hover.
- **Hover:** riempimento `raise` su tutta la riga come aiuto alla scansione; il bersaglio vero è
  il bottone-icona, che in hover vira verso l'inchiostro e prende l'anello interno.

### Inputs
- **Style:** fondo `ground` dentro una testata `surface` (il campo è incassato, non rialzato),
  bordo filetto, raggio 8px, icona di ricerca in `ink-3` a sinistra, pulsante di svuotamento a
  destra che compare solo quando c'è testo.
- **Focus:** bordo sul colore di fuoco, fondo che passa a superficie, alone da 3px.
- **Placeholder:** `ink-2`, mai `ink-3`: deve restare sopra 4.5:1.

### Sections
`<details>` nativo con marcatore sostituito da un chevron che ruota di 90°. Intestazione
maiuscola 11px, conteggio allineato a destra sempre numerico — **0 si scrive**, perché "nessuno"
e "non ancora caricato" non possono avere lo stesso aspetto.

### Il blocco del sito corrente
Prima cosa dentro lo scorrimento del popup: l'host in 12.5px/600 con le azioni di sito a
destra, poi le stesse righe della card al checkout, nello stesso ordine e con gli stessi
chip. Niente intestazioni per fonte come nei risultati di ricerca — il colore del chip
basta, ed e' esattamente cosi' che funziona la card. Il blocco sparisce mentre si cerca,
come il riepilogo del catalogo: guardare dove si e' e cercare sono due compiti diversi.

Ogni riga porta il divieto ("non c'entra nulla con questo sito"), che prima viveva solo
dentro la card al checkout: il gesto per correggere un abbinamento sbagliato non deve
richiedere di arrivare a pagare. Le due icone nuove condividono la sbarra a 45 gradi
perche' dicono la stessa cosa a due livelli — `bell-off` sul sito, `ban` sulla riga.

### Empty states
Ogni lista vuota spiega l'interfaccia invece di annunciare il vuoto: titolo in grassetto 12.5px
più una frase che dice da dove arrivano quei dati e come farli comparire.

### Feedback boxes
Riga icona + testo su fondo tinto con bordo della stessa famiglia. Due varianti: ambra
(recuperabile) e rossa (guasto). La variante rossa può contenere un bottone di ripristino.

## Do's and Don'ts

**Do**
- Usa la riga e il filetto per ogni nuova lista; se ti serve un contenitore, probabilmente ti
  serve una sezione.
- Dai a ogni controllo interattivo i suoi stati completi: riposo, hover, focus visibile, attivo,
  disabilitato, e — se lavora — `busy`.
- Scrivi i numeri con le cifre tabulari e scrivi lo zero.
- Tara ogni testo secondario su `ink-2`; `ink-3` è per icone a riposo, conteggi e separatori.
- Tieni il popup e la card allineati: stessi token, stesse metriche di chip e bottone. Se cambi
  uno, cambi l'altro nello stesso commit.

**Don't**
- Non introdurre una sesta tinta, e non usare verde o viola per qualcosa che non sia la fonte dati.
- Non annidare contenitori scorrevoli.
- Non mettere una quarta misura di testo.
- Non usare emoji o glifi al posto di un'icona del set.
- Non nascondere lo stato del catalogo per far sembrare l'interfaccia più pulita: un catalogo
  vecchio o parziale è la causa numero uno dei risultati sbagliati.
- Non annunciare a un lettore di schermo un'intera lista di risultati a ogni tasto: annuncia il
  conteggio in un nodo `role="status"` separato.
