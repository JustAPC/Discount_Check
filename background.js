// Discount Check - service worker: crawl del portale, indici, matching.
const PORTAL = "https://almaviva.convenzioniaziendali.it";
// Catalogo Revolut, servito da sconti-api. Sola lettura e nessun segreto: sta qui.
const REVOLUT_API = "https://sconti-api.andreapontillo.tech";
// Catalogo Klarna: è la stessa API JSON che alimenta klarna.com/it/store, pubblica e
// senza chiave. Niente crawl e niente server di mezzo: la chiama il service worker.
const KLARNA_API = "https://www.klarna.com/it/api/store-edge-rest/public/stores/directory/search/IT";
const KLARNA_PAGE = 100; // oltre 100 per pagina l'API risponde con zero negozi
const CONC = 4; // fetch in parallelo durante il crawl
const PARSE_V = 3; // versione di parseOffer: bumpala e la sync ri-scarica tutto
const SAVE_EVERY = 10; // batch tra un salvataggio e l'altro
const MIN_TOKEN = 7; // lunghezza minima di un token per valere da solo come chiave
const COLLAPSE_MIN = 50; // sotto questa taglia un catalogo può dimezzarsi per motivi veri
const SNOOZE_MS = 2 * 60 * 60 * 1000;
const NUDGE_MS = 24 * 60 * 60 * 1000;

const AFFILIATE = /(tradetracker|awin|zanox|webgains|affilinet|tradedoubler|daisycon|belboon|effiliation)\./;
const VOUCHER_SHOP = /vouchers-at-work\.com$/;

// Link che stanno sulla scheda ma non sono il negozio: la mappa del punto vendita, la
// pagina social, il numero WhatsApp. Presi per buoni diventano il dominio dell'offerta,
// e cinque convenzioni di mobili e hotel finiscono per comparire su google.com.
const NOT_SHOP =
  /(^|\.)(google\.[a-z.]+|goo\.gl|facebook\.com|instagram\.com|youtube\.com|youtu\.be|linkedin\.com|twitter\.com|x\.com|wa\.me|t\.me)$/;

const get = (k) => chrome.storage.local.get(k);
const set = (o) => chrome.storage.local.set(o);

// --- lifecycle -------------------------------------------------------------

// L'alarm che riprende il crawl interrotto esiste solo mentre un crawl è in corso.
// Prima veniva creato una volta e non si spegneva più: ~1440 risvegli al giorno del
// service worker per leggere una coda che è vuota tutto il giorno tranne pochi minuti.
const watchQueue = () => chrome.alarms.create("resume", { periodInMinutes: 1 });
const unwatchQueue = () => chrome.alarms.clear("resume");

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create("daily", { periodInMinutes: 1440, delayInMinutes: 1 });
  // Gli indici sono derivati dai cataloghi con le regole di nameKeys, che cambiano da
  // una versione all'altra: vanno rifatti subito dai cataloghi già in storage. Senza,
  // una correzione al matching resterebbe invisibile per tutta la durata del crawl —
  // minuti in cui il badge continua a dire quello che diceva prima.
  const { catalog = { offers: {} } } = await get("catalog");
  await rebuild(catalog);
  await rebuildRev();
  await rebuildKl();
  // Tutte e tre le fonti, non solo il portale: appena installata l'estensione deve
  // essere utile subito, senza aspettare l'alarm giornaliero o i bottoni singoli.
  sync();
  syncRevolut();
  syncKlarna();
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create("daily", { periodInMinutes: 1440 });
  // Browser chiuso a metà crawl: la coda è ancora in storage, la sveglia va rimessa
  // o quel crawl non ripartirebbe più da solo.
  const { sync: st, queue = [] } = await get(["sync", "queue"]);
  if (st && st.state === "running" && queue.length) watchQueue();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "daily") {
    sync();
    syncRevolut();
    syncKlarna();
  }
  if (a.name === "resume") resume();
});

// Il service worker può essere terminato a metà crawl: qui si riprende la coda.
async function resume() {
  const { sync: st, queue = [] } = await get(["sync", "queue"]);
  if (st && st.state === "running" && queue.length && !running) drain();
}

// --- fetch dal portale -----------------------------------------------------

class LoginError extends Error {
  // reason: 'nocreds' (non ancora inserite in dashboard) | 'failed' (rifiutate dal portale)
  //       | 'disclaimer' (il gate riservatezza non si è lasciato confermare)
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

// Credenziali del portale: le scrive l'utente nella dashboard e restano in
// chrome.storage.local, su questo computer. Mai nel repo né nel pacchetto.
async function creds() {
  const { creds: c } = await get("creds");
  return c && c.email && c.password ? c : null;
}

// Il form del portale è POST /login con campi loginData[...], senza CSRF token.
// Dopo il login riuscito la risposta è la home, che contiene /logout.
async function doLogin() {
  const c = await creds();
  if (!c) return "nocreds";
  const r = await fetch(PORTAL + "/login", {
    method: "POST",
    credentials: "include",
    redirect: "follow",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      "loginData[email]": c.email,
      "loginData[password]": c.password,
      "cbg3-submit": "Accedi",
    }),
  });
  return (await r.text()).includes("/logout") ? "ok" : "failed";
}

// Al primo accesso di ogni sessione il portale mostra il gate "Riservatezza sulle
// convenzioni!": risponde 200 e con /logout dentro, ma serve la home al posto di ogni
// scheda, quindi senza confermarlo il crawl finisce con catalogo 0. Il form non ha
// CSRF token: una POST sulla home con disclaimerAccept=1 basta.
const DISCLAIMER = "cbg-user-disclaimer--form";

