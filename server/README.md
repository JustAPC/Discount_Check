# sconti-api

Due endpoint sopra MariaDB, dietro Cloudflare Tunnel su `sconti-api.andreapontillo.tech`.
Serve il catalogo Revolut all'estensione e riceve gli ingest da Hermes.

Il server **non decide niente**: non calcola delta, non deduce rimozioni dall'assenza di un
negozio nella lista, non ha coda di approvazione. Applica quello che riceve. La conseguenza
utile è che uno screenshot parziale non può cancellare offerte vive.

## Endpoint

| Metodo | Path | Note |
|---|---|---|
| `GET` | `/revolut/offers` | offerte attive, `instore` escluse, ordinate per `rate`, con `label` già pronta (`20x`) |
| `POST` | `/revolut/ingest` | `{captured_at, upsert:[…], deactivate:[…]}`, header `X-Ingest-Token` |
| `POST` | `/revolut/domains` | `{name_key: dominio}`, header `X-Ingest-Token`. Scrive e corregge i domini |
| `GET` | `/health` | ping al DB, usato dall'healthcheck |

Il **dominio** ha una regola sua, diversa da tutti gli altri campi: è l'unico che non arriva
dagli screenshot ma da una decisione presa guardando dove si compra davvero, quindi
`/revolut/ingest` può solo riempirlo dove è vuoto — `COALESCE(domain, VALUES(domain))` — e
non lo sovrascrive mai. La skill lo *propone* al passo 4, dove un "ok" distratto lo
sostituirebbe in silenzio.

Per scriverlo o correggerlo c'è `/revolut/domains`, che accetta il `name_key` o il nome
visibile, un dominio nudo o un URL intero, e una stringa vuota per cancellarlo. Risponde
`{set, unset, unknown}`: `unknown` sono le chiavi che non corrispondono a nessun negozio.

```bash
curl -s -X POST "$SCONTI_API/revolut/domains" \
  -H "X-Ingest-Token: $INGEST_TOKEN" -H 'content-type: application/json' \
  -d '{"itaairways": "ita-airways.com"}'
```

Body di ingest:

```json
{
  "captured_at": "2026-08-11",
  "upsert": [
    { "name": "Wizz Air", "badge_raw": "2 per 10 €", "boosted": false, "channel": "online" },
    { "name": "Nike",     "badge_raw": "20 per 10 €", "boosted": true,  "channel": "online" },
    { "name": "AG1", "badge_raw": "10 per 10 €", "boosted": true, "channel": "online",
      "domain": "drinkag1.com" }
  ],
  "deactivate": ["zalando"]
}
```

`name_key`, `kind` e `rate` li deriva il server da `name` e `badge_raw`: il parser sta in un
posto solo. Le righe con badge illeggibile non bloccano l'ingest, tornano in `skipped`.

`domain` è opzionale e serve ai negozi il cui nome non assomiglia al sito (`AG1` →
`drinkag1.com`). Se non lo mandi, un dominio già salvato **resta**: gli ingest successivi non
cancellano un collegamento fatto a mano.

---

# Installazione su TrueNAS con Dockge

Presupposti: database `negozi_revolut` già creato, Dockge installato, tunnel Cloudflare già
attivo sul NAS.

## 1. Utente e tabella su MariaDB

Una sola sessione, tutto incollato a mano: i file di questa repo stanno sul PC, non sul NAS,
quindi non c'è nessuno `schema.sql` da redirigere.

Da shell TrueNAS (se MariaDB gira in container):

```bash
docker exec -it <nome-container-mariadb> mariadb -uroot -p
```

Poi incolla — permessi minimi, niente `DELETE`, perché il codice non cancella mai: disattiva
e basta (`active = 0`).

```sql
CREATE USER 'sconti'@'%' IDENTIFIED BY 'metti-una-password-lunga';
GRANT SELECT, INSERT, UPDATE ON negozi_revolut.* TO 'sconti'@'%';
FLUSH PRIVILEGES;

USE negozi_revolut;

CREATE TABLE IF NOT EXISTS revolut_offer (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  name_key   VARCHAR(120) NOT NULL,
  kind       ENUM('points','cashback') NOT NULL DEFAULT 'points',
  rate       DECIMAL(6,2) NOT NULL,
  badge_raw  VARCHAR(48)  NOT NULL,
  boosted    TINYINT(1)   NOT NULL DEFAULT 0,
  channel    ENUM('online','instore','both') NOT NULL DEFAULT 'online',
  domain     VARCHAR(190) NULL,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  first_seen DATE NOT NULL,
  last_seen  DATE NOT NULL,
  UNIQUE KEY uq_offer (name_key, channel),
  KEY k_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SHOW TABLES;
```

