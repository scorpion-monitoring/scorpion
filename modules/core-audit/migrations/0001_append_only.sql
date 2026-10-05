-- audit_event is append-only (ADR 0021). A row is written once and never changed or removed, with two
-- exceptions that only the retention job takes, inside its own transaction, by switching on the
-- transaction-local flag `scorpion.audit_maintenance` (`set_config(..., true)`, the same as SET LOCAL):
--   * DELETE of rows past their retention;
--   * UPDATE that changes the `ip` column and nothing else (cutting it to a network prefix).
-- Everything else is refused, including TRUNCATE. The flag ends with the transaction, so it cannot
-- stay on for a pooled connection. A database superuser can still drop the trigger: this guards
-- against bugs and a compromised application path, not against whoever owns the database.
CREATE FUNCTION "audit_event_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('scorpion.audit_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'ip') = (to_jsonb(OLD) - 'ip') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'audit_event is append-only: % is not allowed', TG_OP USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
CREATE TRIGGER "audit_event_append_only" BEFORE UPDATE OR DELETE ON "audit_event" FOR EACH ROW EXECUTE FUNCTION "audit_event_guard"();--> statement-breakpoint
CREATE FUNCTION "audit_event_no_truncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only: TRUNCATE is not allowed' USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
CREATE TRIGGER "audit_event_no_truncate" BEFORE TRUNCATE ON "audit_event" FOR EACH STATEMENT EXECUTE FUNCTION "audit_event_no_truncate"();