async function doAccept() {
  const r = await fetch(PORTAL + "/", {
    method: "POST",
    credentials: "include",
    redirect: "follow",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ disclaimerAccept: "1", "cbg3-submit": "Conferma" }),
  });
  return !(await r.text()).includes(DISCLAIMER);
}

// Stesso motivo del login: con CONC fetch in volo una conferma sola, non quattro.
let loginP = null;
function login() {
  if (!loginP)
    loginP = doLogin().finally(() => {
      loginP = null;
    });
  return loginP;
}

let acceptP = null;
function accept() {
  if (!acceptP)
    acceptP = doAccept().finally(() => {
      acceptP = null;
    });
  return acceptP;
}

async function fetchText(path, retry = true) {
  const r = await fetch(PORTAL + path, { credentials: "include", redirect: "follow" });
  const t = await r.text();
  // Se la sessione è scaduta il portale serve la pagina di login: niente /logout.
  if (!t.includes("/logout")) {
    const res = retry ? await login() : "failed";
    if (res !== "ok") throw new LoginError(res);
    return fetchText(path, false);
  }
  if (t.includes(DISCLAIMER)) {
    if (!retry || !(await accept())) throw new LoginError("disclaimer");
    return fetchText(path, false);
  }
  return t;
}

// --- crawl -----------------------------------------------------------------

let running = false;

// La regola che decide se buttare via un crawl intero, tenuta a parte perché è l'unica
// cosa che separa "il portale è cambiato" da "aggiornato adesso, catalogo vuoto".
// seen = l'abbiamo già vista al giro precedente, quindi stavolta ci si crede.
const collapsed = (found, had, seen) => had >= COLLAPSE_MIN && found < had / 2 && !seen;

async function sync() {
  if (running) return;
  const { sync: st } = await get("sync");
  if (st && st.state === "running") return;

  // Senza credenziali il crawl può solo fallire: il portale servirebbe la pagina di
  // login a ogni richiesta. Meglio non partire e dirlo, che far girare ogni giorno una
  // sync destinata all'errore. Riparte da sola appena le credenziali vengono salvate.
  if (!(await creds())) return fail(new LoginError("nocreds"));

  running = true;
  await set({ sync: { state: "running", phase: "categorie", total: 0, done: 0 } });
  try {
    const home = await fetchText("/");
    const cats = [...new Set([...home.matchAll(/\/overview\/(\d+)/g)].map((m) => m[1]))];

    // È successo: il portale ha risposto home su ogni /offer/... e il catalogo è finito
    // con 132 offerte tutte uguali. Il titolo della home fa da sentinella per scartarle.
    const homeTitle = h1(home);

    const paths = new Set();
    for (const c of cats) {
      const h = await fetchText("/overview/" + c);
      for (const m of h.matchAll(/\/offer\/\d+\/cat\/\d+/g)) paths.add(m[0]);
    }

    const { catalog = { offers: {} } } = await get("catalog");
    const live = new Set();
    const queue = [];
    for (const p of paths) {
      const id = p.split("/")[2];
      live.add(id);
      const cur = catalog.offers[id];
      if (!cur || cur.p !== PARSE_V) queue.push(p);
    }
    // Il fallimento più insidioso: il portale cambia layout, le regex non trovano più
    // le schede, il crawl finisce senza errori con il catalogo svuotato e la dashboard
    // scrive "aggiornato adesso". Sembra tutto a posto e l'estensione è morta. Un
    // crollo improvviso lo si guarda due volte prima di crederci: se al giro dopo il
    // portale racconta ancora la stessa cosa allora è vero, e si accetta.
    const had = Object.keys(catalog.offers).length;
    const { collapse = 0 } = await get("collapse");
    if (collapsed(live.size, had, collapse)) {
      // Catalogo vecchio intatto: non si salva niente, si dice solo cos'è successo.
      await set({
        collapse: 1,
        sync: { state: "suspect", found: live.size, had, at: Date.now() },
      });
      running = false;
      return;
    }
    await set({ collapse: 0 });

    for (const id of Object.keys(catalog.offers)) if (!live.has(id)) delete catalog.offers[id];

    await set({
      catalog,
      queue,
      homeTitle,
      sync: { state: "running", phase: "offerte", total: queue.length, done: 0 },
    });
    watchQueue();
    running = false;
    await drain();
  } catch (e) {
    running = false;
    await fail(e);
  }
}

async function drain() {
  if (running) return;
  running = true;
  try {
    let {
      queue = [],
      catalog = { offers: {} },
      sync: st = {},
      homeTitle = "",
    } = await get(["queue", "catalog", "sync", "homeTitle"]);
    const total = st.total || queue.length;
    let n = 0;

    while (queue.length) {
      const batch = queue.splice(0, CONC);
      const res = await Promise.all(
        batch.map((p) =>
          fetchText(p)
            .then((h) => [p, h, null])
            .catch((e) => [p, null, e]),
        ),
      );
      for (const [p, html, err] of res) {
        if (err instanceof LoginError) {
          // Catalogo parziale conservato: meglio di niente per il match.
          await set({ queue, catalog });
          await rebuild(catalog);
          throw err;
        }
        if (html) {
          const o = parseOffer(html, p, homeTitle);
          if (o) catalog.offers[o.id] = o.v;
        }
      }
      if (++n % SAVE_EVERY === 0) {
        await set({ queue, catalog, sync: { ...st, total, done: total - queue.length } });
      }
    }

    catalog.updatedAt = Date.now();
    await set({ catalog, queue: [], sync: { state: "idle", total, done: total, at: Date.now() } });
    await rebuild(catalog);
    unwatchQueue();
  } catch (e) {
    await fail(e);
  } finally {
    running = false;
  }
}