L'ultima riga deve mostrare `revolut_offer`. (`schema.sql` in questa cartella è la stessa
cosa, tenuta versionata: serve se un domani vuoi ricreare la tabella da script.)

## 2. Stack in Dockge

In Dockge: **+ Compose** → nome stack `sconti-api` → incolla il contenuto di `compose.yaml`
→ **Save** (non avviare ancora). Dockge crea la cartella dello stack sul disco: il percorso
è mostrato in alto nella pagina dello stack, tipicamente `/opt/stacks/sconti-api` mappato su
un dataset del pool.

## 3. Codice e configurazione

Dentro la cartella dello stack serve questa struttura:

```
sconti-api/
├── compose.yaml      ← creato da Dockge al passo 2
├── .env              ← da creare
└── app/
    ├── index.js      ← da questa repo: server/app/index.js
    └── package.json  ← da questa repo: server/app/package.json
```

I due file di `app/` vanno trasferiti dal PC. In ordine di comodità:

- **share SMB** sul dataset degli stack, e li copi con Esplora risorse;
- oppure da shell TrueNAS, incollando il contenuto:

```bash
mkdir -p /opt/stacks/sconti-api/app && cat > /opt/stacks/sconti-api/app/index.js <<'EOF'
<incolla qui il contenuto di server/app/index.js>
EOF
```

Il `.env` si può scrivere direttamente dall'editor di Dockge (tab accanto a compose):

```
DB_HOST=192.168.1.x
DB_PORT=3306
DB_USER=sconti
DB_PASSWORD=passwordsenzasimboli
DB_NAME=negozi_revolut
INGEST_TOKEN=stringarandomlunga
```

Tre regole per il `.env`, tutte imparate a spese altrui:

- `DB_HOST` è l'**IP LAN del NAS**, mai `localhost`: dentro il container `localhost` è il
  container stesso;
- **niente commenti sulla stessa riga** di un valore e niente virgolette: `env_file` non è
  una shell, finiscono dentro il valore;
- password e token **solo lettere e numeri**: `$`, `#`, `!` e spazi sopravvivono male al
  giro `.env` → Docker → driver MySQL, e producono errori che sembrano di permessi.

## 4. Avvio

**Start** in Dockge. Nei log deve comparire:

```
added N packages
sconti-api su :8080
```

Il primo avvio scarica `mysql2` e ci mette qualche secondo; i successivi no, perché
`node_modules` resta in `app/`.

Verifica dalla shell del NAS:

```bash
curl -s localhost:8085/health
```

Deve rispondere `{"ok":true}`. Se dà errore di connessione al DB, quasi sempre è `DB_HOST`
a `localhost` invece dell'IP, oppure l'utente MariaDB creato con host `localhost` invece
di `%`.

## 5. Tunnel

**Networks → Tunnels → il tuo tunnel → Public Hostname**: `sconti-api` +
`andreapontillo.tech` → service `http://<ip-nas>:8085`.

Nessuna Access Application: l'endpoint è pubblico in lettura di proposito. Sapere che Nike
dà 20 punti ogni 10 € non è un'informazione sensibile, e tenerlo aperto evita di gestire
service token su ogni client. **La scrittura è protetta da `INGEST_TOKEN`**, che è l'unica
chiave del sistema.

Due conseguenze da tenere a mente:

- se `INGEST_TOKEN` è vuoto il server **rifiuta di scrivere** (503) invece di accettare
  tutto: senza Access davanti, un token vuoto sarebbe una porta aperta;
- l'endpoint è raggiungibile dagli scanner di internet. Il codice è minimo e le query sono
  parametrizzate, ma se vuoi una rete di sicurezza in più, una regola di **rate limiting**
  di Cloudflare su `/revolut/ingest` costa due minuti ed è gratis.

## 6. Verifica finale

```bash
curl -i https://sconti-api.andreapontillo.tech/revolut/offers
```

Deve rispondere `200` con `{"updated_at":null,"offers":[]}` — vuoto, ma vivo. Da qui in poi
il riempimento lo fa la skill Hermes.
