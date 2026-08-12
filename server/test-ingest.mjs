// Test della logica di lock in ingest().
//
// Carica il vero app/index.js sostituendo solo le due righe di import (http e mysql2) con
// degli stub, e intercetta le query. Verifica quale SQL viene prodotto nei quattro casi.
//
// Non verifica che MariaDB accetti quell'SQL: per quello serve il DB vero (vedi README).
//
//   node test-ingest.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'app', 'index.js'), 'utf8');

const calls = [];
globalThis.__mock = {
  http: { createServer: () => ({ listen: () => {} }) },
  mysql: {
    createPool: () => ({
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (/SELECT name_key, channel/.test(sql)) {
          // Samsung è stato corretto a mano in un ingest precedente.
          return [[{ name_key: 'samsung', channel: 'online' }]];
        }
        if (/^UPDATE/.test(sql.trim())) return [{ affectedRows: (params?.[0] || []).length }];
        return [[{ updated_at: null }]];
      },
      execute: async (sql, params) => { calls.push({ sql, params }); return [{}]; }
    })
  }
};

const patched = src
  .replace(/^import http from 'node:http';$/m, 'const http = globalThis.__mock.http;')
  .replace(/^import mysql from 'mysql2\/promise';$/m, 'const mysql = globalThis.__mock.mysql;')
  + '\nexport { ingest, parseBadge };\n';

const tmp = path.join(here, '.test-index.mjs');
fs.writeFileSync(tmp, patched);
const { ingest, parseBadge } = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);

let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { fail++; console.log(`FAIL ${name}${extra ? '\n     ' + extra : ''}`); }
};

const lastUpsert = () => calls.filter(c => /INSERT INTO revolut_offer/.test(c.sql)).at(-1);
const reset = () => { calls.length = 0; };

// --- parseBadge ------------------------------------------------------------
check('parseBadge punti', parseBadge('4 per 10 €')?.rate === 4);
check('parseBadge cashback', parseBadge('Fino a 10%')?.kind === 'cashback');
check('parseBadge illeggibile', parseBadge('—') === null);

// --- 1. riga NON bloccata, lettura automatica: si aggiorna -----------------
reset();
let r = await ingest({ upsert: [{ name: 'Glovo', badge_raw: '3 per 10 €' }] });
let sql = lastUpsert().sql;
check('normale: aggiorna il valore', /rate = VALUES\(rate\)/.test(sql));
check('normale: non tocca il flag', /locked = locked/.test(sql));
check('normale: non risulta protetta', r.protected.length === 0);

// --- 2. riga BLOCCATA, lettura automatica: non si tocca --------------------
reset();
r = await ingest({ upsert: [{ name: 'Samsung', badge_raw: '9 per 10 €' }] });
sql = lastUpsert().sql;
check('bloccata: il valore resta', /rate = rate/.test(sql) && !/rate = VALUES\(rate\)/.test(sql));
check('bloccata: resta viva (last_seen)', /last_seen = VALUES\(last_seen\)/.test(sql));
check('bloccata: segnalata in protected', r.protected.includes('Samsung'),
  `protected = ${JSON.stringify(r.protected)}`);

// --- 3. correzione esplicita su riga bloccata: vince e ri-blocca -----------
reset();
r = await ingest({ upsert: [{ name: 'Samsung', badge_raw: '4 per 10 €', locked: true }] });
sql = lastUpsert().sql;
check('correzione: sovrascrive', /rate = VALUES\(rate\)/.test(sql));
check('correzione: mantiene il blocco', /locked = 1/.test(sql));
check('correzione: rate corretto nei parametri', lastUpsert().params[3] === 4);
check('correzione: non finisce in protected', r.protected.length === 0);

// --- 4. sblocco esplicito -------------------------------------------------
reset();
await ingest({ upsert: [{ name: 'Samsung', badge_raw: '6 per 10 €', locked: false }] });
sql = lastUpsert().sql;
check('sblocco: sovrascrive', /rate = VALUES\(rate\)/.test(sql));
check('sblocco: azzera il flag', /locked = 0/.test(sql));

// --- 5. boosted non esiste più --------------------------------------------
reset();
await ingest({ upsert: [{ name: 'Nike', badge_raw: '20 per 10 €', boosted: true }] });
check('boosted ignorato', !/boosted/.test(lastUpsert().sql));

// --- 6. badge illeggibile: skipped, nessuna scrittura ----------------------
reset();
r = await ingest({ upsert: [{ name: 'Rotto', badge_raw: '???' }] });
check('badge illeggibile: skipped', r.skipped.includes('Rotto') && !lastUpsert());

console.log(fail ? `\n${fail} test falliti` : '\nTutti i test passati');
process.exit(fail ? 1 : 0);