async function fail(e) {
  // Login scaduto o errore: il crawl non riprende da solo, quindi la sveglia non serve
  // più. Riparte quando riparte la sync.
  unwatchQueue();
  const { sync: st = {} } = await get("sync");
  await set({
    sync: {
      ...st,
      state: e instanceof LoginError ? "login" : "error",
      reason: e instanceof LoginError ? e.reason : null,
      error: e instanceof LoginError ? null : String((e && e.message) || e),
    },
  });
}

// --- parsing ---------------------------------------------------------------
// Il service worker non ha DOMParser: regex sull'HTML del portale.

// Gli URL nei data-href sono HTML-encoded (https&#x3A;&#x2F;&#x2F;...): senza decode
// il crawl perde metà delle offerte.
const dec = (s) =>
  String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const strip = (s) =>
  dec(String(s || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const h1 = (html) => strip((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html) || [])[1]);

function parseOffer(html, path, homeTitle) {
  const m = /\/offer\/(\d+)\/cat\/(\d+)/.exec(path);
  if (!m) return null;
  const [, id, cat] = m;

  const title = h1(html);
  // Titolo uguale alla home: non è la scheda offerta. Meglio nessuna riga che una sbagliata,
  // e senza id in catalogo la prossima sync ci riprova.
  if (!title || (homeTitle && title === homeTitle)) return null;

  // Stessa classe è usata per lo sconto e per la distanza ("ca. 15.4 KM"): tieni la percentuale.
  let disc = "";
  for (const mm of html.matchAll(/cbg3-discount-and-location--uppercase[^>]*>([\s\S]*?)</g)) {
    const s = strip(mm[1]);
    if (/%/.test(s)) {
      disc = s;
      break;
    }
    if (!disc && !/\bkm\b/i.test(s)) disc = s;
  }

  let host = "",
    kind = "none";
  for (const mm of html.matchAll(/data-href\s*=\s*"([^"]*)"/g)) {
    const v = dec(mm[1]);
    if (/\/bookmark/.test(v)) continue;
    let u;
    try {
      u = new URL(v, PORTAL);
    } catch {
      continue;
    }
    // Il portale usa anche /generic-link?link=<url reale>
    const inner = u.searchParams.get("link");
    if (inner) {
      try {
        u = new URL(inner);
      } catch {
        /* tieni l'esterno */
      }
    }
    if (/convenzioniaziendali\.it$/.test(u.hostname)) continue;
    // Non è un break: la mappa sta spesso prima del link al sito, e scartandola
    // soltanto qui il negozio vero, se c'è, resta raggiungibile dal giro dopo.
    if (NOT_SHOP.test(u.hostname)) continue;
    host = u.hostname.replace(/^www\./, "");
    kind = VOUCHER_SHOP.test(host) ? "giftcard" : AFFILIATE.test(host) ? "affiliate" : "shop";
    break;
  }
  return { id, v: { c: cat, t: title, d: disc, h: host, k: kind, p: PARSE_V } };
}

// --- indici ----------------------------------------------------------------

const NOISE = new Set(
  (
    "gift card cards giftcard carta carte buono buoni regalo sconto sconti speciale offerta " +
    "offerte italia italy online shop store spa srl the il lo la le i gli un una di de da del della e ed and " +
    "per con su a al ai gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre " +
    "dicembre"
  ).split(" "),
);

// Token troppo comuni: da soli farebbero match su mezzo web.
const GENERIC = new Set(
  (
    "cinema cinemas viaggi viaggio hotel hotels casa moda auto sport salute benessere " +
    "energia telefonia assicurazione assicurazioni noleggio vacanze prodotti servizi abbonamento abbonamenti " +
    "terme direct partners partner center design milano roma torino napoli mondo world group punto prima extra " +
    "tempo libri vino gioco giochi"
  ).split(" "),
);

const norm = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const words = (title) =>
  norm(title)
    .split(" ")
    .filter((w) => w && !NOISE.has(w));

// Il nome intero, appiccicato. È la chiave forte: matchIds la accetta anche come
// sottostringa del dominio, nei due versi.
function nameKeys(title) {
  const t = words(title);
  return t.length ? new Set([t.join("")]) : new Set();
}

// Le singole parole di un nome composto, quando sono lunghe abbastanza da poter essere
// un marchio. È un indizio debole e sta in un indice a parte, dove matchIds pretende che
// il dominio ci cominci: serve ad agganciare "Gruppo Editoriale Mondadori" a
// mondadoristore.it, non a far credere che "Qatar Airways" c'entri con ita-airways.com.
//
// La soglia di lunghezza da sola non basta: "airways" ha sette caratteri e passerebbe.
// Un nome di una parola sola non produce niente qui, perché la chiave forte è già quella
// parola e ripeterla nell'indice debole servirebbe solo ad allentare la regola.
function wordKeys(title) {
  const t = words(title);
  const keys = new Set();
  if (t.length < 2) return keys;
  for (const w of t) if (w.length >= MIN_TOKEN && !GENERIC.has(w)) keys.add(w);
  return keys;
}

