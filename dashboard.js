// Discount Check - dashboard (popup dell'estensione).
const $ = id => document.getElementById(id);
const send = msg => new Promise(r => chrome.runtime.sendMessage(msg, x => r(chrome.runtime.lastError ? null : x)));

const MAX_HITS = 40;   // oltre non si scorre più: si scrive meglio la ricerca

let S = null;
let timer = null;
let live = false;      // false = dati non affidabili: la ricerca resta chiusa

const fmt = ts => !ts ? 'mai' : new Date(ts).toLocaleString('it-IT',
  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'ic');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#i-' + name);
  s.appendChild(u);
  return s;
}

function act(name, label, fn) {
  const b = el('button', 'act');
  b.title = label;
  b.setAttribute('aria-label', label);
  b.appendChild(icon(name));
  b.onclick = fn;
  return b;
}

// --- stato -----------------------------------------------------------------

// Il service worker MV3 può morire a metà sync e lasciare lo stato su "running" per
// sempre: dopo due minuti lo si considera finito, così la dashboard non gira a vuoto.
const busy = (s) => !!s && s.state === 'running' && Date.now() - (s.at || 0) < 120000;

async function refresh() {
  const next = await send({ type: 'state' });
  // Il service worker MV3 viene terminato spesso: se non risponde va detto, non lasciato in bianco.
  if (!next) return unreachable();
  S = next;
  live = true;
  const st = S.sync || {};
  // "Aggiorna tutto" muove tutte e tre le fonti: finché una lavora il bottone resta
  // occupato e il polling continua, altrimenti Revolut e Klarna finivano in silenzio.
  const running = st.state === 'running' || busy(S.revSync) || busy(S.klSync);

  $('dot').className = 'dot' + (running ? ' run' : st.state === 'login' ? ' warn'
    : st.state === 'suspect' ? ' warn' : st.state === 'error' ? ' err' : '');
  $('title').textContent = running ? 'Sincronizzazione' : 'Discount Check';
  $('sub').textContent = running
    ? `${st.phase === 'categorie' ? 'leggo le categorie' : 'leggo le offerte'} — ${st.done || 0}/${st.total || '?'}`
    : `aggiornato ${fmt(S.updatedAt)}`;

  $('warn').innerHTML = '';
  // Prima di tutto il resto: senza accesso ai siti il catalogo può essere perfetto e
  // l'estensione resterà comunque muta al checkout. È la causa che spiega tutte le altre.
  if (S.shopAccess === false) renderShopAccess();
  if (st.state === 'login') {
    const body = warn(
      st.reason === 'nocreds' ? 'Credenziali mancanti'
        : st.reason === 'disclaimer' ? 'Conferma richiesta dal portale'
        : 'Login al portale fallito',
      st.reason === 'nocreds'
        ? 'Senza email e password non posso rifare il login quando la sessione scade.'
        : st.reason === 'disclaimer'
        ? 'Apri il portale, premi Conferma sul popup "Riservatezza sulle convenzioni!" e rilancia Aggiorna tutto.'
        : 'Il portale ha rifiutato le credenziali salvate. Il catalogo resta attivo, ma può essere incompleto.');
    const b = el('button', 'btn', 'Inserisci le credenziali');
    b.onclick = () => {
      $('d-creds').open = true;
      $('d-creds').scrollIntoView({ block: 'nearest' });
      $('cred-email').focus();
    };
    body.appendChild(b);
  } else if (st.state === 'suspect') {
    // Il catalogo mostrato è ancora quello vecchio, ed è il punto: meglio dati di ieri
    // che un catalogo vuoto spacciato per fresco.
    warn('Il portale ha risposto in modo strano',
      `L'ultimo crawl ha trovato ${st.found} offerte invece di ${st.had}: un crollo così di solito ` +
      'vuol dire che il portale è cambiato e non riesco più a leggerlo. Ho tenuto il catalogo ' +
      'precedente e non ho salvato niente. Se al prossimo giro il portale dice la stessa cosa, ' +
      'il calo è vero e lo accetto.');
  } else if (st.state === 'error') {
    warn('Sincronizzazione fallita', st.error || 'errore sconosciuto', 'err');
  }

  $('bar').hidden = !running;
  if (running) {
    $('bar').firstElementChild.style.transform =
      `scaleX(${(st.done || 0) / Math.max(st.total || 1, 1)})`;
  }
  $('sync').disabled = running;
  $('sync').classList.toggle('busy', running);
  $('sync-label').textContent = running ? 'In corso…' : 'Aggiorna tutto';

  const rev = (S.revolut || {}).offers || [];
  const kl = (S.klarna || {}).offers || [];
  $('s-count').textContent = S.count;
  $('s-rev').textContent = rev.length;
  $('s-kl').textContent = kl.length;

  const blocked = Object.entries(S.blocked).flatMap(([d, ids]) => ids.map(id => [d, id]));
  const aliases = aliasRows();
  $('n-aliases').textContent = aliases.length;
  $('n-cb').textContent = S.count;
  $('n-rev').textContent = rev.length;
  $('n-kl').textContent = kl.length;
  $('n-blocked').textContent = blocked.length;
  $('n-muted').textContent = S.muted.length;
  renderCreds();
  $('ver').textContent = 'v' + S.version;
  // Non atteso: e' un giro di messaggi in piu' e il resto della dashboard non deve
  // aspettarlo per dipingersi.
  renderHere();

  if ($('d-cb').open) renderCatalog();
  renderRevolut(rev);
  renderKlarna(kl);
  renderAliases(aliases);
  renderBlocked(blocked);
  renderMuted();
  search();

  clearTimeout(timer);
  if (running) timer = setTimeout(refresh, 800);
}

