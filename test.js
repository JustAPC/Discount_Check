// Esegue le funzioni reali di background.js in un sandbox con chrome mockato.
const fs = require('fs');
const vm = require('vm');

const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const noop = () => {};
const listener = { addListener: noop };
const ctx = {
  console,
  URL, TextDecoder, fetch: () => Promise.resolve({ text: () => Promise.resolve('') }),
  chrome: {
    runtime: { onInstalled: listener, onStartup: listener, onMessage: listener },
    alarms: { onAlarm: listener, create: noop },
    storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
    action: {}, tabs: {}
  }
};
vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.__T = { parseOffer, nameKeys, etld1, matchIds, dec, klOffer, rebuildIdx: null };', ctx);
const T = ctx.__T;

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
};

// --- parseOffer: le tre insidie viste sul portale --------------------------
// 1) URL HTML-encoded, 2) la classe sconto usata anche per i KM, 3) bookmark da saltare
const html = `
<h1 class="x">Alamo Autonoleggio</h1>
<span class="cbg3-discount-and-location--uppercase">ca. 15.4 KM</span>
<span class="cbg3-discount-and-location--uppercase">&lt; 20% Sconto</span>
<button data-href="/bookmark/1000">Preferiti</button>
<button data-href="https&#x3A;&#x2F;&#x2F;partners.rentalcar.com&#x2F;it&#x3F;a&#x3D;1&amp;b&#x3D;2">Shop online</button>`;
eq('parseOffer HTML-encoded + KM',
  T.parseOffer(html, '/offer/123/cat/45'),
  { id: '123', v: { c: '45', t: 'Alamo Autonoleggio', d: '< 20% Sconto', h: 'partners.rentalcar.com', k: 'shop', p: 2 } });

// 4) il portale risponde con la home invece della scheda: va scartata, non salvata
const HOME = 'I tuoi AlmavivA s.p.a. offerte per dipendenti';
const homeHtml = `<h1>${HOME}</h1><span class="cbg3-discount-and-location--uppercase">< 50% Sconto</span>`;
eq('parseOffer scarta la home', T.parseOffer(homeHtml, '/offer/123/cat/45', HOME), null);
eq('parseOffer tiene la scheda vera', T.parseOffer(html, '/offer/123/cat/45', HOME).v.t, 'Alamo Autonoleggio');

const gc = `<h1>Apple Gift Card</h1><span class="cbg3-discount-and-location--uppercase">5% Sconto</span>
<button data-href="https://it.vouchers-at-work.com/">Shop online</button>`;
eq('parseOffer gift card', T.parseOffer(gc, '/offer/1/cat/2').v.k, 'giftcard');

const aff = `<h1>Bauzaar</h1><span class="cbg3-discount-and-location--uppercase">15% Sconto</span>
<button data-href="https://tc.tradetracker.net/?c=1">vai</button>`;
eq('parseOffer affiliate', T.parseOffer(aff, '/offer/1/cat/2').v.k, 'affiliate');

const local = `<h1>Ottica Artioli</h1><span class="cbg3-discount-and-location--uppercase">ca. 3.1 KM</span>`;
eq('parseOffer negozio fisico', T.parseOffer(local, '/offer/1/cat/2').v.k, 'none');

// --- etld1 -----------------------------------------------------------------
eq('etld1 www', T.etld1('www.thespacecinema.it'), 'thespacecinema.it');
eq('etld1 sub', T.etld1('webstore.northsails.com'), 'northsails.com');
eq('etld1 co.uk', T.etld1('shop.marksandspencer.co.uk'), 'marksandspencer.co.uk');

// --- klOffer: record veri dell'API Klarna -----------------------------------
// Il tasso è in centesimi di punto e il dominio esiste solo dentro otcUrl.
const klStore = (name, pct, otc, upTo = true) => ({
  displayName: name,
  cashbackDiscount: { discountPercentage: pct, showUpToPrefix: upTo },
  otcUrl: otc
});
eq('klOffer 150 → fino a 1,5%',
  T.klOffer(klStore('Unieuro', 150,
    'https://app.klarna.com/one-time-card/start?merchantUrl=unieuro.it&origin=x')),
  { name: 'Unieuro', name_key: 'unieuro', rate: 1.5, domain: 'unieuro.it', label: 'fino a 1,5%' });