const MULTI_SLD = /\.(co|com|org|net|gov|edu|ac)\.[a-z]{2}$/;

// Domini che ospitano negozi diversi uno per sottodominio: qui il sito vero è il terzo
// livello. Senza questa lista due negozi Shopify distinti darebbero lo stesso etld1, e
// un alias o un "non c'entra nulla" messo su uno varrebbe per tutti gli altri.
const TENANT = new Set([
  "myshopify.com",
  "github.io",
  "netlify.app",
  "vercel.app",
  "pages.dev",
  "wixsite.com",
]);

function etld1(hostname) {
  const h = hostname.replace(/^www\./, "").toLowerCase();
  const p = h.split(".");
  if (p.length <= 2) return h;
  const two = p.slice(-2).join(".");
  if (TENANT.has(two)) return p.slice(-3).join(".");
  return MULTI_SLD.test(h) ? p.slice(-3).join(".") : two;
}

// Il "nome" del dominio: ita-airways.com → itaairways. Un dominio conosciuto vale anche
// sulle altre estensioni dello stesso marchio — chi sa che Nike è nike.com non deve poi
// elencare a mano nike.it e nike.co.uk.
const domLabel = (hostname) => etld1(hostname).split(".")[0].replace(/-/g, "");

// Accetta sia "nike.it" sia l'URL intero incollato dalla barra. La dashboard già ripulisce
// prima di mandare, ma etld1 da solo non lo fa: un path finito dentro la chiave produrrebbe
// un alias che non matcha mai, e nessuno se ne accorgerebbe. Stessa tolleranza che ha
// /revolut/domains sul server, così lo stesso incollato funziona nei due posti.
const hostOf = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .split(/[/?#]/)[0];

async function rebuild(catalog) {
  const { aliases = {} } = await get("aliases");
  const dom = {},
    lab = {},
    name = {},
    word = {};
  for (const [id, o] of Object.entries(catalog.offers)) {
    if (o.k === "shop" && o.h) {
      (dom[etld1(o.h)] ||= []).push(id);
      (lab[domLabel(o.h)] ||= []).push(id);
    }
    // Qui il nome resta indicizzato anche quando un link c'è, al contrario di Revolut e
    // Klarna: il link del portale non è sempre il sito del negozio. Circa un'offerta su
    // cinque punta a un portale convenzione dedicato (convenzionipiaggio.com,
    // iltuoticket.it) e una su dieci al gift card shop. Fidarsi di quel dominio come se
    // fosse il negozio spegnerebbe il match sul marchio proprio dove serve.
    for (const k of nameKeys(o.t)) (name[k] ||= []).push(id);
    for (const k of wordKeys(o.t)) (word[k] ||= []).push(id);
  }
  // Gli alias sono l'unica parte dell'indice che non deriva dal catalogo: senza
  // riapplicarli qui, ogni collegamento fatto a mano dalla dashboard sopravviveva
  // fino alla sync successiva e poi spariva senza dire niente. Revolut e Klarna lo
  // facevano già; questa era l'unica fonte a perderli.
  for (const [d, ids] of Object.entries(aliases)) {
    for (const id of ids) if (catalog.offers[id]) (dom[d] ||= []).push(id);
  }
  await set({ idx: { dom, lab, name, word } });
}

// --- Revolut ---------------------------------------------------------------
// Seconda fonte: catalogo dei moltiplicatori RevPoints servito da sconti-api.
// Endpoint e credenziali stanno in storage, mai nel codice: il repo resta pubblicabile.

async function syncRevolut() {
  // Lo stato lo mette la sync stessa, non chi la chiama: così "Aggiorna tutto",
  // il bottone singolo e l'alarm giornaliero si vedono tutti in dashboard.
  await set({ revSync: { state: "running", at: Date.now() } });
  try {
    // Nessun header custom: niente credenziali nel browser, niente preflight CORS.
    const r = await fetch(REVOLUT_API + "/revolut/offers");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    // Solo dati validi sovrascrivono la cache: se il NAS non risponde si tiene l'ultima lista.
    await set({
      revolut: { offers: data.offers || [], at: Date.now(), updatedAt: data.updated_at || null },
      revSync: { state: "idle", at: Date.now() },
    });
    await rebuildRev();
  } catch (e) {
    await set({ revSync: { state: "error", error: String((e && e.message) || e), at: Date.now() } });
  }
}

// Stessa forma dell'indice CB, così matchIds() vale per tutte le fonti. Qui la "chiave"
// di un'offerta è il name_key, non un id numerico.
//
// Revolut e Klarna condividono anche la regola, e per un motivo che il portale non ha: il
// loro dominio è davvero quello del negozio — curato a mano per Revolut, letto da
// merchantUrl per Klarna. Quindi quando c'è **sostituisce** la congettura sul nome invece
// di affiancarla, e il negozio esce dagli indici sui nomi. È così che "Qatar Airways"
// smette di poter comparire su ita-airways.com: non per una regola più stretta, ma perché
// di quel negozio si sa il sito e non serve più indovinarlo.
//
// Di conseguenza l'alias locale per quel negozio non serve più, e va cancellato: se
// restasse, continuerebbe a sovrascrivere per sempre il dato buono appena arrivato.
function storeIndex(offers, aliases) {
  const dom = {},
    lab = {},
    name = {},
    word = {};
  const known = new Set();
  for (const o of offers) {
    if (o.domain) {
      known.add(o.name_key);
      (dom[etld1(o.domain)] ||= []).push(o.name_key);
      (lab[domLabel(o.domain)] ||= []).push(o.name_key);
      continue;
    }
    for (const k of nameKeys(o.name)) (name[k] ||= []).push(o.name_key);
    for (const k of wordKeys(o.name)) (word[k] ||= []).push(o.name_key);
  }
  const kept = {};
  for (const [d, keys] of Object.entries(aliases)) {
    const live = keys.filter((k) => !known.has(k));
    if (live.length) kept[d] = live;
    for (const k of live) (dom[d] ||= []).push(k);
  }
  return { idx: { dom, lab, name, word }, aliases: kept };
}

async function rebuildRev() {
  const { revolut = { offers: [] }, revAliases = {} } = await get(["revolut", "revAliases"]);
  const r = storeIndex(revolut.offers || [], revAliases);
  await set({ ridx: r.idx });
  if (JSON.stringify(r.aliases) !== JSON.stringify(revAliases)) {
    await set({ revAliases: r.aliases });
  }
}

// --- Klarna ----------------------------------------------------------------
// Terza fonte: i negozi Klarna che danno cashback. Il cashback non è automatico al
// checkout del sito — si sblocca solo comprando dentro la Klarna app — quindi qui è
// un promemoria, non un'azione: nessun bottone, come per Revolut.

const nameKey = (s) => norm(s).replace(/ /g, "");
const cleanDomain = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0] || null;

// Il tasso arriva in centesimi di punto (150 = 1,5%). Il dominio vero sta solo dentro
// otcUrl (?merchantUrl=unieuro.it): storeUrl è uno slug di klarna.com, non del negozio.
function klOffer(s) {
  const cb = s && s.cashbackDiscount;
  const rate = cb && +cb.discountPercentage / 100;
  const name = s && s.displayName;
  if (!rate || !name) return null;
  const m = /merchantUrl=([^&]+)/.exec(s.otcUrl || "");
  let domain = null;
  if (m) {
    try {
      domain = cleanDomain(decodeURIComponent(m[1]));
    } catch {
      domain = cleanDomain(m[1]);
    }
  }
  return {
    name,
    name_key: nameKey(name),
    rate,
    domain,
    // "fino a": Klarna dichiara un tetto, non un tasso garantito. Meglio dirlo nel chip.
    label: (cb.showUpToPrefix ? "fino a " : "") + rate.toLocaleString("it-IT") + "%",
  };
}

async function syncKlarna() {
  await set({ klSync: { state: "running", at: Date.now() } });
  try {
    // Klarna elenca lo stesso brand più volte con tassi diversi ("G-Star Raw" 4% e
    // "G Star RAW" 2%): stessa chiave, si tiene il tasso migliore.
    const best = new Map();
    for (let offset = 0, total = KLARNA_PAGE; offset < total; offset += KLARNA_PAGE) {
      const r = await fetch(`${KLARNA_API}?sort=RANK&cashback=true&offset=${offset}&size=${KLARNA_PAGE}`);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const page = Array.isArray(d.stores) ? d.stores : [];
      if (!page.length) break; // senza questo un totalHits gonfiato girerebbe a vuoto
      total = Math.min(+d.totalHits || 0, 2000);
      for (const s of page) {
        const o = klOffer(s);
        if (!o) continue;
        const cur = best.get(o.name_key);
        if (!cur || o.rate > cur.rate) best.set(o.name_key, o);
      }
    }
    const offers = [...best.values()];
    // Come per Revolut: solo una lista sensata sovrascrive la cache, altrimenti si tiene
    // l'ultima buona. Una risposta vuota di Klarna non deve svuotare il catalogo.
    if (!offers.length) throw new Error("nessun negozio con cashback nella risposta");
    await set({
      klarna: { offers, at: Date.now() },
      klSync: { state: "idle", at: Date.now() },
    });
    await rebuildKl();
  } catch (e) {
    await set({ klSync: { state: "error", error: String((e && e.message) || e), at: Date.now() } });
  }
}

async function rebuildKl() {
  const { klarna = { offers: [] }, klAliases = {} } = await get(["klarna", "klAliases"]);
  const r = storeIndex(klarna.offers || [], klAliases);
  await set({ kidx: r.idx });
  if (JSON.stringify(r.aliases) !== JSON.stringify(klAliases)) {
    await set({ klAliases: r.aliases });
  }
}

// --- matching --------------------------------------------------------------

function matchIds(hostname, idx) {
  const d = etld1(hostname);
  const label = domLabel(hostname);
  const clean = label.replace(/^(shop|store|my|www)/, "").replace(/(shop|store|online|italia|it)$/, "");
  const ids = new Set(idx.dom[d] || []);

  // Stesso marchio, altra estensione: nike.com conosciuto aggancia anche nike.it. È un
  // confronto esatto fra nomi di dominio, quindi due letture dirette e nessuna scansione.
  for (const k of [label, clean]) for (const id of (idx.lab || {})[k] || []) ids.add(id);

  for (const [k, list] of Object.entries(idx.name)) {
    const hit =
      k === label ||
      k === clean ||
      (k.length >= 6 && (label.includes(k) || (label.length >= 6 && k.includes(label))));
    if (hit) for (const id of list) ids.add(id);
  }
  // Indice debole: una parola sola presa da un nome composto si crede solo se il dominio
  // ci comincia. I marchi mettono il nome davanti e il settore dietro — ita-airways,
  // mondadoristore — quindi il prefisso separa chi è il negozio da che cosa vende.
  for (const [k, list] of Object.entries(idx.word || {})) {
    if (label.startsWith(k) || clean.startsWith(k)) for (const id of list) ids.add(id);
  }
  return [...ids];
}

// --- iniezione condizionale ------------------------------------------------
// Il content script non sta più su ogni pagina che apri: qui si guarda l'hostname
// della tab contro gli indici che abbiamo già e si inietta solo dove c'è davvero
// qualcosa da dire. Sui siti non convenzionati non gira una riga di codice nostro.
//
// L'accesso ai siti è un permesso opzionale: finché non lo concedi dalla dashboard,
// tab.url arriva vuoto e questo listener non fa nulla — nessun errore, solo silenzio.

const SHOP_ORIGINS = { origins: ["http://*/*", "https://*/*"] };

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // "complete" = caricamento vero finito; un url senza status = navigazione SPA.
  // L'url che accompagna lo status "loading" si scarta apposta: è lo stesso evento
  // di "complete" visto due volte, e ci farebbe rileggere lo storage per niente.
  if (info.status ? info.status !== "complete" : !info.url) return;
  const url = info.url || (tab && tab.url) || "";
  if (!/^https?:/.test(url)) return;
  visit(tabId, url).catch(() => {
    /* tab sparita a metà: non è un errore */
  });
});