function warn(title, text, kind) {
  const d = el('div', 'warn-box' + (kind ? ' ' + kind : ''));
  d.appendChild(icon('alert'));
  const body = el('div');
  body.append(el('b', null, title), document.createTextNode(' ' + text));
  d.appendChild(body);
  $('warn').appendChild(d);
  return body;
}

// --- accesso ai siti -----------------------------------------------------------
// L'accesso a "tutti i siti" è un permesso opzionale: all'installazione l'estensione
// non lo chiede, così il browser non mostra l'avviso più spaventoso che esista. Lo si
// concede da qui, quando si è capito a cosa serve.

const SHOP_ORIGINS = { origins: ['http://*/*', 'https://*/*'] };

function renderShopAccess() {
  const body = warn('Accesso ai siti non concesso',
    'Il catalogo si aggiorna lo stesso e la ricerca qui dentro funziona, ma al checkout ' +
    'non comparirà nulla: senza questo permesso non posso leggere su che sito sei.');
  const b = el('button', 'btn primary', 'Consenti sui siti di shopping');
  b.onclick = async () => {
    // Va chiesto da un gesto dell'utente. Chrome può chiudere il popup mentre mostra
    // la sua finestra: se succede, alla riapertura l'avviso semplicemente non c'è più.
    try {
      if (await chrome.permissions.request(SHOP_ORIGINS)) refresh();
    } catch { /* popup chiuso sotto i piedi: niente da fare qui */ }
  };
  body.appendChild(b);
}

// --- il sito su cui sei ---------------------------------------------------------
// Le stesse righe della card al checkout, ma raggiungibili sempre. Dal badge si legge
// che c'è qualcosa, non che cosa; e "non c'entra nulla" viveva solo dentro la card,
// cioè nel posto più scomodo da raggiungere apposta. Ordine delle fonti identico alla
// card, perché è la stessa informazione e non deve sembrare un'altra cosa.

let hereReady = false;

// Cercare è un compito diverso dal guardare dove sei: mentre si cerca il blocco sparisce,
// come già fa il riepilogo del catalogo, e i risultati restano in cima.
const hereVisible = () => {
  $('here').hidden = !hereReady || !!norm($('q').value.trim());
};

const hereNote = txt => el('div', 'here-none', txt);

// Piu' corte di quelle della card: qui la riga e' su una sola linea con l'ellissi, e
// "compra la card e pagaci il carrello" si troncava proprio sulla parte che dice
// cosa fare. Sotto i ~46 caratteri la nota entra intera anche con due bottoni.
const KIND_NOTE = {
  giftcard: 'Gift card scontata — pagaci il carrello',
  shop: 'Convenzione — parti dal portale per il tracking'
};

