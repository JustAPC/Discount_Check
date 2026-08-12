// Discount Check - service worker: crawl del portale, indici, matching.
const PORTAL = "https://almaviva.convenzioniaziendali.it";
// Catalogo Revolut, servito da sconti-api. Sola lettura e nessun segreto: sta qui.
const REVOLUT_API = "https://sconti-api.andreapontillo.tech";
// Catalogo Klarna: è la stessa API JSON che alimenta klarna.com/it/store, pubblica e
// senza chiave. Niente crawl e niente server di mezzo: la chiama il service worker.
const KLARNA_API = "https://www.klarna.com/it/api/store-edge-rest/public/stores/directory/search/IT";
const KLARNA_PAGE = 100; // oltre 100 per pagina l'API risponde con zero negozi
// L'estensione si distribuisce a mano: qui si guarda se c'è una release più nuova.
// La version si legge dal manifest servito da GitHub Pages, non dall'API: l'API ha
// 60 richieste/ora per IP e le si esaurisce con altro, restituendo 403 in silenzio.
const LATEST_MANIFEST = "https://justapc.github.io/Discount_Check/manifest.json";
const RELEASES_PAGE = "https://github.com/JustAPC/Discount_Check/releases/latest";
const BADGE_UPDATE = "#dc2626";
const CONC = 4; // fetch in parallelo durante il crawl
const PARSE_V = 2; // versione di parseOffer: bumpala e la sync ri-scarica tutto
const SAVE_EVERY = 10; // batch tra un salvataggio e l'altro
const SNOOZE_MS = 2 * 60 * 60 * 1000;
const NUDGE_MS = 24 * 60 * 60 * 1000;

const AFFILIATE = /(tradetracker|awin|zanox|webgains|affilinet|tradedoubler|daisycon|belboon|effiliation)\./;
const VOUCHER_SHOP = /vouchers-at-work\.com$/;

const get = (k) => chrome.storage.local.get(k);
const set = (o) => chrome.storage.local.set(o);

// --- lifecycle -------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("daily", { periodInMinutes: 1440, delayInMinutes: 1 });
  chrome.alarms.create("resume", { periodInMinutes: 1 });
  sync();
  checkUpdate();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("daily", { periodInMinutes: 1440 });
  chrome.alarms.create("resume", { periodInMinutes: 1 });
  checkUpdate();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "daily") {
    sync();
    syncRevolut();
    syncKlarna();
    checkUpdate();
  }
  if (a.name === "resume") resume();
});

// --- aggiornamenti dell'estensione -----------------------------------------
// Distribuita a mano (zip da GitHub Releases), quindi Chrome non aggiorna nulla:
// l'unica cosa che possiamo fare è accorgercene e dirlo.