async function visit(tabId, url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  const res = await checkHost(host);
  // Il badge si aggiorna comunque: prima dipendeva dal content script, quindi sui siti
  // dove non veniva mostrato niente restava quello della tab precedente.
  setBadge(tabId, res);
  if (res.muted) return;

  const has = res.offers.length || res.rev.length || res.kl.length;
  // Catalogo mai scaricato: la card di setup esce al massimo una volta al giorno, quindi
  // fuori da quella finestra non vale la pena iniettare per poi non mostrare nulla.
  if (!has && !(res.empty && (await nudgeOpen()))) return;
  // "Ricordamelo dopo": per due ore la card non uscirebbe comunque. Il badge sì, ed è
  // già stato messo sopra — chi ha messo lo snooze può ancora aprire la dashboard.
  if (has && res.snoozed && !res.needLogin) return;

  try {
    // content.js si difende da solo dalla doppia iniezione (SPA che rinavigano).
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {
    /* tab chiusa, pagina protetta dal browser, permesso revocato */
  }
}

function setBadge(tabId, res) {
  const skip = () => {}; // la tab può sparire mentre rispondiamo
  const n = res.muted ? 0 : res.offers.length + res.rev.length + res.kl.length;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : "" }).catch(skip);
  // Ambra se il conteggio c'è ma la sessione al portale è scaduta: il numero è vero,
  // per usarlo serve rifare login. Senza numero il colore non si vede: non lo tocchiamo.
  if (n) {
    chrome.action
      .setBadgeBackgroundColor({ tabId, color: res.needLogin ? "#b45309" : "#16a34a" })
      .catch(skip);
  }
}

