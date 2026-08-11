// CB Reminder - rileva il checkout e mostra il reminder.
(() => {
  if (window.top !== window) return;

  const CHECKOUT_URL = /(checkout|\/cart|carrello|basket|panier|kasse|pagamento|payment|\/order|ordine|riepilogo)/i;
  const CHECKOUT_TEXT = /(procedi al pagamento|vai alla cassa|completa l.ordine|conferma (e paga|ordine)|concludi l.ordine|paga ora|acquista ora|proceed to checkout|place order|complete order|pay now)/i;

  let state = null;      // risposta del background per questo dominio
  let shown = false;
  let checks = 0;

  chrome.runtime.sendMessage({ type: 'check', host: location.hostname }, res => {
    if (chrome.runtime.lastError || !res || res.muted) return;
    state = res;
    if (!res.offers.length && !res.empty) return;   // niente da dire su questo sito
    watch();
  });

  // --- rilevamento checkout ------------------------------------------------

  function isCheckout() {
    if (CHECKOUT_URL.test(location.pathname + location.search)) return true;
    const els = document.querySelectorAll('button, a[role="button"], input[type="submit"], [class*="checkout" i]');
    for (const el of els) {
      const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
      if (t && t.length < 60 && CHECKOUT_TEXT.test(t)) return true;
    }
    return false;
  }

  function tick() {
    if (shown || checks++ > 40) return;
    if (isCheckout()) maybeShow();
  }

  function watch() {
    tick();
    const mo = new MutationObserver(debounce(tick, 800));
    mo.observe(document.documentElement, { childList: true, subtree: true });
    for (const m of ['pushState', 'replaceState']) {
      const orig = history[m];
      history[m] = function () { const r = orig.apply(this, arguments); shown = false; setTimeout(tick, 400); return r; };
    }
    addEventListener('popstate', () => { shown = false; setTimeout(tick, 400); });
    setTimeout(tick, 2500);
  }

  function debounce(fn, ms) {
    let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  // --- reminder ------------------------------------------------------------

  async function maybeShow() {
    if (shown || !state) return;

    // Catalogo mai sincronizzato: non so se il sito è convenzionato, avviso 1 volta al giorno.
    if (!state.offers.length) {
      if (!state.empty) return;
      const r = await send({ type: 'nudge' });
      if (!r || !r.show) return;
      shown = true;
      return render({ kind: 'setup' });
    }

    if (state.snoozed && !state.needLogin) return;
    shown = true;
    render({ kind: 'offers' });
  }

  const send = msg => new Promise(res =>
    chrome.runtime.sendMessage(msg, r => res(chrome.runtime.lastError ? null : r)));

  function render({ kind }) {
    document.getElementById('cb-reminder-root')?.remove();
    const root = document.createElement('div');
    root.id = 'cb-reminder-root';
    root.style.cssText = 'all:initial;position:fixed;z-index:2147483647;bottom:16px;right:16px;';
    const sh = root.attachShadow({ mode: 'closed' });
    sh.appendChild(style());
    sh.appendChild(kind === 'setup' ? setupCard() : offersCard());
    (document.body || document.documentElement).appendChild(root);
  }

  function style() {
    const s = document.createElement('style');
    s.textContent = `
      :host, * { box-sizing: border-box; }
      .card { position:relative; width: 420px; max-height: 80vh; overflow:auto; background:#fff; color:#111827;
        font: 14px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif;
        border:1px solid #e5e7eb; border-radius:14px; box-shadow:0 16px 40px rgba(0,0,0,.2); padding:18px; }
      .hd { display:flex; align-items:center; gap:8px; font-weight:700; font-size:15px;
        margin-bottom:2px; padding-right:30px; }
      .dot { width:9px; height:9px; border-radius:50%; background:#16a34a; flex:none; }
      .dot.warn { background:#d97706; }
      .sub { color:#6b7280; font-size:12.5px; margin-bottom:12px; }
      .close { position:absolute; top:12px; right:12px; width:30px; height:30px; border:0; background:none;
        color:#9ca3af; font-size:22px; line-height:1; cursor:pointer; border-radius:8px; padding:0;
        font-family:inherit; display:flex; align-items:center; justify-content:center; }
      .close:hover { background:#f3f4f6; color:#111827; }
      .warn-box { background:#fffbeb; border:1px solid #fde68a; color:#92400e; border-radius:9px;
        padding:10px 12px; font-size:13px; margin-bottom:12px; }
      .warn-box b { display:block; margin-bottom:2px; }
      .o { display:flex; gap:12px; align-items:flex-start; padding:11px 0; border-top:1px solid #f3f4f6; }
      .pct { font-weight:700; font-size:13px; color:#065f46; background:#ecfdf5; border-radius:7px;
        padding:4px 8px; white-space:nowrap; flex:none; }
      .t { font-weight:600; }
      .k { font-size:12px; color:#6b7280; }
      .go { margin-left:auto; flex:none; background:#111827; color:#fff; border:0; border-radius:8px;
        padding:8px 14px; font-size:13px; cursor:pointer; font-family:inherit; }
      .go:hover { background:#374151; }
      .ft { display:flex; gap:14px; margin-top:14px; padding-top:12px; border-top:1px solid #f3f4f6; flex-wrap:wrap; }
      .lnk { background:none; border:0; padding:0; color:#6b7280; font-size:12.5px; cursor:pointer;
        text-decoration:underline; font-family:inherit; }
      .lnk:hover { color:#111827; }
      @media (prefers-color-scheme: dark) {
        .card { background:#111827; color:#f3f4f6; border-color:#374151; }
        .o { border-top-color:#1f2937; } .ft { border-top-color:#1f2937; }
        .pct { color:#6ee7b7; background:#064e3b; }
        .go { background:#f3f4f6; color:#111827; }
        .go:hover { background:#fff; color:#111827; }
        .warn-box { background:#3f2d0b; border-color:#78350f; color:#fcd34d; }
        .lnk { color:#9ca3af; }
        .lnk:hover { color:#fff; }
        .close:hover { background:#374151; color:#fff; }
      }`;
    return s;
  }

  function shell(titleTxt, subTxt, warn) {
    const c = document.createElement('div');
    c.className = 'card';
    const x = document.createElement('button');
    x.className = 'close';
    x.textContent = '×';
    x.title = 'Chiudi';
    x.setAttribute('aria-label', 'Chiudi');
    x.onclick = close;
    c.appendChild(x);
    const hd = document.createElement('div');
    hd.className = 'hd';
    const d = document.createElement('span');
    d.className = 'dot' + (warn ? ' warn' : '');
    hd.append(d, document.createTextNode(titleTxt));
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = subTxt;
    c.append(hd, sub);
    return c;
  }

  function setupCard() {
    const c = shell('CB Reminder', 'Stai per completare un acquisto.', true);
    const w = document.createElement('div');
    w.className = 'warn-box';
    w.innerHTML = '<b>Catalogo non ancora scaricato</b>Fai login su Corporate Benefits e premi "Aggiorna ora" nell\'estensione: potresti avere uno sconto anche qui.';
    c.appendChild(w);
    const ft = document.createElement('div');
    ft.className = 'ft';
    ft.append(link('Apri il portale', () => send({ type: 'openPortal' })));
    c.appendChild(ft);
    return c;
  }

  function offersCard() {
    const n = state.offers.length;
    const c = shell(
      n > 1 ? `${n} sconti disponibili su ${state.domain}` : `1 sconto disponibile su ${state.domain}`,
      'Corporate Benefits — prima di pagare, controlla.',
      state.needLogin
    );

    if (state.needLogin) {
      const w = document.createElement('div');
      w.className = 'warn-box';
      w.innerHTML = '<b>Sessione scaduta</b>Devi fare login su Corporate Benefits per usare questi sconti.';
      c.appendChild(w);
    }

    for (const o of state.offers) {
      const row = document.createElement('div');
      row.className = 'o';
      const pct = document.createElement('span');
      pct.className = 'pct';
      pct.textContent = (o.d || '—').replace(/\s*sconto/i, '');
      const box = document.createElement('div');
      const t = document.createElement('div');
      t.className = 't'; t.textContent = o.t;
      const k = document.createElement('div');
      k.className = 'k';
      k.textContent = o.k === 'giftcard'
        ? 'Gift card scontata — compra la card e pagaci il carrello'
        : o.k === 'shop' ? 'Convenzione — parti dal portale per il tracking'
          : 'Convenzione';
      box.append(t, k);
      const go = document.createElement('button');
      go.className = 'go';
      go.textContent = state.needLogin ? 'Login' : 'Apri';
      go.onclick = () => send({ type: 'open', id: o.id, cat: o.c });
      row.append(pct, box, go);
      c.appendChild(row);
    }

    const ft = document.createElement('div');
    ft.className = 'ft';
    ft.append(
      link('Ricordamelo dopo', async () => { await send({ type: 'snooze', domain: state.domain }); close(); }),
      link('Mai su questo sito', async () => { await send({ type: 'mute', domain: state.domain }); close(); }),
      link('Non c\'entra nulla', async () => {
        await send({ type: 'report', domain: state.domain, ids: state.offers.map(o => o.id) });
        close();
      })
    );
    c.appendChild(ft);
    return c;
  }

  function link(txt, fn) {
    const b = document.createElement('button');
    b.className = 'lnk';
    b.textContent = txt;
    b.onclick = fn;
    return b;
  }

  function close() { document.getElementById('cb-reminder-root')?.remove(); }
})();
