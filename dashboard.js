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

async function refresh() {
  const next = await send({ type: 'state' });
  // Il service worker MV3 viene terminato spesso: se non risponde va detto, non lasciato in bianco.
  if (!next) return unreachable();
  S = next;
  live = true;
  const st = S.sync || {};
  const running = st.state === 'running';

  $('dot').className = 'dot' + (running ? ' run' : st.state === 'login' ? ' warn'
    : st.state === 'error' ? ' err' : '');
  $('title').textContent = running ? 'Sincronizzazione' : 'Discount Check';
  $('sub').textContent = running
    ? `${st.phase === 'categorie' ? 'leggo le categorie' : 'leggo le offerte'} — ${st.done || 0}/${st.total || '?'}`
    : `aggiornato ${fmt(S.updatedAt)}`;

  $('warn').innerHTML = '';
  if (st.state === 'login') {
    warn('Sessione del portale scaduta',
      'Fai login sul portale e premi "Aggiorna tutto". Il catalogo salvato resta attivo, ma può essere incompleto.');
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
  $('s-count').textContent = S.count;
  $('s-rev').textContent = rev.length;

  const blocked = Object.entries(S.blocked).flatMap(([d, ids]) => ids.map(id => [d, id]));
  $('n-cb').textContent = S.count;
  $('n-rev').textContent = rev.length;
  $('n-blocked').textContent = blocked.length;
  $('n-muted').textContent = S.muted.length;

  if ($('d-cb').open) renderCatalog();
  renderRevolut(rev);
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

// Nessuna risposta dal background: schermata onesta con un modo per riprovare.
function unreachable() {
  live = false;
  $('dot').className = 'dot err';
  $('title').textContent = 'Discount Check';
  $('sub').textContent = 'nessuna risposta';
  $('bar').hidden = true;
  $('browse').hidden = true;
  $('results').hidden = true;
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
  box.hidden = !q;
  box.innerHTML = '';
  if (!q) { $('results-status').textContent = ''; return; }

  const cb = Object.entries(S.offers)
    .filter(([, o]) => norm(o.t).includes(q) || norm(o.h).includes(q))
    .sort(([, a], [, b]) => rank(a.t, b.t, q));

  const rev = ((S.revolut || {}).offers || [])
    .filter(o => norm(o.name).includes(q) || norm(o.domain).includes(q))
    .sort((a, b) => rank(a.name, b.name, q));

  $('results-status').textContent =
    `${cb.length} Corporate Benefits · ${rev.length} Revolut`;

  if (!cb.length && !rev.length) {
    const e = el('div', 'empty');
    e.append(el('b', null, `Nessun risultato per "${$('q').value.trim()}"`),
      `Cerco tra ${S.count} offerte Corporate Benefits e ${((S.revolut || {}).offers || []).length} negozi Revolut. ` +
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
    box.appendChild(group('Revolut', rev.length, true));
    for (const o of rev.slice(0, MAX_HITS)) box.appendChild(revRow(o, q));
    if (rev.length > MAX_HITS) box.appendChild(more(rev.length - MAX_HITS));
  }
}

function group(name, n, isRev) {
  const g = el('div', 'grp' + (isRev ? ' rev' : ''), name);
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

function revRow(o, q) {
  const row = el('div', 'item');
  row.append(el('span', 'pct rev', o.label));

  const t = el('div', 't');
  const title = el('b');
  title.appendChild(mark(o.name, q));
  const meta = el('div', 'm');
  meta.appendChild(mark(o.domain || o.badge_raw || '', o.domain ? q : ''));
  if (o.boosted) meta.append(' · potenziato');
  t.append(title, meta);

  row.append(t, act('link', 'Collega a un sito', () => askDomain(row, { key: o.name_key })));
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
    await send(target.key
      ? { type: 'revAlias', domain: d, key: target.key }
      : { type: 'alias', domain: d, id: target.id });
    w.remove();
    refresh();
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
  $('rev-sub').textContent = rs.state === 'error'
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
  for (const o of list) box.appendChild(revRow(o, ''));
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

$('d-cb').addEventListener('toggle', () => { if ($('d-cb').open && live) renderCatalog(); });

$('q').oninput = search;
$('q-clear').onclick = () => { $('q').value = ''; $('q').focus(); search(); };

refresh();