async function nudgeOpen() {
  const { lastNudge = 0 } = await get("lastNudge");
  return Date.now() - lastNudge >= NUDGE_MS;
}

// Cosa abbiamo per questo hostname. La usano sia il listener sulle tab (per decidere
// se iniettare) sia il content script una volta iniettato: una regola sola.
async function checkHost(host) {
  const st = await get([
    "catalog",
    "idx",
    "blocked",
    "muted",
    "snooze",
    "sync",
    "revolut",
    "ridx",
    "revBlocked",
    "klarna",
    "kidx",
    "klBlocked",
  ]);
  const catalog = st.catalog || { offers: {} };
  const d = etld1(host);
  const base = {
    offers: [],
    rev: [],
    kl: [],
    domain: d,
    needLogin: !!(st.sync && st.sync.state === "login"),
    empty: Object.keys(catalog.offers).length === 0,
  };

  if ((st.muted || []).includes(d)) return { ...base, muted: true };

  const blocked = new Set((st.blocked || {})[d] || []);
  const offers = matchIds(host, st.idx || { dom: {}, name: {} })
    .filter((id) => !blocked.has(id) && catalog.offers[id])
    .map((id) => ({ id, ...catalog.offers[id] }))
    .sort((a, b) => (b.k === "shop") - (a.k === "shop"))
    .slice(0, 5);

  // Revolut e Klarna hanno la stessa forma: una lista di negozi con name_key.
  const byName = (list, idx, blk) => {
    const byKey = Object.fromEntries(list.map((o) => [o.name_key, o]));
    const hidden = new Set(blk[d] || []);
    return [...new Set(matchIds(host, idx || { dom: {}, name: {} }))]
      .filter((k) => !hidden.has(k) && byKey[k])
      .map((k) => byKey[k])
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 3);
  };

  const until = (st.snooze || {})[d] || 0;
  return {
    ...base,
    offers,
    rev: byName((st.revolut || {}).offers || [], st.ridx, st.revBlocked || {}),
    kl: byName((st.klarna || {}).offers || [], st.kidx, st.klBlocked || {}),
    snoozed: Date.now() < until,
    // La dashboard lo mostra per esteso: "in pausa" senza dire fino a quando è uno
    // stato che l'utente non può né verificare né disfare consapevolmente.
    snoozeUntil: until,
    stale: catalog.updatedAt ? Date.now() - catalog.updatedAt > 3 * NUDGE_MS : false,
  };
}