function hereRow(o) {
  const row = el('div', 'item');
  row.append(el('span', 'pct' + (o.cls ? ' ' + o.cls : ''), o.label));
  const t = el('div', 't');
  t.append(el('b', null, o.title), el('div', 'm', o.note));
  row.append(t, act('ban', 'Non c\'entra nulla con questo sito',
    async () => { await send(o.hide); refresh(); }));
  if (o.open) row.append(act('external', 'Apri sul portale', o.open));
  return row;
}

async function renderHere() {
  const r = await send({ type: 'current' });
  // Senza accesso ai siti l'avviso in cima dice già tutto, e su una pagina del browser
  // non c'è un sito di cui parlare: in entrambi i casi il blocco non si mostra affatto.
  hereReady = !!r && r.page && S.shopAccess !== false;
  hereVisible();
  if (!hereReady) return;

  const box = $('here');
  box.innerHTML = '';

  const hd = el('div', 'here-hd');
  const acts = el('div', 'acts');
  if (r.snoozed) {
    acts.append(act('undo', 'Riprendi gli avvisi qui',
      async () => { await send({ type: 'unsnooze', domain: r.domain }); refresh(); }));
  }
  acts.append(r.muted
    ? act('bell', 'Riattiva gli avvisi qui',
      async () => { await send({ type: 'unmute', domain: r.domain }); refresh(); })
    : act('bell-off', 'Mai su questo sito',
      async () => { await send({ type: 'mute', domain: r.domain }); refresh(); }));
  hd.append(el('span', 'host', r.domain), acts);
  box.append(hd);

  if (r.muted) return box.append(hereNote('Silenziato: qui non compare niente. La campanella lo riattiva.'));
  if (r.empty) return box.append(hereNote('Catalogo non ancora scaricato: non posso sapere se questo sito è convenzionato.'));

  if (!r.offers.length && !r.rev.length && !r.kl.length) {
    return box.append(hereNote('Nessun vantaggio qui. Se sai che è convenzionato, cercalo qui sotto e usa "Collega a un sito".'));
  }

  for (const o of r.rev) {
    box.append(hereRow({
      cls: 'rev', label: o.label, title: o.name,
      note: 'Revolut — paga con la carta Revolut' + (o.boosted ? ', tasso potenziato' : ''),
      hide: { type: 'report', domain: r.domain, revKeys: [o.name_key] }
    }));
  }
  for (const o of r.kl) {
    box.append(hereRow({
      cls: 'kl', label: o.label, title: o.name,
      note: 'Klarna — il cashback si prende dalla Klarna app',
      hide: { type: 'report', domain: r.domain, klKeys: [o.name_key] }
    }));
  }
  for (const o of r.offers) {
    const isDisc = DISCOUNT.test(o.d || '');
    box.append(hereRow({
      cls: isDisc ? '' : 'none',
      label: (isDisc && o.d.replace(/\s*sconto/i, '').trim()) || '—',
      title: o.t,
      note: (KIND_NOTE[o.k] || 'Convenzione') + (!isDisc && o.d ? ' · ' + o.d : ''),
      hide: { type: 'report', domain: r.domain, ids: [o.id] },
      open: () => send({ type: 'open', id: o.id, cat: o.c })
    }));
  }

  // Lo snooze è l'unico stato che spegne la card lasciando il badge acceso: senza dirlo,
  // qui si leggerebbe un elenco di vantaggi e al checkout non comparirebbe niente.
  if (r.snoozed) {
    box.append(hereNote('In pausa fino alle ' +
      new Date(r.snoozeUntil).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) +
      ': al checkout non esce nulla.'));
  }
}

// Nessuna risposta dal background: schermata onesta con un modo per riprovare.
function unreachable() {
  live = false;
  $('dot').className = 'dot err';
  $('title').textContent = 'Discount Check';
  $('sub').textContent = 'nessuna risposta';
  $('bar').hidden = true;
  $('browse').hidden = true;
  $('results').hidden = true;
  hereReady = false;
  $('here').hidden = true;
  $('warn').innerHTML = '';
  const body = warn('Estensione non raggiungibile',
    'Il service worker non ha risposto. Di solito basta riprovare; se insiste, ricarica l\'estensione da chrome://extensions.',
    'err');
  const retry = el('button', 'btn', 'Riprova');
  retry.onclick = refresh;
  body.appendChild(retry);
}

