// Esegue le funzioni reali di background.js in un sandbox con chrome mockato.
const fs = require('fs');
const vm = require('vm');

const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const noop = () => {};
const listener = { addListener: noop };
// chrome.storage.local finto ma vero: i test su checkHost gli scrivono dentro.
let store = {};
const ctx = {
  console,
  URL, TextDecoder, fetch: () => Promise.resolve({ text: () => Promise.resolve('') }),
  chrome: {
    runtime: { onInstalled: listener, onStartup: listener, onMessage: listener },
    alarms: { onAlarm: listener, create: noop, clear: noop },
    storage: {
      local: {
        get: k => Promise.resolve(Object.fromEntries(
          (Array.isArray(k) ? k : [k]).filter(x => x in store).map(x => [x, store[x]]))),
        set: o => { Object.assign(store, o); return Promise.resolve(); }
      }
    },
    action: {}, scripting: {},
    tabs: { onUpdated: listener },
    permissions: { contains: () => Promise.resolve(true) }
  }
};
vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.__T = { parseOffer, nameKeys, etld1, matchIds, dec, klOffer, checkHost, rebuild, collapsed, wordKeys, storeIndex, domLabel, handle };', ctx);
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
// Su myshopify.com ogni negozio è un sottodominio: fermarsi al secondo livello li
// farebbe passare tutti per lo stesso sito.
eq('etld1 tenant', T.etld1('www.pasticceriatal.myshopify.com'), 'pasticceriatal.myshopify.com');
eq('etld1 tenant, negozio diverso', T.etld1('altro.myshopify.com'), 'altro.myshopify.com');

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
const name = {}, word = {};
for (const [id, t] of Object.entries(titoli)) {
  for (const k of T.nameKeys(t)) (name[k] ||= []).push(id);
  for (const k of T.wordKeys(t)) (word[k] ||= []).push(id);
}
const idx = { dom: { 'kitchenaid.it': ['25'] }, name, word };
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

// --- chiavi da un token: le collisioni viste in uso reale -------------------
// Un token corto preso da un nome di due parole diventava una chiave a se' stante e
// marcava domini che non c'entrano niente. Il badge ora si vede su ogni tab, quindi
// questi falsi positivi non sono piu' invisibili fino al checkout.
eq('nameKeys: token corto non fa chiave', [...T.nameKeys('Brave Soul')], ['bravesoul']);
eq('nameKeys: nome di persona non fa chiave', [...T.nameKeys('Andrea Milano')], ['andreamilano']);
// Ma un token lungo resta prezioso, in un indice a parte: e' come si aggancia
// mondadoristore.it a "Gruppo Editoriale Mondadori".
eq('wordKeys: token lungo resta',
  [...T.wordKeys('Gruppo Editoriale Mondadori')].includes('mondadori'), true);
eq('wordKeys: nome di una parola non ne produce', [...T.wordKeys('Expedia')], []);
// Brand di una parola sola: la chiave del nome intero e' gia' il token.
eq('nameKeys: brand corto di una parola', [...T.nameKeys('LEGO® Gift Cards')], ['lego']);

const cIdx = {
  dom: {},
  name: { 'bravesoul': ['31'], 'andreamilano': ['32'], 'qatarairways': ['34'], 'itaairways': ['35'] },
  word: { 'mondadori': ['33'], 'airways': ['34', '35'] }
};
eq('match: brave.com non e\' Brave Soul', T.matchIds('search.brave.com', cIdx), []);
eq('match: andreapontillo.tech non e\' Andrea Milano',
  T.matchIds('ha.andreapontillo.tech', cIdx), []);
eq('match: mondadoristore.it resta agganciato',
  T.matchIds('www.mondadoristore.it', cIdx), ['33']);

// Il settore non e' il marchio: "airways" e' lungo abbastanza da passare la soglia, ma
// "itaairways" lo contiene solo perche' finisce con la stessa parola. La regola del
// prefisso separa il marchio davanti dal settore dietro - e vale nei due versi.
eq('match: ita-airways non e\' Qatar Airways', T.matchIds('www.ita-airways.com', cIdx), ['35']);
eq('match: qatarairways non e\' ITA Airways', T.matchIds('www.qatarairways.com', cIdx), ['34']);

