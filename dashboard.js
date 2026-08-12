// CB Reminder - dashboard (popup dell'estensione).
const $ = id => document.getElementById(id);
const send = msg => new Promise(r => chrome.runtime.sendMessage(msg, x => r(chrome.runtime.lastError ? null : x)));

let S = null;
let timer = null;

const fmt = ts => !ts ? 'mai' : new Date(ts).toLocaleString('it-IT',
  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function refresh() {
  S = await send({ type: 'state' });
  if (!S) return;
  const st = S.sync || {};
  const running = st.state === 'running';

  $('dot').className = 'dot' + (running ? ' run' : st.state === 'login' ? ' warn' : st.state === 'error' ? ' err' : '');
  $('title').textContent = running ? 'Sincronizzazione in corso…' : 'CB Reminder';
  $('sub').textContent = running
    ? `${st.phase === 'categorie' ? 'Leggo le categorie' : 'Leggo le offerte'} — ${st.done || 0}/${st.total || '?'}`
    : `Ultimo aggiornamento: ${fmt(S.updatedAt)}`;

  $('warn').innerHTML = '';
  if (st.state === 'login') warn('Sessione scaduta', 'Fai login sul portale, poi premi "Aggiorna tutto". Il catalogo salvato resta attivo ma può essere incompleto.');
  else if (st.state === 'error') warn('Sincronizzazione fallita', st.error || 'errore sconosciuto');

  $('bar').hidden = !running;
  if (running) $('bar').firstElementChild.style.width = `${Math.round(100 * (st.done || 0) / Math.max(st.total || 1, 1))}%`;
  $('sync').disabled = running;
  $('sync').textContent = running ? 'In corso…' : 'Aggiorna tutto';

  $('s-count').textContent = S.count;
  $('s-dom').textContent = S.withDomain;
  $('s-gc').textContent = S.giftcards;

  renderRevolut();
  search();
  renderBlocked();
  renderMuted();

  clearTimeout(timer);
  if (running) timer = setTimeout(refresh, 800);
}

function warn(title, text) {
  const d = document.createElement('div');
  d.className = 'warn-box';
  d.innerHTML = `<b>${title}</b> `;
  d.append(text);
  $('warn').appendChild(d);
}

// --- Revolut ---------------------------------------------------------------

function renderRevolut() {
  const rs = S.revSync || {};
  const list = (S.revolut || {}).offers || [];
  $('rev-sub').textContent = rs.state === 'error'
    ? `Ultimo aggiornamento fallito: ${rs.error}`
    : `${list.length} negozi — aggiornato ${fmt((S.revolut || {}).at)}`;

  const box = $('rev-list');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<div class="empty">Nessun negozio Revolut in cache.</div>';
    return;
  }
  for (const o of list) {
    const row = document.createElement('div');
    row.className = 'item';
    const t = document.createElement('div');
    t.className = 't';
    t.innerHTML = `<div>${esc(o.name)}</div><div class="m">${esc(o.domain || o.badge_raw)}${o.boosted ? ' · potenziato' : ''}</div>`;
    const pct = document.createElement('span');
    pct.className = 'pct rev';
    pct.textContent = o.label;
    row.append(t, pct, mini('collega a un sito', () => askRevDomain(row, o.name_key)));
    box.appendChild(row);
  }
}

function askRevDomain(afterRow, key) {
  if (afterRow.nextElementSibling?.dataset?.alias) return;
  const w = document.createElement('div');
  w.className = 'item';
  w.dataset.alias = '1';
  const inp = document.createElement('input');
  inp.placeholder = 'es. wizzair.com';
  const ok = mini('salva', async () => {
    const d = inp.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!d) return;
    await send({ type: 'revAlias', domain: d, key });
    w.remove();
    refresh();
  });
  w.append(inp, ok);
  afterRow.after(w);
  inp.focus();
}

// --- ricerca + alias manuale ----------------------------------------------

function search() {
  const q = $('q').value.trim().toLowerCase();
  const box = $('results');
  box.innerHTML = '';
  if (!q) { box.innerHTML = '<div class="empty">Scrivi per cercare tra le offerte scaricate.</div>'; return; }

  const hits = Object.entries(S.offers)
    .filter(([, o]) => o.t.toLowerCase().includes(q) || (o.h || '').includes(q))
    .slice(0, 20);
  if (!hits.length) { box.innerHTML = '<div class="empty">Nessuna offerta trovata.</div>'; return; }

  for (const [id, o] of hits) {
    const row = document.createElement('div');
    row.className = 'item';
    const t = document.createElement('div');
    t.className = 't';
    t.innerHTML = `<div>${esc(o.t)}</div><div class="m">${esc(o.h || 'nessun link')}${o.k === 'giftcard' ? ' · gift card' : ''}</div>`;
    const pct = document.createElement('span');
    pct.className = 'pct';
    pct.textContent = (o.d || '—').replace(/\s*sconto/i, '');
    const link = mini('collega a un sito', () => askDomain(row, id));
    const open = mini('apri', () => send({ type: 'open', id, cat: o.c }));
    row.append(t, pct, link, open);
    box.appendChild(row);
  }
}

function askDomain(afterRow, id) {
  if (afterRow.nextElementSibling?.dataset?.alias) return;
  const w = document.createElement('div');
  w.className = 'item';
  w.dataset.alias = '1';
  const inp = document.createElement('input');
  inp.placeholder = 'es. thespacecinema.it';
  const ok = mini('salva', async () => {
    const d = inp.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!d) return;
    await send({ type: 'alias', domain: d, id });
    w.remove();
    refresh();
  });
  w.append(inp, ok);
  afterRow.after(w);
  inp.focus();
}

// --- segnalazioni e mute ---------------------------------------------------

function renderBlocked() {
  const box = $('blocked');
  box.innerHTML = '';
  const pairs = Object.entries(S.blocked).flatMap(([d, ids]) => ids.map(id => [d, id]));
  if (!pairs.length) { box.innerHTML = '<div class="empty">Nessun falso positivo segnalato.</div>'; return; }
  for (const [d, id] of pairs) {
    const o = S.offers[id];
    const row = document.createElement('div');
    row.className = 'item';
    const t = document.createElement('div');
    t.className = 't';
    t.innerHTML = `<div>${esc(o ? o.t : '(offerta rimossa)')}</div><div class="m">nascosta su ${esc(d)}</div>`;
    row.append(t, mini('ripristina', async () => { await send({ type: 'unreport', domain: d, id }); refresh(); }));
    box.appendChild(row);
  }
}

function renderMuted() {
  const box = $('muted');
  box.innerHTML = '';
  if (!S.muted.length) { box.innerHTML = '<div class="empty">Nessun sito silenziato.</div>'; return; }
  for (const d of S.muted) {
    const row = document.createElement('div');
    row.className = 'item';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = d;
    row.append(t, mini('riattiva', async () => { await send({ type: 'unmute', domain: d }); refresh(); }));
    box.appendChild(row);
  }
}

// --- utils -----------------------------------------------------------------

function mini(txt, fn) {
  const b = document.createElement('button');
  b.className = 'mini';
  b.textContent = txt;
  b.onclick = fn;
  return b;
}

const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

$('rev-sync').onclick = async () => {
  $('rev-sync').disabled = true;
  await send({ type: 'revSync' });
  $('rev-sync').disabled = false;
  refresh();
};

$('sync').onclick = async () => { await send({ type: 'syncAll' }); setTimeout(refresh, 300); };
$('portal').onclick = () => send({ type: 'openPortal' });
$('q').oninput = () => S && search();

refresh();
