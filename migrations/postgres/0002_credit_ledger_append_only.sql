-- Credit balance is derived from this ledger. History cannot be changed after
-- insertion, even by a future raw-pg route that bypasses repository methods.
CREATE OR REPLACE FUNCTION reject_credit_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger is append-only: % is forbidden', TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER credit_ledger_no_update
BEFORE UPDATE ON credit_ledger
FOR EACH ROW EXECUTE FUNCTION reject_credit_ledger_mutation();

CREATE TRIGGER credit_ledger_no_delete
BEFORE DELETE ON credit_ledger
FOR EACH ROW EXECUTE FUNCTION reject_credit_ledger_mutation();