// --- ricerca: le due fonti, stesso campo -----------------------------------

const norm = s => String(s || '').toLowerCase();

// Il termine cercato resta visibile dentro al risultato: con 900 offerte
// dallo stesso portale i titoli si somigliano tutti.
function mark(text, q) {
  const f = document.createDocumentFragment();
  const i = q ? norm(text).indexOf(q) : -1;
  if (i < 0) { f.append(text); return f; }
  f.append(text.slice(0, i), el('mark', null, text.slice(i, i + q.length)), text.slice(i + q.length));
  return f;
}

// Prima chi inizia col termine, poi in ordine alfabetico: cercando "app"
// Apple viene prima di "Zalando App".
const rank = (a, b, q) => (norm(b).startsWith(q)) - (norm(a).startsWith(q)) || a.localeCompare(b);

function search() {
  if (!live) return;
  const q = norm($('q').value.trim());
  const box = $('results');
  $('q-clear').hidden = !q;
  $('browse').hidden = !!q;
  hereVisible();
  box.hidden = !q;
  box.innerHTML = '';
  if (!q) { $('results-status').textContent = ''; return; }

  const cb = Object.entries(S.offers)
    .filter(([, o]) => norm(o.t).includes(q) || norm(o.h).includes(q))
    .sort(([, a], [, b]) => rank(a.t, b.t, q));

  const byName = list => list
    .filter(o => norm(o.name).includes(q) || norm(o.domain).includes(q))
    .sort((a, b) => rank(a.name, b.name, q));
  const rev = byName((S.revolut || {}).offers || []);
  const kl = byName((S.klarna || {}).offers || []);

  $('results-status').textContent =
    `${cb.length} Corporate Benefits · ${rev.length} Revolut · ${kl.length} Klarna`;

  if (!cb.length && !rev.length && !kl.length) {
    const e = el('div', 'empty');
    e.append(el('b', null, `Nessun risultato per "${$('q').value.trim()}"`),
      `Cerco tra ${S.count} offerte Corporate Benefits, ${((S.revolut || {}).offers || []).length} negozi Revolut ` +
      `e ${((S.klarna || {}).offers || []).length} negozi Klarna. ` +
      'Se il negozio esiste ma non lo trovo, il catalogo potrebbe essere da aggiornare.');
    box.appendChild(e);
    return;
  }

  if (cb.length) {
    box.appendChild(group('Corporate Benefits', cb.length, false));
    for (const [id, o] of cb.slice(0, MAX_HITS)) box.appendChild(cbRow(id, o, q));
    if (cb.length > MAX_HITS) box.appendChild(more(cb.length - MAX_HITS));
  }
  if (rev.length) {
    box.appendChild(group('Revolut', rev.length, 'rev'));
    for (const o of rev.slice(0, MAX_HITS)) box.appendChild(storeRow(o, 'rev', q));
    if (rev.length > MAX_HITS) box.appendChild(more(rev.length - MAX_HITS));
  }
  if (kl.length) {
    box.appendChild(group('Klarna', kl.length, 'kl'));
    for (const o of kl.slice(0, MAX_HITS)) box.appendChild(storeRow(o, 'kl', q));
    if (kl.length > MAX_HITS) box.appendChild(more(kl.length - MAX_HITS));
  }
}

function group(name, n, src) {
  const g = el('div', 'grp' + (src ? ' ' + src : ''), name);
  g.appendChild(el('span', 'n', String(n)));
  return g;
}

const more = n => el('div', 'empty', `…e altri ${n}. Restringi la ricerca.`);

// --- righe ------------------------------------------------------------------

// Il portale scrive nello stesso campo anche testi che sconti non sono ("ca. 15.4 KM",
// note libere): nel chip ci va solo ciò che si legge come sconto, il resto è dettaglio.
const DISCOUNT = /[%€]|\bsconto\b|\bgratis\b/i;

