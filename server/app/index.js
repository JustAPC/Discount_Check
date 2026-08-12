// sconti-api — pochi endpoint sopra MariaDB. Nessuna logica di dominio: decide Hermes.
//
//   GET  /revolut/offers   → lista attiva. Pubblica: quali negozi diano punti non è un segreto
//   POST /revolut/ingest   → applica letteralmente upsert/deactivate già approvati
//   POST /revolut/domains  → scrive e corregge i domini, l'unico campo che non viene dagli screenshot
//
// La scrittura è protetta solo da INGEST_TOKEN, quindi senza token il server rifiuta di
// scrivere: meglio un ingest che non parte che un catalogo che chiunque può riempire.

import http from 'node:http';
import mysql from 'mysql2/promise';

const PORT = +(process.env.PORT || 8080);
const TOKEN = process.env.INGEST_TOKEN || '';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'sconti',
  connectionLimit: 4,
  charset: 'utf8mb4'
});

// --- parsing badge ---------------------------------------------------------
// Il testo arriva dalla lettura del tile: "2 per 10 €", "20 per 10 EUR", "Fino a 10%".
// Il parser sta qui e non nella skill: una regola sola, in un posto solo.

function parseBadge(raw) {
  const s = String(raw || '').replace(',', '.');
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(s);
  if (pct) return { kind: 'cashback', rate: +pct[1] };
  const pts = /(\d+(?:\.\d+)?)\s*per\s*10/i.exec(s);
  if (pts) return { kind: 'points', rate: +pts[1] };
  const bare = /(\d+(?:\.\d+)?)/.exec(s);
  if (bare) return { kind: 'points', rate: +bare[1] };
  return null;
}

// Chiave di dedup, non di matching: il matching lo fa l'estensione con le sue regole.
const nameKey = s => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '');

// "https://www.Zalando.it/donna" → "zalando.it". Vuoto → null, così non sovrascrive un alias.
const cleanDomain = s => String(s || '').trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || null;

// --- handlers --------------------------------------------------------------

async function getOffers() {
  const [rows] = await pool.query(
    `SELECT id, name, name_key, kind, rate, badge_raw, boosted, channel, domain, last_seen
       FROM revolut_offer
      WHERE active = 1 AND channel <> 'instore'
      ORDER BY rate DESC, name`
  );
  const [[agg]] = await pool.query(
    `SELECT MAX(last_seen) AS updated_at FROM revolut_offer WHERE active = 1`
  );
  return {
    updated_at: agg.updated_at,
    offers: rows.map(r => ({
      ...r,
      rate: +r.rate,
      boosted: !!r.boosted,
      // Etichetta pronta da stampare: "2x" | "10%". Il client non fa formattazione.
      label: r.kind === 'cashback' ? `${+r.rate}%` : `${+r.rate}x`
    }))
  };
}

async function ingest(body) {
  const day = (body.captured_at || new Date().toISOString()).slice(0, 10);
  const upsert = Array.isArray(body.upsert) ? body.upsert : [];
  const deactivate = Array.isArray(body.deactivate) ? body.deactivate : [];

  const skipped = [];
  let upserted = 0;

  for (const o of upsert) {
    const parsed = parseBadge(o.badge_raw);
    const key = nameKey(o.name);
    if (!parsed || !key) { skipped.push(o.name || '(senza nome)'); continue; }

    // first_seen si conserva: serve a distinguere un'offerta nuova da una che rientra.
    //
    // Il dominio salvato vince sempre su quello dell'ingest: è l'unico campo che non
    // arriva dagli screenshot ma da una decisione presa guardando il sito vero, e la
    // skill lo *propone* al passo 4, dove un "ok" distratto lo sostituirebbe in
    // silenzio. Qui l'ingest può solo riempire un vuoto; per correggere un dominio
    // sbagliato c'è POST /revolut/domains, che è esplicito per costruzione.
    await pool.execute(
      `INSERT INTO revolut_offer
         (name, name_key, kind, rate, badge_raw, boosted, channel, domain, active, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), kind = VALUES(kind), rate = VALUES(rate),
         badge_raw = VALUES(badge_raw), boosted = VALUES(boosted),
         domain = COALESCE(domain, VALUES(domain)),
         active = 1, last_seen = VALUES(last_seen)`,
      [o.name, key, parsed.kind, parsed.rate, o.badge_raw, o.boosted ? 1 : 0,
       o.channel || 'online', cleanDomain(o.domain), day, day]
    );
    upserted++;
  }

  let deactivated = 0;
  if (deactivate.length) {
    const keys = deactivate.map(nameKey).filter(Boolean);
    if (keys.length) {
      const [res] = await pool.query(
        `UPDATE revolut_offer SET active = 0 WHERE name_key IN (?)`, [keys]
      );
      deactivated = res.affectedRows;
    }
  }
  return { upserted, deactivated, skipped };
}

// Il dominio è ciò che aggancia il negozio al sito su cui stai comprando, ed è l'unico
// campo che non si legge da uno screenshot: lo si decide guardando dove si compra
// davvero. Sta qui e non dentro l'ingest perché l'ingest pretende anche il badge, e
// per correggere "itaairways" non si dovrebbe essere costretti a riscriverne il tasso.
//
// Prende { name_key: dominio }. Un valore vuoto o null cancella il dominio, così
// "l'ho messo sbagliato" si disfa senza aprire il database.
async function setDomains(body) {
  const set = [];
  const unset = [];
  const unknown = [];

  for (const [rawKey, rawDom] of Object.entries(body || {})) {
    const key = nameKey(rawKey);
    if (!key) continue;
    const dom = cleanDomain(rawDom);
    const [res] = await pool.execute(
      `UPDATE revolut_offer SET domain = ? WHERE name_key = ?`, [dom, key]
    );
    // Nessuna riga toccata = chiave che non esiste. Va detto: e' quasi sempre un nome
    // scritto a mano che non corrisponde a nessun negozio, e in silenzio sembrerebbe
    // riuscito.
    if (!res.affectedRows) unknown.push(key);
    else (dom ? set : unset).push(key);
  }
  return { set, unset, unknown };
}

// --- server ----------------------------------------------------------------

const send = (res, code, obj) => {
  const b = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(b),
    'cache-control': 'no-store'
  });
  res.end(b);
};

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new Error('body troppo grande');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      await pool.query('SELECT 1');
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/revolut/offers') {
      return send(res, 200, await getOffers());
    }

    if (req.method === 'POST' && url.pathname === '/revolut/ingest') {
      if (!TOKEN) return send(res, 503, { error: 'INGEST_TOKEN non configurato' });
      if (req.headers['x-ingest-token'] !== TOKEN) {
        return send(res, 403, { error: 'token non valido' });
      }
      return send(res, 200, await ingest(await readJson(req)));
    }

    if (req.method === 'POST' && url.pathname === '/revolut/domains') {
      if (!TOKEN) return send(res, 503, { error: 'INGEST_TOKEN non configurato' });
      if (req.headers['x-ingest-token'] !== TOKEN) {
        return send(res, 403, { error: 'token non valido' });
      }
      return send(res, 200, await setDomains(await readJson(req)));
    }

    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, () => console.log(`sconti-api su :${PORT}`));
