-- Search: an FTS5 index over each transaction's description, notes, split memos, payee and tag
-- names. `transaction.search_id` is the stable integer key (the FTS rowid): table rebuilds
-- reassign the table rowid, so the index never uses it. Scoped payee and tag names are indexed in
-- their own columns so a query can leave them out for a viewer who may not see them. Visibility
-- is never stored here; the query applies it. A rebuild of `transaction`, `split`, `split_tag`,
-- `payee` or `tag` must carry `search_id` and re-create the `txn_fts_*` triggers (DROP TABLE
-- removes a table's own triggers, and a RENAME fails while a trigger names a missing table, so
-- drop the triggers that name the table first).
ALTER TABLE `transaction` ADD `search_id` integer;--> statement-breakpoint
UPDATE `transaction` SET `search_id` = rowid;--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_search_id_idx` ON `transaction` (`search_id`);--> statement-breakpoint
CREATE VIRTUAL TABLE txn_fts USING fts5(description, notes, memo, payee, payee_scoped, tags, tags_scoped);--> statement-breakpoint
DELETE FROM txn_fts WHERE rowid IN (SELECT t.search_id FROM "transaction" AS t WHERE 1);
  INSERT INTO txn_fts (rowid, description, notes, memo, payee, payee_scoped, tags, tags_scoped)
  SELECT t.search_id, t.description_raw, coalesce(t.notes, ''),
    coalesce((SELECT group_concat(s.memo, ' ') FROM split AS s WHERE s.transaction_id = t.id AND s.memo IS NOT NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NOT NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NOT NULL), '')
  FROM "transaction" AS t WHERE 1 AND t.search_id IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER txn_fts_assign AFTER INSERT ON "transaction"
WHEN NEW.search_id IS NULL
BEGIN
  UPDATE "transaction" SET search_id = (SELECT coalesce(max(search_id), 0) + 1 FROM "transaction") WHERE id = NEW.id;
END;--> statement-breakpoint
CREATE TRIGGER txn_fts_insert AFTER INSERT ON "transaction"
WHEN NEW.search_id IS NOT NULL
BEGIN
  DELETE FROM txn_fts WHERE rowid IN (SELECT t.search_id FROM "transaction" AS t WHERE t.id = NEW.id);
  INSERT INTO txn_fts (rowid, description, notes, memo, payee, payee_scoped, tags, tags_scoped)
  SELECT t.search_id, t.description_raw, coalesce(t.notes, ''),
    coalesce((SELECT group_concat(s.memo, ' ') FROM split AS s WHERE s.transaction_id = t.id AND s.memo IS NOT NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NOT NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NOT NULL), '')
  FROM "transaction" AS t WHERE t.id = NEW.id AND t.search_id IS NOT NULL;
END;--> statement-breakpoint
CREATE TRIGGER txn_fts_update AFTER UPDATE OF description_raw, notes, payee_id, search_id ON "transaction"
WHEN NEW.search_id IS NOT NULL
BEGIN
  DELETE FROM txn_fts WHERE rowid = OLD.search_id;
  DELETE FROM txn_fts WHERE rowid IN (SELECT t.search_id FROM "transaction" AS t WHERE t.id = NEW.id);
  INSERT INTO txn_fts (rowid, description, notes, memo, payee, payee_scoped, tags, tags_scoped)
  SELECT t.search_id, t.description_raw, coalesce(t.notes, ''),
    coalesce((SELECT group_concat(s.memo, ' ') FROM split AS s WHERE s.transaction_id = t.id AND s.memo IS NOT NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NOT NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NOT NULL), '')
  FROM "transaction" AS t WHERE t.id = NEW.id AND t.search_id IS NOT NULL;
END;--> statement-breakpoint
CREATE TRIGGER txn_fts_delete AFTER DELETE ON "transaction"
BEGIN
  DELETE FROM txn_fts WHERE rowid = OLD.search_id;
END;--> statement-breakpoint
CREATE TRIGGER txn_fts_payee_update AFTER UPDATE OF name, scope_person_id ON payee
BEGIN
  DELETE FROM txn_fts WHERE rowid IN (SELECT t.search_id FROM "transaction" AS t WHERE t.payee_id = NEW.id);
  INSERT INTO txn_fts (rowid, description, notes, memo, payee, payee_scoped, tags, tags_scoped)
  SELECT t.search_id, t.description_raw, coalesce(t.notes, ''),
    coalesce((SELECT group_concat(s.memo, ' ') FROM split AS s WHERE s.transaction_id = t.id AND s.memo IS NOT NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NOT NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NOT NULL), '')
  FROM "transaction" AS t WHERE t.payee_id = NEW.id AND t.search_id IS NOT NULL;
END;--> statement-breakpoint
CREATE TRIGGER txn_fts_tag_update AFTER UPDATE OF name, scope_person_id, deleted_at ON tag
BEGIN
  DELETE FROM txn_fts WHERE rowid IN (SELECT t.search_id FROM "transaction" AS t WHERE t.id IN (SELECT s.transaction_id FROM split AS s JOIN split_tag AS st ON st.split_id = s.id WHERE st.tag_id = NEW.id));
  INSERT INTO txn_fts (rowid, description, notes, memo, payee, payee_scoped, tags, tags_scoped)
  SELECT t.search_id, t.description_raw, coalesce(t.notes, ''),
    coalesce((SELECT group_concat(s.memo, ' ') FROM split AS s WHERE s.transaction_id = t.id AND s.memo IS NOT NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NOT NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NOT NULL), '')
  FROM "transaction" AS t WHERE t.id IN (SELECT s.transaction_id FROM split AS s JOIN split_tag AS st ON st.split_id = s.id WHERE st.tag_id = NEW.id) AND t.search_id IS NOT NULL;
END;--> statement-breakpoint
CREATE TRIGGER txn_fts_split_tag_insert AFTER INSERT ON split_tag
BEGIN
  DELETE FROM txn_fts WHERE rowid IN (SELECT t.search_id FROM "transaction" AS t WHERE t.id = (SELECT s.transaction_id FROM split AS s WHERE s.id = NEW.split_id));
  INSERT INTO txn_fts (rowid, description, notes, memo, payee, payee_scoped, tags, tags_scoped)
  SELECT t.search_id, t.description_raw, coalesce(t.notes, ''),
    coalesce((SELECT group_concat(s.memo, ' ') FROM split AS s WHERE s.transaction_id = t.id AND s.memo IS NOT NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NOT NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NOT NULL), '')
  FROM "transaction" AS t WHERE t.id = (SELECT s.transaction_id FROM split AS s WHERE s.id = NEW.split_id) AND t.search_id IS NOT NULL;
END;--> statement-breakpoint
CREATE TRIGGER txn_fts_split_tag_update AFTER UPDATE OF split_id, tag_id ON split_tag
BEGIN
  DELETE FROM txn_fts WHERE rowid IN (SELECT t.search_id FROM "transaction" AS t WHERE t.id = (SELECT s.transaction_id FROM split AS s WHERE s.id = OLD.split_id));
  INSERT INTO txn_fts (rowid, description, notes, memo, payee, payee_scoped, tags, tags_scoped)
  SELECT t.search_id, t.description_raw, coalesce(t.notes, ''),
    coalesce((SELECT group_concat(s.memo, ' ') FROM split AS s WHERE s.transaction_id = t.id AND s.memo IS NOT NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NOT NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NOT NULL), '')
  FROM "transaction" AS t WHERE t.id = (SELECT s.transaction_id FROM split AS s WHERE s.id = OLD.split_id) AND t.search_id IS NOT NULL;
  DELETE FROM txn_fts WHERE rowid IN (SELECT t.search_id FROM "transaction" AS t WHERE t.id = (SELECT s.transaction_id FROM split AS s WHERE s.id = NEW.split_id));
  INSERT INTO txn_fts (rowid, description, notes, memo, payee, payee_scoped, tags, tags_scoped)
  SELECT t.search_id, t.description_raw, coalesce(t.notes, ''),
    coalesce((SELECT group_concat(s.memo, ' ') FROM split AS s WHERE s.transaction_id = t.id AND s.memo IS NOT NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NOT NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NOT NULL), '')
  FROM "transaction" AS t WHERE t.id = (SELECT s.transaction_id FROM split AS s WHERE s.id = NEW.split_id) AND t.search_id IS NOT NULL;
END;--> statement-breakpoint
CREATE TRIGGER txn_fts_split_tag_delete AFTER DELETE ON split_tag
BEGIN
  DELETE FROM txn_fts WHERE rowid IN (SELECT t.search_id FROM "transaction" AS t WHERE t.id = (SELECT s.transaction_id FROM split AS s WHERE s.id = OLD.split_id));
  INSERT INTO txn_fts (rowid, description, notes, memo, payee, payee_scoped, tags, tags_scoped)
  SELECT t.search_id, t.description_raw, coalesce(t.notes, ''),
    coalesce((SELECT group_concat(s.memo, ' ') FROM split AS s WHERE s.transaction_id = t.id AND s.memo IS NOT NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NOT NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NOT NULL), '')
  FROM "transaction" AS t WHERE t.id = (SELECT s.transaction_id FROM split AS s WHERE s.id = OLD.split_id) AND t.search_id IS NOT NULL;
END;--> statement-breakpoint
CREATE TRIGGER txn_fts_split_insert AFTER INSERT ON split
BEGIN
  DELETE FROM txn_fts WHERE rowid IN (SELECT t.search_id FROM "transaction" AS t WHERE t.id = NEW.transaction_id);
  INSERT INTO txn_fts (rowid, description, notes, memo, payee, payee_scoped, tags, tags_scoped)
  SELECT t.search_id, t.description_raw, coalesce(t.notes, ''),
    coalesce((SELECT group_concat(s.memo, ' ') FROM split AS s WHERE s.transaction_id = t.id AND s.memo IS NOT NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NOT NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NOT NULL), '')
  FROM "transaction" AS t WHERE t.id = NEW.transaction_id AND t.search_id IS NOT NULL;
END;--> statement-breakpoint
CREATE TRIGGER txn_fts_split_update AFTER UPDATE OF memo, transaction_id ON split
BEGIN
  DELETE FROM txn_fts WHERE rowid IN (SELECT t.search_id FROM "transaction" AS t WHERE t.id = OLD.transaction_id);
  INSERT INTO txn_fts (rowid, description, notes, memo, payee, payee_scoped, tags, tags_scoped)
  SELECT t.search_id, t.description_raw, coalesce(t.notes, ''),
    coalesce((SELECT group_concat(s.memo, ' ') FROM split AS s WHERE s.transaction_id = t.id AND s.memo IS NOT NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NOT NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NOT NULL), '')
  FROM "transaction" AS t WHERE t.id = OLD.transaction_id AND t.search_id IS NOT NULL;
  DELETE FROM txn_fts WHERE rowid IN (SELECT t.search_id FROM "transaction" AS t WHERE t.id = NEW.transaction_id);
  INSERT INTO txn_fts (rowid, description, notes, memo, payee, payee_scoped, tags, tags_scoped)
  SELECT t.search_id, t.description_raw, coalesce(t.notes, ''),
    coalesce((SELECT group_concat(s.memo, ' ') FROM split AS s WHERE s.transaction_id = t.id AND s.memo IS NOT NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NOT NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NOT NULL), '')
  FROM "transaction" AS t WHERE t.id = NEW.transaction_id AND t.search_id IS NOT NULL;
END;--> statement-breakpoint
CREATE TRIGGER txn_fts_split_delete AFTER DELETE ON split
BEGIN
  DELETE FROM txn_fts WHERE rowid IN (SELECT t.search_id FROM "transaction" AS t WHERE t.id = OLD.transaction_id);
  INSERT INTO txn_fts (rowid, description, notes, memo, payee, payee_scoped, tags, tags_scoped)
  SELECT t.search_id, t.description_raw, coalesce(t.notes, ''),
    coalesce((SELECT group_concat(s.memo, ' ') FROM split AS s WHERE s.transaction_id = t.id AND s.memo IS NOT NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NULL), ''),
    coalesce((SELECT p.name FROM payee AS p WHERE p.id = t.payee_id AND p.scope_person_id IS NOT NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NULL), ''),
    coalesce((SELECT group_concat(g.name, ' ') FROM split AS s JOIN split_tag AS st ON st.split_id = s.id JOIN tag AS g ON g.id = st.tag_id WHERE s.transaction_id = t.id AND g.deleted_at IS NULL AND g.scope_person_id IS NOT NULL), '')
  FROM "transaction" AS t WHERE t.id = OLD.transaction_id AND t.search_id IS NOT NULL;
END;