function cbRow(id, o, q) {
  const row = el('div', 'item');
  const isDisc = DISCOUNT.test(o.d || '');
  row.append(el('span', 'pct' + (isDisc ? '' : ' none'),
    (isDisc && o.d.replace(/\s*sconto/i, '').trim()) || '—'));

  const t = el('div', 't');
  const title = el('b');
  title.appendChild(mark(o.t, q));
  const kind = o.k === 'giftcard' ? 'gift card' : o.k === 'affiliate' ? 'affiliate' : null;
  const meta = el('div', 'm');
  meta.appendChild(mark(o.h || 'nessun link uscente', o.h ? q : ''));
  if (kind) meta.append(' · ' + kind);
  if (!isDisc && o.d) meta.append(' · ' + o.d);
  t.append(title, meta);

  row.append(t,
    act('link', 'Collega a un sito', () => askDomain(row, { id })),
    act('external', 'Apri sul portale', () => send({ type: 'open', id, cat: o.c })));
  return row;
}

// Revolut e Klarna hanno la stessa forma (name, name_key, label, domain): una riga sola,
// cambia il colore del chip e il dettaglio in fondo.
function storeRow(o, src, q) {
  const row = el('div', 'item');
  row.append(el('span', 'pct ' + src, o.label));

  const t = el('div', 't');
  const title = el('b');
  title.appendChild(mark(o.name, q));
  const meta = el('div', 'm');
  meta.appendChild(mark(o.domain || o.badge_raw || '', o.domain ? q : ''));
  if (src === 'rev' && o.boosted) meta.append(' · potenziato');
  if (src === 'kl') meta.append(' · solo dalla Klarna app');
  t.append(title, meta);

  row.append(t, act('link', 'Collega a un sito',
    () => askDomain(row, { key: o.name_key, src })));
  return row;
}

// Stesso gesto per le due fonti: cambia solo il messaggio al background.
function askDomain(afterRow, target) {
  if (afterRow.nextElementSibling?.dataset?.alias) return;
  const w = el('div', 'alias');
  w.dataset.alias = '1';
  const inp = el('input');
  inp.placeholder = target.key ? 'es. wizzair.com' : 'es. thespacecinema.it';
  inp.setAttribute('aria-label', 'Dominio da collegare');
  const save = el('button', 'btn primary', 'Collega');
  save.onclick = async () => {
    const d = inp.value.trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!d) { inp.focus(); return; }
    const r = await send(target.key
      ? { type: target.src === 'kl' ? 'klAlias' : 'revAlias', domain: d, key: target.key }
      : { type: 'alias', domain: d, id: target.id });
    // Il collegamento e' un gesto silenzioso: senza una riga di risposta non si distingue
    // "fatto" da "non ha funzionato". E quando il catalogo sa gia' dov'e' il negozio,
    // l'alias non viene creato affatto: dirlo e' l'unico modo di non farlo sembrare rotto.
    w.innerHTML = '';
    const sup = r && r.superseded;
    w.appendChild(el('div', 'alias-msg' + (sup ? ' warn' : ''), sup
      ? `Non serve: il catalogo ha già ${sup} per questo negozio, e vince sul collegamento manuale.`
      : !r ? 'Estensione non raggiungibile: riprova.'
      : `Collegato a ${r.domain || d}. Lo stacchi da "Collegamenti manuali".`));
    setTimeout(() => { w.remove(); refresh(); }, 3200);
  };
  inp.onkeydown = e => {
    if (e.key === 'Enter') save.click();
    if (e.key === 'Escape') { e.stopPropagation(); w.remove(); }
  };
  w.append(inp, save);
  afterRow.after(w);
  inp.focus();
}

// --- sezioni di manutenzione ------------------------------------------------

// Il catalogo CB è lungo (~900 righe): si costruisce solo quando la sezione viene aperta.
function renderCatalog() {
  const box = $('cb-list');
  box.innerHTML = '';
  const list = Object.entries(S.offers).sort(([, a], [, b]) => a.t.localeCompare(b.t));
  if (!list.length) {
    const e = el('div', 'empty');
    e.append(el('b', null, 'Catalogo non ancora scaricato'),
      'Fai login sul portale e premi "Aggiorna tutto": il primo crawl dura qualche minuto.');
    box.appendChild(e);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const [id, o] of list) frag.appendChild(cbRow(id, o, ''));
  box.appendChild(frag);
}