// --- messaggi dal content script / dashboard -------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  handle(msg)
    .then(reply)
    .catch((e) => reply({ error: String((e && e.message) || e) }));
  return true;
});

async function handle(msg) {
  // Il badge lo ha già messo visit(): qui si risponde solo al content script,
  // che a questo punto è già stato iniettato proprio perché c'era qualcosa.
  if (msg.type === "check") return checkHost(msg.host);

  // Cosa c'è sul sito della tab aperta. La dashboard lo chiede per mostrare le stesse
  // righe della card al checkout: dal badge si legge che c'è qualcosa, non che cosa.
  // Senza il permesso sui siti tab.url arriva vuoto, e "page: false" copre anche quello.
  if (msg.type === "current") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = (tab && tab.url) || "";
    if (!/^https?:/.test(url)) return { page: false };
    try {
      return { page: true, ...(await checkHost(new URL(url).hostname)) };
    } catch {
      return { page: false };
    }
  }

  if (msg.type === "nudge") {
    // catalogo vuoto: avviso max 1 volta al giorno
    if (!(await nudgeOpen())) return { show: false };
    await set({ lastNudge: Date.now() });
    return { show: true };
  }

  if (msg.type === "open") {
    await chrome.tabs.create({ url: `${PORTAL}/offer/${msg.id}/cat/${msg.cat}` });
    return { ok: true };
  }

  if (msg.type === "openPortal") {
    await chrome.tabs.create({ url: PORTAL + (msg.path || "/") });
    return { ok: true };
  }

  if (msg.type === "snooze") {
    const { snooze = {} } = await get("snooze");
    snooze[msg.domain] = Date.now() + SNOOZE_MS;
    await set({ snooze });
    return { ok: true };
  }

  if (msg.type === "unsnooze") {
    const { snooze = {} } = await get("snooze");
    delete snooze[msg.domain];
    await set({ snooze });
    return { ok: true };
  }

  if (msg.type === "mute") {
    const { muted = [] } = await get("muted");
    if (!muted.includes(msg.domain)) muted.push(msg.domain);
    await set({ muted });
    return { ok: true };
  }

  if (msg.type === "unmute") {
    const { muted = [] } = await get("muted");
    await set({ muted: muted.filter((d) => d !== msg.domain) });
    return { ok: true };
  }

  if (msg.type === "report") {
    // "questa offerta non c'entra con questo sito". Dalla card arrivano tutte e tre le
    // fonti insieme; dalla dashboard una riga sola, quindi le liste vuote vanno saltate
    // o lo storage si riempie di domini con zero segnalazioni.
    if ((msg.ids || []).length) {
      const { blocked = {} } = await get("blocked");
      const list = new Set(blocked[msg.domain] || []);
      msg.ids.forEach((i) => list.add(i));
      blocked[msg.domain] = [...list];
      await set({ blocked });
    }

    if ((msg.revKeys || []).length) {
      // stesso gesto, altra fonte
      const { revBlocked = {} } = await get("revBlocked");
      const rl = new Set(revBlocked[msg.domain] || []);
      msg.revKeys.forEach((k) => rl.add(k));
      revBlocked[msg.domain] = [...rl];
      await set({ revBlocked });
    }

    if ((msg.klKeys || []).length) {
      const { klBlocked = {} } = await get("klBlocked");
      const kl = new Set(klBlocked[msg.domain] || []);
      msg.klKeys.forEach((k) => kl.add(k));
      klBlocked[msg.domain] = [...kl];
      await set({ klBlocked });
    }
    return { ok: true };
  }

  if (msg.type === "unreport") {
    const { blocked = {} } = await get("blocked");
    blocked[msg.domain] = (blocked[msg.domain] || []).filter((i) => i !== msg.id);
    if (!blocked[msg.domain].length) delete blocked[msg.domain];
    await set({ blocked });
    return { ok: true };
  }

  if (msg.type === "alias") {
    // collega a mano un'offerta a un dominio
    const { aliases = {} } = await get("aliases");
    const d = etld1(hostOf(msg.domain));
    aliases[d] = [...new Set([...(aliases[d] || []), msg.id])];
    await set({ aliases });
    // Come revAlias e klAlias: si scrive l'alias e si lascia ricostruire l'indice a
    // rebuild(), invece di rattoppare idx a mano. Una via sola per arrivarci.
    const { catalog = { offers: {} } } = await get("catalog");
    await rebuild(catalog);
    return { ok: true, domain: d };
  }

  if (msg.type === "unalias") {
    const { aliases = {} } = await get("aliases");
    aliases[msg.domain] = (aliases[msg.domain] || []).filter((i) => i !== msg.id);
    if (!aliases[msg.domain].length) delete aliases[msg.domain];
    await set({ aliases });
    const { catalog = { offers: {} } } = await get("catalog");
    await rebuild(catalog);
    return { ok: true };
  }

  if (msg.type === "sync") {
    sync();
    return { ok: true };
  }

  // Le tre fonti sono indipendenti: partono insieme, il crawl CB è lento e le altre no.
  if (msg.type === "syncAll") {
    sync();
    syncRevolut();
    syncKlarna();
    return { ok: true };
  }

  if (msg.type === "revSync") {
    await syncRevolut();
    return { ok: true };
  }

  if (msg.type === "klSync") {
    await syncKlarna();
    return { ok: true };
  }

  if (msg.type === "klAlias") {
    // collega a mano un negozio Klarna a un dominio
    const { klarna = { offers: [] }, klAliases = {} } = await get(["klarna", "klAliases"]);
    const o = (klarna.offers || []).find((x) => x.name_key === msg.key);
    if (o && o.domain) return { ok: true, superseded: o.domain };
    const d = etld1(hostOf(msg.domain));
    klAliases[d] = [...new Set([...(klAliases[d] || []), msg.key])];
    await set({ klAliases });
    await rebuildKl();
    return { ok: true, domain: d };
  }

  if (msg.type === "klUnalias") {
    const { klAliases = {} } = await get("klAliases");
    klAliases[msg.domain] = (klAliases[msg.domain] || []).filter((k) => k !== msg.key);
    if (!klAliases[msg.domain].length) delete klAliases[msg.domain];
    await set({ klAliases });
    await rebuildKl();
    return { ok: true };
  }

  if (msg.type === "klUnreport") {
    const { klBlocked = {} } = await get("klBlocked");
    klBlocked[msg.domain] = (klBlocked[msg.domain] || []).filter((k) => k !== msg.key);
    if (!klBlocked[msg.domain].length) delete klBlocked[msg.domain];
    await set({ klBlocked });
    return { ok: true };
  }

  if (msg.type === "revAlias") {
    // collega a mano un negozio Revolut a un dominio
    const { revolut = { offers: [] }, revAliases = {} } = await get(["revolut", "revAliases"]);
    // Se il catalogo sa già dov'è questo negozio, l'alias verrebbe cancellato dal primo
    // rebuild: meglio non crearlo e dire perché, che lasciare l'utente davanti a un
    // bottone premuto e a nessun effetto.
    const o = (revolut.offers || []).find((x) => x.name_key === msg.key);
    if (o && o.domain) return { ok: true, superseded: o.domain };
    const d = etld1(hostOf(msg.domain));
    revAliases[d] = [...new Set([...(revAliases[d] || []), msg.key])];
    await set({ revAliases });
    await rebuildRev();
    return { ok: true, domain: d };
  }

  if (msg.type === "revUnalias") {
    const { revAliases = {} } = await get("revAliases");
    revAliases[msg.domain] = (revAliases[msg.domain] || []).filter((k) => k !== msg.key);
    if (!revAliases[msg.domain].length) delete revAliases[msg.domain];
    await set({ revAliases });
    await rebuildRev();
    return { ok: true };
  }

  if (msg.type === "revUnreport") {
    const { revBlocked = {} } = await get("revBlocked");
    revBlocked[msg.domain] = (revBlocked[msg.domain] || []).filter((k) => k !== msg.key);
    if (!revBlocked[msg.domain].length) delete revBlocked[msg.domain];
    await set({ revBlocked });
    return { ok: true };
  }

  if (msg.type === "setCreds") {
    const email = (msg.email || "").trim();
    // Password vuota = "lascia quella che c'è": la dashboard non la rilegge mai.
    const { creds: cur = {} } = await get("creds");
    const password = msg.password || cur.password || "";
    if (!email || !password) return { error: "Servono email e password" };
    await set({ creds: { email, password } });
    // Il crawl era fermo proprio perché mancavano queste: appena ci sono, riparte.
    sync();
    return { ok: true };
  }

  if (msg.type === "clearCreds") {
    await chrome.storage.local.remove("creds");
    return { ok: true };
  }

  if (msg.type === "state") {
    const st = await get([
      "catalog",
      "sync",
      "blocked",
      "muted",
      "snooze",
      "aliases",
      "revAliases",
      "klAliases",
      "revolut",
      "revSync",
      "revBlocked",
      "klarna",
      "klSync",
      "klBlocked",
      "creds",
    ]);
    const offers = (st.catalog || {}).offers || {};
    const revolut = st.revolut || { offers: [] };
    const klarna = st.klarna || { offers: [] };
    return {
      sync: st.sync || { state: "idle" },
      updatedAt: (st.catalog || {}).updatedAt || 0,
      count: Object.keys(offers).length,
      withDomain: Object.values(offers).filter((o) => o.k === "shop" && o.h).length,
      giftcards: Object.values(offers).filter((o) => o.k === "giftcard").length,
      blocked: st.blocked || {},
      muted: st.muted || [],
      // Le pause scadute restano scritte finche' non si ripassa sul sito: qui non
      // vanno mostrate, quindi si filtrano subito invece di far finta in dashboard.
      snooze: Object.fromEntries(
        Object.entries(st.snooze || {}).filter(([, until]) => until > Date.now()),
      ),
      aliases: st.aliases || {},
      revAliases: st.revAliases || {},
      klAliases: st.klAliases || {},
      offers,
      revolut: { offers: revolut.offers || [], at: revolut.at || 0 },
      revSync: st.revSync || { state: "idle" },
      revBlocked: st.revBlocked || {},
      klarna: { offers: klarna.offers || [], at: klarna.at || 0 },
      klSync: st.klSync || { state: "idle" },
      klBlocked: st.klBlocked || {},
      // La password non esce mai da qui: la dashboard sa solo se c'è.
      creds: { email: (st.creds || {}).email || "", saved: !!(st.creds || {}).password },
      version: chrome.runtime.getManifest().version,
      // Senza questo permesso l'estensione non si fa viva su nessun sito: la dashboard
      // deve poterlo dire, perché da fuori sembrerebbe solo che non trova mai niente.
      shopAccess: await chrome.permissions.contains(SHOP_ORIGINS),
    };
  }

  return { error: "unknown" };
}