async function checkUpdate() {
  try {
    const r = await fetch(LATEST_MANIFEST, { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const latest = String((await r.json()).version || "");
    if (!/^\d+(\.\d+)*$/.test(latest)) return;
    const has = newer(latest, chrome.runtime.getManifest().version);
    await set({ update: has ? { version: latest, url: RELEASES_PAGE } : null });
    // Badge di default: vale sulle tab dove nessun content script ha ancora parlato.
    chrome.action.setBadgeText({ text: has ? "!" : "" });
    if (has) chrome.action.setBadgeBackgroundColor({ color: BADGE_UPDATE });
  } catch {
    /* Pages non raggiungibile: si riprova al prossimo giro */
  }
}

// "1.10.0" è più recente di "1.9.0": confronto campo per campo, non lessicografico.
function newer(a, b) {
  const pa = a.split(".").map(Number),
    pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

// Il service worker può essere terminato a metà crawl: qui si riprende la coda.
async function resume() {
  const { sync: st, queue = [] } = await get(["sync", "queue"]);
  if (st && st.state === "running" && queue.length && !running) drain();
}

// --- fetch dal portale -----------------------------------------------------

class LoginError extends Error {
  // reason: 'nocreds' (non ancora inserite in dashboard) | 'failed' (rifiutate dal portale)
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

// Durante il crawl ci sono CONC fetch in volo: un solo login condiviso, non quattro.
let loginP = null;
function login() {
  if (!loginP)
    loginP = doLogin().finally(() => {
      loginP = null;
    });
  return loginP;
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
  return t;
}

// --- crawl -----------------------------------------------------------------

let running = false;

async function sync() {
  if (running) return;
  const { sync: st } = await get("sync");
  if (st && st.state === "running") return;

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
    for (const id of Object.keys(catalog.offers)) if (!live.has(id)) delete catalog.offers[id];

    await set({
      catalog,
      queue,
      homeTitle,
      sync: { state: "running", phase: "offerte", total: queue.length, done: 0 },
    });
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
  } catch (e) {
    await fail(e);
  } finally {
    running = false;
  }
}

async function fail(e) {
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

function nameKeys(title) {
  const toks = norm(title)
    .split(" ")
    .filter((w) => w && !NOISE.has(w));
  const keys = new Set();
  if (toks.length) keys.add(toks.join(""));
  // Brand corti ("LEGO", "IKEA") solo se il titolo è già essenziale, altrimenti serve più lunghezza.
  const min = toks.length <= 2 ? 4 : 6;
  for (const w of toks) if (w.length >= min && !GENERIC.has(w)) keys.add(w);
  return keys;
}

const MULTI_SLD = /\.(co|com|org|net|gov|edu|ac)\.[a-z]{2}$/;
function etld1(hostname) {
  const h = hostname.replace(/^www\./, "").toLowerCase();
  const p = h.split(".");
  if (p.length <= 2) return h;
  return MULTI_SLD.test(h) ? p.slice(-3).join(".") : p.slice(-2).join(".");
}

async function rebuild(catalog) {
  const dom = {},
    name = {};
  for (const [id, o] of Object.entries(catalog.offers)) {
    if (o.k === "shop" && o.h) (dom[etld1(o.h)] ||= []).push(id);
    for (const k of nameKeys(o.t)) (name[k] ||= []).push(id);
  }
  await set({ idx: { dom, name } });
}

// --- Revolut ---------------------------------------------------------------
// Seconda fonte: catalogo dei moltiplicatori RevPoints servito da sconti-api.
// Endpoint e credenziali stanno in storage, mai nel codice: il repo resta pubblicabile.

async function syncRevolut() {
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

// Stessa forma dell'indice CB, così matchIds() vale per entrambe le fonti.
// Qui la "chiave" di un'offerta è il name_key, non un id numerico.
async function rebuildRev() {
  const { revolut = { offers: [] }, revAliases = {} } = await get(["revolut", "revAliases"]);
  const dom = {},
    name = {};
  for (const o of revolut.offers) {
    if (o.domain) (dom[etld1(o.domain)] ||= []).push(o.name_key);
    for (const k of nameKeys(o.name)) (name[k] ||= []).push(o.name_key);
  }
  for (const [d, keys] of Object.entries(revAliases)) {
    for (const k of keys) (dom[d] ||= []).push(k);
  }
  await set({ ridx: { dom, name } });
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
  const dom = {},
    name = {};
  for (const o of klarna.offers) {
    if (o.domain) (dom[etld1(o.domain)] ||= []).push(o.name_key);
    for (const k of nameKeys(o.name)) (name[k] ||= []).push(o.name_key);
  }
  for (const [d, keys] of Object.entries(klAliases)) {
    for (const k of keys) (dom[d] ||= []).push(k);
  }
  await set({ kidx: { dom, name } });
}

// --- matching --------------------------------------------------------------

function matchIds(hostname, idx) {
  const d = etld1(hostname);
  const label = d.split(".")[0].replace(/-/g, "");
  const clean = label.replace(/^(shop|store|my|www)/, "").replace(/(shop|store|online|italia|it)$/, "");
  const ids = new Set(idx.dom[d] || []);

  for (const [k, list] of Object.entries(idx.name)) {
    const hit =
      k === label ||
      k === clean ||
      (k.length >= 6 && (label.includes(k) || (label.length >= 6 && k.includes(label))));
    if (hit) for (const id of list) ids.add(id);
  }
  return [...ids];
}

// --- messaggi dal content script / dashboard -------------------------------

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender)
    .then(reply)
    .catch((e) => reply({ error: String((e && e.message) || e) }));
  return true;
});

async function handle(msg, sender) {
  const tabId = sender.tab && sender.tab.id;

  if (msg.type === "check") {
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
      "update",
    ]);
    const catalog = st.catalog || { offers: {} };
    const idx = st.idx || { dom: {}, name: {} };
    const d = etld1(msg.host);
    const needLogin = st.sync && st.sync.state === "login";
    const empty = Object.keys(catalog.offers).length === 0;

    if ((st.muted || []).includes(d)) return { offers: [], rev: [], kl: [], muted: true };

    const blocked = new Set((st.blocked || {})[d] || []);
    const offers = matchIds(msg.host, idx)
      .filter((id) => !blocked.has(id) && catalog.offers[id])
      .map((id) => ({ id, ...catalog.offers[id] }))
      .sort((a, b) => (b.k === "shop") - (a.k === "shop"))
      .slice(0, 5);

    // Revolut e Klarna hanno la stessa forma: una lista di negozi con name_key.
    const byName = (list, idx, blk) => {
      const byKey = Object.fromEntries(list.map((o) => [o.name_key, o]));
      const hidden = new Set(blk[d] || []);
      return [...new Set(matchIds(msg.host, idx || { dom: {}, name: {} }))]
        .filter((k) => !hidden.has(k) && byKey[k])
        .map((k) => byKey[k])
        .sort((a, b) => b.rate - a.rate)
        .slice(0, 3);
    };
    const rev = byName((st.revolut || {}).offers || [], st.ridx, st.revBlocked || {});
    const kl = byName((st.klarna || {}).offers || [], st.kidx, st.klBlocked || {});

    if (tabId != null) {
      const skip = () => {}; // la tab può sparire mentre rispondiamo
      const n = offers.length + rev.length + kl.length;
      // Su un sito convenzionato vince il conteggio: è il motivo per cui l'estensione
      // esiste. Il "!" della nuova versione occupa il badge solo dove non c'è altro.
      const upd = !!st.update;
      chrome.action.setBadgeText({ tabId, text: n ? String(n) : upd ? "!" : "" }).catch(skip);
      chrome.action
        .setBadgeBackgroundColor({
          tabId,
          color: n ? (needLogin ? "#b45309" : "#16a34a") : BADGE_UPDATE,
        })
        .catch(skip);
    }

    const until = (st.snooze || {})[d] || 0;
    return {
      offers,
      rev,
      kl,
      needLogin,
      empty,
      domain: d,
      snoozed: Date.now() < until,
      stale: catalog.updatedAt ? Date.now() - catalog.updatedAt > 3 * NUDGE_MS : false,
    };
  }

  if (msg.type === "nudge") {
    // catalogo vuoto: avviso max 1 volta al giorno
    const { lastNudge = 0 } = await get("lastNudge");
    if (Date.now() - lastNudge < NUDGE_MS) return { show: false };
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
    // "questa offerta non c'entra con questo sito"
    const { blocked = {} } = await get("blocked");
    const list = new Set(blocked[msg.domain] || []);
    (msg.ids || []).forEach((i) => list.add(i));
    blocked[msg.domain] = [...list];
    await set({ blocked });

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
    const { idx = { dom: {}, name: {} } } = await get("idx");
    const d = etld1(msg.domain);
    idx.dom[d] = [...new Set([...(idx.dom[d] || []), msg.id])];
    await set({ idx });
    const { aliases = {} } = await get("aliases");
    aliases[d] = [...new Set([...(aliases[d] || []), msg.id])];
    await set({ aliases });
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
    const { klAliases = {} } = await get("klAliases");
    const d = etld1(msg.domain);
    klAliases[d] = [...new Set([...(klAliases[d] || []), msg.key])];
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
    const { revAliases = {} } = await get("revAliases");
    const d = etld1(msg.domain);
    revAliases[d] = [...new Set([...(revAliases[d] || []), msg.key])];
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
      "aliases",
      "revolut",
      "revSync",
      "revBlocked",
      "klarna",
      "klSync",
      "klBlocked",
      "creds",
      "update",
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
      aliases: st.aliases || {},
      offers,
      revolut: { offers: revolut.offers || [], at: revolut.at || 0 },
      revSync: st.revSync || { state: "idle" },
      revBlocked: st.revBlocked || {},
      klarna: { offers: klarna.offers || [], at: klarna.at || 0 },
      klSync: st.klSync || { state: "idle" },
      klBlocked: st.klBlocked || {},
      // La password non esce mai da qui: la dashboard sa solo se c'è.
      creds: { email: (st.creds || {}).email || "", saved: !!(st.creds || {}).password },
      update: st.update || null,
      version: chrome.runtime.getManifest().version,
    };
  }

  return { error: "unknown" };
}