// --- rilevamento del checkout ----------------------------------------------
// Le regex si estraggono da content.js invece di ricopiarle qui: un test su una copia
// non protegge il file che viene davvero spedito.
const csrc = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
const pick = n => {
  const m = new RegExp('const ' + n + ' =\\s*(/.*?/i);', 's').exec(csrc);
  if (!m) { fail++; console.log(`FAIL non trovo ${n} in content.js`); return /$^/; }
  return eval(m[1]);
};
const C_PATH = pick('CHECKOUT_PATH'), C_TEXT = pick('CHECKOUT_TEXT');
const F_ADDR = pick('FILL_ADDR'), F_WHO = pick('FILL_WHO');
// Stessa regola di looksLikePurchaseForm: almeno un token di indirizzo e tre in tutto.
const modulo = tok => {
  const seen = new Set(tok.filter(t => F_ADDR.test(t) || F_WHO.test(t)));
  return [...seen].filter(t => F_ADDR.test(t)).length >= 1 && seen.size >= 3;
};
const pathOf = u => new URL(u).pathname;

// I due URL veri di booking. Prima il primo matchava su "checkout=2026-08-16", che su
// ogni sito di hotel e' la data di partenza, e il secondo solo per via di "basket_id".
eq('checkout: i risultati di ricerca non sono un carrello',
  C_PATH.test(pathOf('https://www.booking.com/searchresults.it.html?checkin=2026-08-13&checkout=2026-08-16&ss=Roma')),
  false);
eq('checkout: nessun falso positivo dalla query',
  ['/hotel/it/cernaia-suites.it.html', '/searchresults.it.html', '/flights/index.it.html',
   '/cartoleria/quaderni', '/ordermanagement/faq', '/books/12345'].filter(p => C_PATH.test(p)),
  []);
eq('checkout: i percorsi veri passano',
  ['/checkout', '/it/carrello', '/cart/', '/panier', '/kasse', '/order/review',
   '/ordini/nuovo', '/payment-methods', '/riepilogo-ordine'].filter(p => !C_PATH.test(p)),
  []);
// --- i due checkout veri, con i token letti davvero dalle pagine -------------
// booking: nessun campo carta, nessuna parola utile nel percorso, ma sette token di
// autofill. aliexpress: nessun input, ma "confirm" nel percorso.
eq('checkout: il percorso di booking non basta', C_PATH.test('/book.html'), false);
eq('checkout: booking lo prende il modulo di spedizione',
  modulo(['given-name', 'family-name', 'email', 'address-line1', 'address-level2',
          'postal-code', 'tel-national']), true);
eq('checkout: aliexpress lo prende il percorso',
  C_PATH.test('/p/trade/confirm.html'), true);
eq('checkout: aliexpress non ha moduli', modulo([]), false);
// Una registrazione ha nome, email e telefono ma nessun indirizzo: non e' un acquisto.
eq('checkout: la registrazione non e\' un acquisto',
  modulo(['given-name', 'family-name', 'email', 'tel']), false);
eq('checkout: la newsletter nemmeno', modulo(['email']), false);
// Amazon mette il checkout sotto /gp/buy/
eq('checkout: amazon', C_PATH.test('/gp/buy/spc/handlers/display.html'), true);
eq('checkout: lo prende il testo del bottone',
  ['Completa la prenotazione', 'Conferma la prenotazione', 'Procedi al pagamento',
   'Complete booking', 'Paga ora'].filter(t => !C_TEXT.test(t)),
  []);
eq('checkout: il testo non prende una pagina qualunque',
  ['Cerca', 'Vedi disponibilità', 'Mostra i prezzi', 'Prenota', 'Aggiungi al carrello']
    .filter(t => C_TEXT.test(t)),
  []);