function renderRevolut(list) {
  const rs = S.revSync || {};
  $('rev-sub').textContent = busy(rs)
    ? 'aggiornamento in corso…'
    : rs.state === 'error'
      ? `ultimo tentativo fallito: ${rs.error}`
      : `aggiornato ${fmt((S.revolut || {}).at)}`;

  const box = $('rev-list');
  box.innerHTML = '';
  if (!list.length) {
    const e = el('div', 'empty');
    e.append(el('b', null, 'Nessun negozio Revolut in cache'),
      'Premi "Aggiorna Revolut": il catalogo arriva da sconti-api, non dal portale, quindi è veloce.');
    box.appendChild(e);
    return;
  }
  for (const o of list) box.appendChild(storeRow(o, 'rev', ''));
}

function renderKlarna(list) {
  const ks = S.klSync || {};
  $('kl-sub').textContent = busy(ks)
    ? 'aggiornamento in corso…'
    : ks.state === 'error'
      ? `ultimo tentativo fallito: ${ks.error}`
      : `aggiornato ${fmt((S.klarna || {}).at)}`;

  const box = $('kl-list');
  box.innerHTML = '';
  if (!list.length) {
    const e = el('div', 'empty');
    e.append(el('b', null, 'Nessun negozio Klarna in cache'),
      'Premi "Aggiorna Klarna": la lista arriva da klarna.com/it/store e tiene solo i negozi ' +
      'che danno cashback. Il cashback si prende comprando dalla Klarna app, non da qui.');
    box.appendChild(e);
    return;
  }
  // Ordine per tasso: il senso della sezione è "dove mi conviene passare dall'app".
  for (const o of [...list].sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name))) {
    box.appendChild(storeRow(o, 'kl', ''));
  }
}

// --- collegamenti manuali ---------------------------------------------------
// Sono l'unica cosa che l'utente crea deliberatamente, ed erano l'unica senza un elenco
// e senza un modo per toglierla: si scrivevano in storage e sparivano dalla vista.
// Le tre fonti stanno insieme perché la domanda è una sola — "cosa ho collegato a mano?"
// — e cambia solo il messaggio da mandare per staccarlo.

function aliasRows() {
  const nameOf = (list, k) => (list.find(o => o.name_key === k) || {}).name;
  const rev = (S.revolut || {}).offers || [];
  const kl = (S.klarna || {}).offers || [];
  const rows = [];
  for (const [d, ids] of Object.entries(S.aliases || {})) {
    for (const id of ids) {
      rows.push({ d, src: 'Corporate Benefits', label: (S.offers[id] || {}).t,
        undo: { type: 'unalias', domain: d, id } });
    }
  }
  for (const [d, keys] of Object.entries(S.revAliases || {})) {
    for (const k of keys) {
      rows.push({ d, src: 'Revolut', label: nameOf(rev, k),
        undo: { type: 'revUnalias', domain: d, key: k } });
    }
  }
  for (const [d, keys] of Object.entries(S.klAliases || {})) {
    for (const k of keys) {
      rows.push({ d, src: 'Klarna', label: nameOf(kl, k),
        undo: { type: 'klUnalias', domain: d, key: k } });
    }
  }
  return rows.sort((a, b) => a.d.localeCompare(b.d));
}

function renderAliases(rows) {
  const box = $('aliases');
  box.innerHTML = '';
  if (!rows.length) {
    const e = el('div', 'empty');
    e.append(el('b', null, 'Nessun collegamento manuale'),
      'Quando cerchi un negozio e usi "Collega a un sito", il collegamento finisce qui. ' +
      'Vince su qualunque euristica, e da qui lo stacchi.');
    box.appendChild(e);
    return;
  }
  for (const r of rows) {
    const row = el('div', 'item');
    const t = el('div', 't');
    t.append(el('b', null, r.label || '(negozio non più in catalogo)'),
      el('div', 'm', `${r.src} · collegato a ${r.d}`));
    row.append(t, act('undo', 'Stacca questo collegamento',
      async () => { await send(r.undo); refresh(); }));
    box.appendChild(row);
  }
}

