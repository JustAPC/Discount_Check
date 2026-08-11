-- sconti-api — catalogo offerte Revolut
-- Una tabella sola: lo stato corrente. La cronologia non serve a nessuno dei consumatori.

CREATE TABLE IF NOT EXISTS revolut_offer (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,              -- "Wizz Air"
  name_key   VARCHAR(120) NOT NULL,              -- "wizzair" — chiave di dedup
  kind       ENUM('points','cashback') NOT NULL DEFAULT 'points',
  rate       DECIMAL(6,2) NOT NULL,              -- punti ogni 10 € | percentuale se cashback
  badge_raw  VARCHAR(48)  NOT NULL,              -- "2 per 10 €" — testo esatto letto dal tile
  boosted    TINYINT(1)   NOT NULL DEFAULT 0,    -- badge viola = tasso potenziato
  channel    ENUM('online','instore','both') NOT NULL DEFAULT 'online',
  domain     VARCHAR(190) NULL,                  -- alias impostato a mano, se serve
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  first_seen DATE NOT NULL,
  last_seen  DATE NOT NULL,
  UNIQUE KEY uq_offer (name_key, channel),
  KEY k_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