// --- collapsed: il portale è cambiato o il calo è vero? --------------------
eq('collapsed: crollo da portale rotto', T.collapsed(12, 890, 0), true);
eq('collapsed: crollo già visto, stavolta ci si crede', T.collapsed(12, 890, 1), false);
eq('collapsed: calo fisiologico', T.collapsed(870, 890, 0), false);
eq('collapsed: esattamente la metà non è un crollo', T.collapsed(445, 890, 0), false);
eq('collapsed: primo crawl, niente da confrontare', T.collapsed(0, 0, 0), false);
eq('collapsed: catalogo piccolo, può dimezzarsi davvero', T.collapsed(4, 30, 0), false);

// --- storeIndex: il dominio noto sostituisce la congettura sul nome ---------
// Vale per Revolut e Klarna, dove il dominio e' davvero quello del negozio. Il portale
// no: un link su cinque punta a un portale convenzione, non al sito del brand.

eq('domLabel: via i trattini e il suffisso', T.domLabel('www.ita-airways.com'), 'itaairways');

const revOffers = [
  { name: 'ITA airways', name_key: 'itaairways', domain: 'ita-airways.com' },
  { name: 'Qatar Airways', name_key: 'qatarairways', domain: 'qatarairways.com' },
  { name: 'Lounge by Zalando', name_key: 'loungebyzalando', domain: null }
];
const ri = T.storeIndex(revOffers, {}).idx;
const rm = h => T.matchIds(h, ri);

// ITA e Qatar non compaiono negli indici sui nomi: di loro si sa il sito. Il terzo si',
// ed e' giusto - "zalando" da "Lounge by Zalando" e' cio' che lo aggancia a zalando.it
// finche' nessuno gli cura un dominio.
eq('storeIndex: con dominio esce dagli indici sui nomi',
  [Object.keys(ri.name), Object.keys(ri.word)], [['loungebyzalando'], ['zalando']]);
eq('storeIndex: con dominio entra in quelli sul dominio',
  [Object.keys(ri.dom).sort(), Object.keys(ri.lab).sort()],
  [['ita-airways.com', 'qatarairways.com'], ['itaairways', 'qatarairways']]);
eq('match: ita-airways.com solo ITA', rm('www.ita-airways.com'), ['itaairways']);
eq('match: qatarairways.com solo Qatar', rm('www.qatarairways.com'), ['qatarairways']);
// Il dominio noto vale anche sulle altre estensioni dello stesso marchio.
eq('match: ita-airways.it vale lo stesso', rm('ita-airways.it'), ['itaairways']);
// Senza dominio resta la congettura sul nome, che e' meglio di niente.
eq('match: il negozio senza dominio resta sul nome', rm('loungebyzalando.com'), ['loungebyzalando']);

// L'alias locale muore quando il server impara il dominio, o sovrascriverebbe per sempre
// il dato buono appena arrivato.
const conAlias = T.storeIndex(revOffers, { 'qatarairways.it': ['qatarairways'], 'x.it': ['loungebyzalando'] });
eq('storeIndex: alias superato dal dominio, cancellato',
  conAlias.aliases, { 'x.it': ['loungebyzalando'] });
eq('storeIndex: alias ancora utile, tenuto',
  T.matchIds('x.it', conAlias.idx), ['loungebyzalando']);

// --- checkHost: da qui dipende se il content script viene iniettato ---------
// Prima girava su ogni pagina e decideva lui; ora un errore qui è un'estensione muta
// (o, al contrario, codice iniettato dove non serve).