eq('klOffer nome composto → chiave senza spazi',
  T.klOffer(klStore('Foot Locker', 400, '?merchantUrl=www.footlocker.it')).name_key, 'footlocker');
eq('klOffer senza "fino a"',
  T.klOffer(klStore('Temu', 700, '?merchantUrl=temu.com', false)).label, '7%');
eq('klOffer senza cashback scartato',
  T.klOffer({ displayName: 'Zalando', cashbackDiscount: null, otcUrl: '?merchantUrl=zalando.it' }), null);
eq('klOffer senza otcUrl resta senza dominio',
  T.klOffer({ displayName: 'X', cashbackDiscount: { discountPercentage: 200 }, otcUrl: null }).domain, null);

// --- matching su titoli reali del portale ----------------------------------
const titoli = {
  1: 'Apple Gift Card', 2: 'Zalando Gift Card', 3: 'IKEA Gift Card', 4: 'The Space Cinema',
  5: 'Expedia', 6: 'Babbel.com', 7: 'Garmin', 8: 'Decathlon Gift Cards', 9: 'Sephora Gift Card',
  10: 'Nike Gift Cards', 11: 'H&M Gift Card', 12: 'Esselunga Gift Card', 13: 'LaFeltrinelli Gift Card',
  14: 'Swarovski Gift Card', 15: 'Rituals', 16: 'UCI Cinemas', 17: 'LEGO® Gift Cards',
  18: 'TheFork Gift Card', 19: 'Carrefour Gift Card', 20: 'adidas Gift Card',
  21: 'Trenitalia - SuperEconomy & FrecciaDays', 22: 'Smartbox - Speciale Agosto',
  23: 'Primark Gift Cards', 24: 'Uber Gift Cards', 25: 'KitchenAid', 26: 'Notorious Cinemas',
  27: 'Alpitour World', 28: 'Jurassic World', 29: 'Cicli Drigani', 30: 'Allianz Direct - Casa'
};
const name = {};
for (const [id, t] of Object.entries(titoli)) for (const k of T.nameKeys(t)) (name[k] ||= []).push(id);
const idx = { dom: { 'kitchenaid.it': ['25'] }, name };
const m = h => T.matchIds(h, idx).map(i => titoli[i]);

const positivi = {
  'apple.com': 'Apple Gift Card', 'zalando.it': 'Zalando Gift Card', 'ikea.com': 'IKEA Gift Card',
  'www.thespacecinema.it': 'The Space Cinema', 'expedia.it': 'Expedia', 'babbel.com': 'Babbel.com',
  'garmin.com': 'Garmin', 'decathlon.it': 'Decathlon Gift Cards', 'sephora.it': 'Sephora Gift Card',
  'nike.com': 'Nike Gift Cards', 'hm.com': 'H&M Gift Card', 'esselunga.it': 'Esselunga Gift Card',
  'lafeltrinelli.it': 'LaFeltrinelli Gift Card', 'swarovski.com': 'Swarovski Gift Card',
  'rituals.com': 'Rituals', 'lego.com': 'LEGO® Gift Cards', 'thefork.it': 'TheFork Gift Card',
  'carrefour.it': 'Carrefour Gift Card', 'adidas.it': 'adidas Gift Card', 'trenitalia.it': 'Trenitalia - SuperEconomy & FrecciaDays',
  'smartbox.com': 'Smartbox - Speciale Agosto', 'primark.com': 'Primark Gift Cards', 'uber.com': 'Uber Gift Cards',
  'kitchenaid.it': 'KitchenAid'
};
let miss = [];
for (const [host, want] of Object.entries(positivi)) if (!m(host).includes(want)) miss.push(host);
eq('match: 24 domini convenzionati', miss, []);

const negativi = ['amazon.it', 'ebay.it', 'subito.it', 'github.com', 'poste.it', 'mediaworld.it',
  'shein.com', 'temu.com', 'booking.com', 'aliexpress.com', 'netflix.com', 'zara.com',
  'bershka.com', 'douglas.it', 'lidl.it', 'conad.it', 'fnac.it', 'vinted.it'];
eq('match: nessun falso positivo', negativi.filter(h => m(h).length), []);

console.log(fail ? `\n${fail} test falliti` : '\nTutti i test passati');
process.exit(fail ? 1 : 0);
