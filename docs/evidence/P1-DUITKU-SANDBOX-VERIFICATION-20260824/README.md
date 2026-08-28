# Duitku sandbox verification — 2026-08-24

Evidence class labels in this directory are intentional. Provider API facts are
kept separate from local callback simulations and read-only managed health.
No payment page was opened, no invoice was paid, and no callback was sent to a
managed environment.

## Contract used by the final run

The integration uses the current Duitku POP contract for create and callback:

- create invoice: `HMAC-SHA256(merchantCode + timestamp, apiKey)`;
- callback: `HMAC-SHA256(merchantCode + amount + merchantOrderId, apiKey)`;
- callback comparison remains timing-safe.

Source: [Duitku POP documentation](https://docs.duitku.com/pop/en/), including
the April 2026 changelog that marks legacy MD5/raw SHA-256 signatures obsolete.
That POP page does not document a transaction-status operation. The HMAC status
formula and `webapi` route are documented on Duitku's separate
[general API page](https://docs.duitku.com/api/en/). Cross-product compatibility
must not be assumed.

## Real sandbox API attempts

1. A pre-fix legacy raw-SHA create request was accepted, but the old runner
   rejected Duitku's `app-sandbox.duitku.com` redirect before durably recording
   the order ID. The payment page was not opened. Status is unrecoverable
   without the order ID. Provider expiry is expected, not observed.
2. `legacy-auth-replacement.json` records the bounded replacement created with
   the legacy raw-SHA create signature. Its exact order ID was preserved. A
   subsequent read-only query using the corrected HMAC status contract reached
   the current endpoint and returned HTTP 404 with a JSON body containing only
   `Message`; the body is stored only as a SHA-256 digest. Outcome: `HOLD`.
3. `final-hmac-sandbox-api.json` is the one authorized final corrected-auth
   run. HMAC create was accepted for package `hq5` at the authoritative
   `TOPUP_PACKAGES` price of Rp60,000. The redirect origin was the strict Duitku
   sandbox origin. One immediate exact-order HMAC status query returned the same
   sanitized HTTP 404 shape. Per authorization, it was not retried. Outcome:
   `HOLD`, not successful verification.

All three invoices remained unpaid and their payment pages were never opened.
There was no charge, refund, settlement, or production mutation.

The exact external blocker is that Duitku technical support/account
configuration must confirm or enable the supported read-only reconciliation
endpoint for POP-created sandbox invoices, or identify an authoritative POP
reconciliation mechanism. Until then the runner exits nonzero and persists
`HOLD` for any non-2xx response or incomplete/mismatched status schema.
The two JSON records were reclassified from their already-stored sanitized
responses during Reviewer remediation; no additional provider query was made.

## Callback and ledger evidence

`local-callback-matrix.md` is LOCAL_SIMULATION evidence. The runner does not
import or write the application database; therefore its provider create/status
calls cannot create a local credit-ledger entry. The callback tests separately
prove valid crediting, invalid-signature rejection, amount-mismatch rejection,
duplicate idempotency, failed/late behavior, unknown-order handling, wrong
merchant rejection, and sandbox tester allowlisting.

Managed callbacks are `NOT_RUN`. Read-only managed staging health reported
`payments_provider=midtrans`, while this task requires Duitku. Managed Duitku
credentials and tester allowlisting were also not independently proven. Sending
a synthetic callback there would therefore not be valid evidence.

## Safety result

- Duitku environment: sandbox
- `PAYMENTS_GO_LIVE`: false/absent
- production mutation: none
- managed callback: NOT_RUN
- real invoice paid: no
- status verification: HOLD
- payment page opened: no
- duplicate local ledger entry from runner: none (runner has no DB write path)

## Verification result

- TypeScript typecheck: PASS
- focused Duitku/sandbox matrix on the current remediation snapshot: 29 passed, 0 failed
- immutable focused output: `focused-remediation.tap` (bound to the pre-evidence Git tree recorded in its header)
- locked dependency source: tracked `package-lock.json`; locally installed core versions matched its exact entries
- earlier full-suite baseline: 1,218 total; 1,171 passed; 0 failed; 47 skipped
- production build: PASS
- real Duitku credential scan across all scoped source and evidence: PASS