(async () => {
  const has = r => r.offers.length + r.rev.length + r.kl.length;

  // --- rebuild: gli alias manuali devono sopravvivere alla sync ---------------
  // Erano l'unica parte dell'indice non derivata dal catalogo, e rebuild() la buttava
  // via a ogni crawl: il collegamento fatto a mano durava fino al giorno dopo.
  const cat = { offers: { 5: { c: '1', t: 'Wizz Air', d: '', h: '', k: 'none', p: 2 } } };

  store = { aliases: { 'wizzair.com': ['5'] } };
  await T.rebuild(cat);
  eq('rebuild: alias riapplicato', store.idx.dom['wizzair.com'], ['5']);

  store = { aliases: { 'sparita.it': ['999'] } };
  await T.rebuild(cat);
  eq('rebuild: alias verso offerta non più in catalogo', store.idx.dom['sparita.it'], undefined);

  store = {};
  await T.rebuild(cat);
  eq('rebuild: senza alias resta il solo catalogo', Object.keys(store.idx.dom), []);

  store = {};
  const vuoto = await T.checkHost('zalando.it');
  eq('checkHost: catalogo mai scaricato', [vuoto.empty, has(vuoto)], [true, 0]);

  store = {
    catalog: { offers: { 2: { c: '9', t: 'Zalando Gift Card', d: '5% Sconto', h: '', k: 'giftcard', p: 2 } } },
    idx: { dom: {}, name: { zalando: ['2'] } },
    revolut: { offers: [{ name: 'Zalando', name_key: 'zalando', rate: 3, label: '3x', domain: 'zalando.it' }] },
    ridx: { dom: { 'zalando.it': ['zalando'] }, name: {} }
  };
  const hit = await T.checkHost('www.zalando.it');
  eq('checkHost: due fonti sullo stesso dominio',
    [hit.empty, hit.offers.length, hit.rev.length, hit.domain], [false, 1, 1, 'zalando.it']);

  const altro = await T.checkHost('amazon.it');
  eq('checkHost: sito senza vantaggi', has(altro), 0);

  store.muted = ['zalando.it'];
  const zitto = await T.checkHost('www.zalando.it');
  eq('checkHost: sito silenziato', [zitto.muted, has(zitto)], [true, 0]);

  delete store.muted;
  store.blocked = { 'zalando.it': ['2'] };
  store.revBlocked = { 'zalando.it': ['zalando'] };
  const bloccato = await T.checkHost('www.zalando.it');
  eq('checkHost: falsi positivi segnalati', has(bloccato), 0);

  // --- collegamenti manuali: creare, e soprattutto togliere ------------------
  // Erano l'unica cosa che l'utente crea deliberatamente e l'unica senza un undo.

  store = { catalog: { offers: { 7: { c: '1', t: 'Wizz Air', d: '', h: '', k: 'none', p: 2 } } } };
  await T.handle({ type: 'alias', domain: 'https://www.wizzair.com/it-it', id: '7' });
  eq('alias: normalizza l\'URL incollato', store.aliases, { 'wizzair.com': ['7'] });
  eq('alias: entra nell\'indice', store.idx.dom['wizzair.com'], ['7']);

  await T.handle({ type: 'unalias', domain: 'wizzair.com', id: '7' });
  eq('unalias: via dallo storage, chiave vuota rimossa', store.aliases, {});
  eq('unalias: via anche dall\'indice', store.idx.dom['wizzair.com'], undefined);

  // Un negozio di cui il server sa gia' il dominio: l'alias verrebbe cancellato dal primo
  // rebuild, quindi non si crea e si dice perche'.
  store = { revolut: { offers: [
    { name: 'Qatar Airways', name_key: 'qatarairways', domain: 'qatarairways.com' },
    { name: 'Lounge by Zalando', name_key: 'loungebyzalando', domain: null }
  ] } };
  const sup = await T.handle({ type: 'revAlias', domain: 'esempio.it', key: 'qatarairways' });
  eq('revAlias: il dominio del server vince, e lo dice', sup, { ok: true, superseded: 'qatarairways.com' });
  eq('revAlias: e non scrive niente', store.revAliases, undefined);

  const ok = await T.handle({ type: 'revAlias', domain: 'www.zalando-lounge.it', key: 'loungebyzalando' });
  eq('revAlias: senza dominio noto si collega', [ok.ok, store.revAliases],
    [true, { 'zalando-lounge.it': ['loungebyzalando'] }]);

  await T.handle({ type: 'revUnalias', domain: 'zalando-lounge.it', key: 'loungebyzalando' });
  eq('revUnalias: staccato', store.revAliases, {});

  console.log(fail ? `\n${fail} test falliti` : '\nTutti i test passati');
  process.exit(fail ? 1 : 0);
})();
