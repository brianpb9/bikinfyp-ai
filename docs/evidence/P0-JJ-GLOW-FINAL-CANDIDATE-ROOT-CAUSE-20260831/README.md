# JJ GLOW final-candidate root-cause remediation

This packet is an implementation gate, not authority to create candidate #3.
The canonical candidate count remains capped at two. No provider, queue,
publication, payment, production, or canonical-candidate mutation is performed
by this implementation or its local tests.

## Defect A — runner bootstrap

The exact failure is identified: `Dockerfile.web` copied only the migration
script into the build/runtime image. It omitted
`scripts/staging-jj-glow-candidate.cjs`; `.dockerignore` also excluded the
runner's BPOM file under `docs/`. Node 22 and the locked production `pg`
dependency were present. The remediation copies the runner and a byte-digested
runtime BPOM fixture explicitly and asserts both during image construction.

The runner now has a zero-DB/zero-provider bootstrap probe. Normal execution
also fails closed unless `JJ_GLOW_CANONICAL_CREATE=1` is explicitly supplied.

## Defect B — durability and binding

The candidate runner and HTTP admission previously had no physical PostgreSQL
identity handshake. The runner now hashes `current_database`,
`server_version_num`, and `pg_control_system().system_identifier` without
emitting any component, URL, host, user, or credential. The exact JJ admission
recomputes the same identity on the web pool and rejects a mismatch before the
job transaction.

`scripts/staging-candidate-durability-probe.ts` is a two-process, noncanonical
fixture. `create` calls the production `smokeCreateJob` repository/transaction
with Rp0, no ledger, no enqueue, and no provider. After that process exits,
`readback-cleanup` uses a new `Pool`, proves the job/script pointer/audit rows,
then removes only UUID-scoped fixture rows and storage objects. Both modes
assert the JJ canonical counts are unchanged.

## Historical loss-mechanism audit

Facts retained from the accepted incident packet and a fresh source audit:

- independent one-off reads observed the committed candidate through
  `2026-08-31T00:28:05Z`; absence was first observed at `00:45:14Z`;
- the same Render PostgreSQL resource logs both periods; there is no database
  restart/recovery log, one-off job, or web deploy in the interval;
- ordinary application code has no job/script/user/product deletion path;
- cleanup scripts are fixture-ID scoped and none ran as a one-off in the loss
  interval;
- the candidate runner can only attempt deletion of its unbound script after a
  failed run; it cannot delete a committed job or append-only hold;
- expiry, supersede, quarantine, and admission rollback paths do not delete
  committed jobs, scripts, holds, personas, and both audits as one unit;
- PostgreSQL statement logging was not enabled, so no retained statement or
  actor proves the destructive transition.

Therefore the exact historical destructive statement/control-plane actor is
**not proven**. Binding drift and transaction rollback are ruled out more
strongly than in R15, but evidence does not justify inventing an actor. The
forward failure classes are remediated; candidate #3 remains forbidden until a
Reviewer accepts whether this evidence is sufficient for `ROOT_CAUSE_IDENTIFIED`
or requests a bounded additional receipt.

## Local gate

- TypeScript no-emit: PASS.
- JJ GLOW focused suite: 6/6 PASS.
- zero-DB bootstrap: PASS; `database_queries=0`, `provider_calls=0`,
  `canonical_writes=0`.
- full suite: 1,312 PASS, 60 SKIP, 1 unrelated time-dependent failure
  (`STAGING_REFERENCE_RIGHTS_EXPIRED` in an existing chronology fixture).
- canonical candidate count changed during local tests: NO (no staging DB
  connection was made).