function renderBlocked(pairs) {
  const box = $('blocked');
  box.innerHTML = '';
  if (!pairs.length) {
    const e = el('div', 'empty');
    e.append(el('b', null, 'Nessun falso positivo segnalato'),
      'Quando dal popup di un sito premi "Non c\'entra nulla", l\'offerta finisce qui. Da qui la rimetti in circolo.');
    box.appendChild(e);
    return;
  }
  for (const [d, id] of pairs) {
    const o = S.offers[id];
    const row = el('div', 'item');
    const t = el('div', 't');
    t.append(el('b', null, o ? o.t : '(offerta non più in catalogo)'),
      el('div', 'm', 'nascosta su ' + d));
    row.append(t, act('undo', 'Rimostra su questo sito',
      async () => { await send({ type: 'unreport', domain: d, id }); refresh(); }));
    box.appendChild(row);
  }
}

function renderMuted() {
  const box = $('muted');
  box.innerHTML = '';
  if (!S.muted.length) {
    const e = el('div', 'empty');
    e.append(el('b', null, 'Nessun sito silenziato'),
      '"Mai su questo sito" nel popup mette il dominio qui, e l\'estensione smette di parlare lì.');
    box.appendChild(e);
    return;
  }
  for (const d of S.muted) {
    const row = el('div', 'item');
    row.append(el('div', 't', d), act('bell', 'Riattiva gli avvisi',
      async () => { await send({ type: 'unmute', domain: d }); refresh(); }));
    box.appendChild(row);
  }
}

// --- credenziali del portale ---------------------------------------------------
// La password non torna mai indietro dal background: il campo resta vuoto e vuoto
// significa "non toccarla". Si riscrive solo per cambiarla.

function renderCreds() {
  const c = S.creds || { email: '', saved: false };
  $('n-creds').textContent = c.saved ? 'salvate' : 'da inserire';
  if (document.activeElement !== $('cred-email')) $('cred-email').value = c.email;
  $('cred-pass').placeholder = c.saved ? '•••••••• (salvata)' : 'password';
  $('cred-clear').disabled = !c.saved && !c.email;
}

// --- eventi -------------------------------------------------------------------

$('sync').onclick = async () => { await send({ type: 'syncAll' }); setTimeout(refresh, 300); };
$('portal').onclick = () => send({ type: 'openPortal' });

$('rev-sync').onclick = async () => {
  const b = $('rev-sync');
  b.disabled = true;
  b.classList.add('busy');
  await send({ type: 'revSync' });
  b.disabled = false;
  b.classList.remove('busy');
  refresh();
};

$('kl-sync').onclick = async () => {
  const b = $('kl-sync');
  b.disabled = true;
  b.classList.add('busy');
  await send({ type: 'klSync' });
  b.disabled = false;
  b.classList.remove('busy');
  refresh();
};

$('d-cb').addEventListener('toggle', () => { if ($('d-cb').open && live) renderCatalog(); });

$('cred-save').onclick = async () => {
  const r = await send({
    type: 'setCreds',
    email: $('cred-email').value,
    password: $('cred-pass').value
  });
  $('cred-msg').textContent = !r ? 'estensione non raggiungibile' : r.error || 'salvate';
  if (r && r.ok) $('cred-pass').value = '';
  refresh();
};

$('cred-clear').onclick = async () => {
  await send({ type: 'clearCreds' });
  $('cred-email').value = '';
  $('cred-pass').value = '';
  $('cred-msg').textContent = 'cancellate';
  refresh();
};

// Invio in uno dei due campi = Salva: è un form di due righe, non serve altro.
for (const id of ['cred-email', 'cred-pass']) {
  $(id).onkeydown = e => { if (e.key === 'Enter') $('cred-save').click(); };
}

$('q').oninput = search;
$('q-clear').onclick = () => { $('q').value = ''; $('q').focus(); search(); };

refresh();
