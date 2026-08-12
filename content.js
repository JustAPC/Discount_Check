// Discount Check - rileva il checkout e mostra il reminder.
(() => {
  if (window.top !== window) return;
  // Non è più un content script dichiarato nel manifest: lo inietta il background a
  // ogni navigazione utile, e su una SPA la stessa pagina può riceverne più di una.
  // Il mondo isolato sopravvive alle navigazioni via history, questo flag anche.
  if (window.__discountCheck) return;
  window.__discountCheck = true;

  const CHECKOUT_URL =
    /(checkout|\/cart|carrello|basket|panier|kasse|pagamento|payment|\/order|ordine|riepilogo)/i;
  const CHECKOUT_TEXT =
    /(procedi al pagamento|vai alla cassa|completa l.ordine|conferma (e paga|ordine)|concludi l.ordine|paga ora|acquista ora|proceed to checkout|place order|complete order|pay now)/i;

  let state = null; // risposta del background per questo dominio
  let shown = false;
  let checks = 0;

  const DISCOUNT = /[%€]|\bsconto\b|\bgratis\b/i;
  const SVG = "http://www.w3.org/2000/svg";
  const PATHS = {
    x: ["M6 6 18 18", "M18 6 6 18"],
    alert: ["M12 4.5 21 19.5H3z", "M12 10v4", "M12 17h.01"],
    external: [
      "M14 4h6v6",
      "M20 4 11 13",
      "M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10",
    ],
  };

  chrome.runtime.sendMessage({ type: "check", host: location.hostname }, (res) => {
    if (chrome.runtime.lastError || !res || res.muted) return;
    state = res;
    state.rev = res.rev || [];
    state.kl = res.kl || [];
    // Ogni fonte da sola basta a far uscire il popup: non dipendono l'una dall'altra.
    if (!res.offers.length && !state.rev.length && !state.kl.length && !res.empty) return;
    watch();
  });

  // --- rilevamento checkout ------------------------------------------------

  function isCheckout() {
    if (CHECKOUT_URL.test(location.pathname + location.search)) return true;
    const els = document.querySelectorAll(
      'button, a[role="button"], input[type="submit"], [class*="checkout" i]',
    );
    for (const el of els) {
      const t = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim();
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
    for (const m of ["pushState", "replaceState"]) {
      const orig = history[m];
      history[m] = function () {
        const r = orig.apply(this, arguments);
        shown = false;
        setTimeout(tick, 400);
        return r;
      };
    }
    addEventListener("popstate", () => {
      shown = false;
      setTimeout(tick, 400);
    });
    setTimeout(tick, 2500);
  }

  function debounce(fn, ms) {
    let t;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  // --- reminder ------------------------------------------------------------

  async function maybeShow() {
    if (shown || !state) return;

    // Catalogo mai sincronizzato: non so se il sito è convenzionato, avviso 1 volta al giorno.
    if (!state.offers.length && !state.rev.length && !state.kl.length) {
      if (!state.empty) return;
      const r = await send({ type: "nudge" });
      if (!r || !r.show) return;
      shown = true;
      return render({ kind: "setup" });
    }

    if (state.snoozed && !state.needLogin) return;
    shown = true;
    render({ kind: "offers" });
  }

  const send = (msg) =>
    new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(chrome.runtime.lastError ? null : r)));

  function render({ kind }) {
    document.getElementById("discount-check-root")?.remove();
    const root = document.createElement("div");
    root.id = "discount-check-root";
    root.style.cssText = "all:initial;position:fixed;z-index:2147483647;bottom:16px;right:16px;";
    const sh = root.attachShadow({ mode: "closed" });
    sh.appendChild(style());
    sh.appendChild(kind === "setup" ? setupCard() : offersCard());
    (document.body || document.documentElement).appendChild(root);
  }

  // Stessi token della dashboard: il verde resta Corporate Benefits, il viola resta Revolut.
  function style() {
    const s = document.createElement("style");
    s.textContent = `
      :host, * { box-sizing: border-box; }
      :host {
        --surface:#fff; --raise:#f1f3f5; --line:#e4e7ea; --line-soft:#eef0f2;
        --ink:#14161a; --ink-2:#59626e; --ink-3:#69727d;
        --cb-ink:#067a52; --cb-bg:#e6f5ee; --rev-ink:#6b28d9; --rev-bg:#f0eafd;
        --kl-ink:#b0114c; --kl-bg:#fde8ef;
        --warn-ink:#8a5106; --warn-bg:#fdf3e2; --warn-line:#f2d9a8;
        --focus:#2563eb; --sel:#dbe6ff; --r:8px; --t:160ms cubic-bezier(.2,.7,.3,1);
      }
      @media (prefers-color-scheme: dark) {
        :host {
          --surface:#16191e; --raise:#232830; --line:#272c34; --line-soft:#1e232a;
          --ink:#eceef1; --ink-2:#9aa4b0; --ink-3:#7d8794;
          --cb-ink:#34d399; --cb-bg:#06301f; --rev-ink:#c4b5fd; --rev-bg:#2e1065;
          --kl-ink:#f9a8c8; --kl-bg:#450a25;
          --warn-ink:#fbbf24; --warn-bg:#2f2409; --warn-line:#5a4310;
          --focus:#60a5fa; --sel:#1e3a8a;
        }
      }
      ::selection { background:var(--sel); }
      .card { position:relative; width:400px; max-height:80vh; overflow:auto;
        background:var(--surface); color:var(--ink);
        font:12.5px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-variant-numeric:tabular-nums; caret-color:var(--focus);
        -webkit-font-smoothing:antialiased;
        scrollbar-color:var(--line) transparent;
        border:1px solid var(--line); border-radius:14px;
        box-shadow:0 12px 32px rgba(9,12,17,.22), 0 2px 6px rgba(9,12,17,.10);
        padding:15px 16px 14px;
        animation:in 220ms cubic-bezier(.2,.7,.3,1); }
      .card::-webkit-scrollbar { width:9px; }
      .card::-webkit-scrollbar-thumb { background:var(--line); border-radius:9px;
        border:3px solid var(--surface); }
      .card::-webkit-scrollbar-thumb:hover { background:var(--ink-3); }
      @keyframes in { from { opacity:0; transform:translateY(10px) } }
      :focus-visible { outline:2px solid var(--focus); outline-offset:2px; border-radius:4px; }
      .ic { width:16px; height:16px; flex:none; stroke:currentColor; fill:none;
        stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }

      .hd { display:flex; align-items:center; gap:8px; font-weight:650; font-size:14.5px;
        letter-spacing:-.015em; padding-right:26px; }
      .dot { width:7px; height:7px; border-radius:50%; background:var(--cb-ink); flex:none; }
      .dot.warn { background:var(--warn-ink); }
      .sub { color:var(--ink-2); font-size:11px; margin:3px 0 12px; }
      .close { position:absolute; top:11px; right:11px; display:flex; padding:5px; border:0;
        background:none; color:var(--ink-3); cursor:pointer; border-radius:6px;
        transition:background var(--t), color var(--t); }
      .close:hover { color:var(--ink); background:color-mix(in srgb, var(--ink) 10%, var(--raise)); }

      .warn-box { display:flex; gap:8px; background:var(--warn-bg); color:var(--warn-ink);
        border:1px solid var(--warn-line); border-radius:var(--r); padding:9px 10px;
        font-size:12.5px; margin-bottom:10px; }
      .warn-box .ic { margin-top:1px; }
      .warn-box b { font-weight:600; }

      .o { display:flex; gap:10px; align-items:center; padding:9px 0;
        border-top:1px solid var(--line-soft); }
      .pct { font-weight:650; font-size:11px; letter-spacing:-.01em; white-space:nowrap;
        flex:none; min-width:46px; max-width:76px; overflow:hidden; text-overflow:ellipsis;
        text-align:center; padding:4px 6px; border-radius:6px;
        color:var(--cb-ink); background:var(--cb-bg); }
      .pct.rev { color:var(--rev-ink); background:var(--rev-bg); }
      /* "fino a 1,5%" non sta in 76px: al chip Klarna serve più corda. */
      .pct.kl { color:var(--kl-ink); background:var(--kl-bg); max-width:96px; }
      .pct.none { color:var(--ink-3); background:var(--raise); }
      .box { flex:1; min-width:0; }
      .t { font-weight:550; font-size:12.5px; }
      .k { font-size:11px; color:var(--ink-2); }
      .go { margin-left:auto; flex:none; display:inline-flex; align-items:center; gap:6px;
        background:var(--ink); color:var(--surface); border:1px solid var(--ink);
        border-radius:var(--r); padding:8px 11px; font:inherit; font-size:12.5px; font-weight:550;
        line-height:1; cursor:pointer; transition:background var(--t), border-color var(--t); }
      .go:hover { background:var(--ink-2); border-color:var(--ink-2); }
      .ft { display:flex; gap:12px; margin-top:12px; padding-top:11px;
        border-top:1px solid var(--line-soft); flex-wrap:wrap; }
      .lnk { background:none; border:0; padding:0; color:var(--ink-2); font:inherit;
        font-size:11px; cursor:pointer; text-underline-offset:2px; text-decoration:underline;
        text-decoration-color:var(--line); transition:color var(--t), text-decoration-color var(--t); }
      .lnk:hover { color:var(--ink); text-decoration-color:currentColor; }

      @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important } }`;
    return s;
  }

  // Nel Shadow DOM non arrivano gli sprite della pagina: gli icon si disegnano qui.
  function icon(name) {
    const s = document.createElementNS(SVG, "svg");
    s.setAttribute("class", "ic");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    for (const d of PATHS[name]) {
      const p = document.createElementNS(SVG, "path");
      p.setAttribute("d", d);
      s.appendChild(p);
    }
    return s;
  }

  function warnBox(title, text) {
    const w = document.createElement("div");
    w.className = "warn-box";
    w.appendChild(icon("alert"));
    const body = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = title;
    body.append(b, document.createTextNode(" " + text));
    w.appendChild(body);
    return w;
  }

  function shell(titleTxt, subTxt, warn) {
    const c = document.createElement("div");
    c.className = "card";
    const x = document.createElement("button");
    x.className = "close";
    x.appendChild(icon("x"));
    x.title = "Chiudi";
    x.setAttribute("aria-label", "Chiudi");
    x.onclick = close;
    c.appendChild(x);
    const hd = document.createElement("div");
    hd.className = "hd";
    const d = document.createElement("span");
    d.className = "dot" + (warn ? " warn" : "");
    hd.append(d, document.createTextNode(titleTxt));
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = subTxt;
    c.append(hd, sub);
    return c;
  }

  function setupCard() {
    const c = shell("Discount Check", "Stai per completare un acquisto.", true);
    c.appendChild(
      warnBox(
        "Catalogo non ancora scaricato",
        'Fai login su Corporate Benefits e premi "Aggiorna tutto" nell\'estensione: potresti avere uno sconto anche qui.',
      ),
    );
    const ft = document.createElement("div");
    ft.className = "ft";
    ft.append(link("Apri il portale", () => send({ type: "openPortal" })));
    c.appendChild(ft);
    return c;
  }

  // Le fonti "come paghi" (Revolut, Klarna) non hanno un link da aprire: sono righe di
  // promemoria. Stessa struttura, cambia il colore del chip e la spiegazione.
  function storeRow(o, cls, note) {
    const row = document.createElement("div");
    row.className = "o";
    const pct = document.createElement("span");
    pct.className = "pct " + cls;
    pct.textContent = o.label;
    const box = document.createElement("div");
    box.className = "box";
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = o.name;
    const k = document.createElement("div");
    k.className = "k";
    k.textContent = note;
    box.append(t, k);
    row.append(pct, box);
    return row;
  }

  function subtitle() {
    const sources = [state.offers.length, state.rev.length, state.kl.length].filter(Boolean);
    if (sources.length > 1) {
      return state.kl.length
        ? "Più vantaggi qui: guarda come conviene pagare prima di concludere."
        : "Convenzione e punti Revolut si sommano: puoi usarli insieme.";
    }
    if (state.offers.length) return "Corporate Benefits — prima di pagare, controlla.";
    if (state.rev.length) return "Revolut — scegli con che carta pagare.";
    return "Klarna — il cashback si prende solo comprando dalla Klarna app.";
  }

  function offersCard() {
    const n = state.offers.length + state.rev.length + state.kl.length;
    const c = shell(
      n > 1 ? `${n} vantaggi disponibili su ${state.domain}` : `1 vantaggio disponibile su ${state.domain}`,
      subtitle(),
      state.needLogin && state.offers.length,
    );

    for (const o of state.rev) {
      c.appendChild(
        storeRow(
          o,
          "rev",
          o.boosted
            ? "Revolut — paga con la carta Revolut, tasso potenziato"
            : "Revolut — paga con la carta Revolut",
        ),
      );
    }

    // Il cashback Klarna non scatta pagando qui: va comprato dentro l'app. Dirlo nella
    // riga evita di far credere che basti finire questo checkout.
    for (const o of state.kl) {
      c.appendChild(storeRow(o, "kl", "Klarna"));
    }

    if (state.needLogin && state.offers.length) {
      c.appendChild(
        warnBox("Sessione scaduta", "Devi fare login su Corporate Benefits per usare questi sconti."),
      );
    }

    for (const o of state.offers) {
      const row = document.createElement("div");
      row.className = "o";
      // Stesso criterio della dashboard: nel chip solo ciò che si legge come sconto.
      const isDisc = DISCOUNT.test(o.d || "");
      const pct = document.createElement("span");
      pct.className = "pct" + (isDisc ? "" : " none");
      pct.textContent = (isDisc && o.d.replace(/\s*sconto/i, "").trim()) || "—";
      const box = document.createElement("div");
      box.className = "box";
      const t = document.createElement("div");
      t.className = "t";
      t.textContent = o.t;
      const k = document.createElement("div");
      k.className = "k";
      k.textContent =
        o.k === "giftcard"
          ? "Gift card scontata — compra la card e pagaci il carrello"
          : o.k === "shop"
            ? "Convenzione — parti dal portale per il tracking"
            : "Convenzione";
      if (!isDisc && o.d) k.textContent += " · " + o.d;
      box.append(t, k);
      const go = document.createElement("button");
      go.className = "go";
      go.append(icon("external"), state.needLogin ? "Login" : "Apri");
      go.onclick = () => send({ type: "open", id: o.id, cat: o.c });
      row.append(pct, box, go);
      c.appendChild(row);
    }

    const ft = document.createElement("div");
    ft.className = "ft";
    ft.append(
      link("Ricordamelo dopo", async () => {
        await send({ type: "snooze", domain: state.domain });
        close();
      }),
      link("Mai su questo sito", async () => {
        await send({ type: "mute", domain: state.domain });
        close();
      }),
      link("Non c'entra nulla", async () => {
        await send({
          type: "report",
          domain: state.domain,
          ids: state.offers.map((o) => o.id),
          revKeys: state.rev.map((o) => o.name_key),
          klKeys: state.kl.map((o) => o.name_key),
        });
        close();
      }),
    );
    c.appendChild(ft);
    return c;
  }

  function link(txt, fn) {
    const b = document.createElement("button");
    b.className = "lnk";
    b.textContent = txt;
    b.onclick = fn;
    return b;
  }

  function close() {
    document.getElementById("discount-check-root")?.remove();
  }
})();
