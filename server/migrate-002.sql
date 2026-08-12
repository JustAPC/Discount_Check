-- Migrazione per il DB già popolato (133 righe al 12/08/2026).
--
-- 1. `boosted` era true su tutte le righe: il colore della pillola non veniva letto,
--    il campo diceva sempre la stessa cosa. Un campo costante è peggio di un campo assente.
-- 2. `locked` protegge i valori corretti a mano: senza, la correzione viene riscritta
--    dal primo ingest successivo, perché ON DUPLICATE KEY UPDATE sovrascrive sempre rate.
--
--   mariadb -u sconti -p sconti < migrate-002.sql

ALTER TABLE revolut_offer
  DROP COLUMN boosted,
  ADD COLUMN locked TINYINT(1) NOT NULL DEFAULT 0 AFTER domain;
