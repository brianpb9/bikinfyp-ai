# P1 full disposable PostgreSQL gate

Task: `P1-FULL-DISPOSABLE-PG-ZERO-SKIP-20260824`

Code under test: `de1a6ef53bdfb4de14d01e8c13cc223a54cddd61`

## Result

- Full aggregate: 1,119 tests; 1,115 pass; 0 fail; 4 skip; 0 cancelled; 0 todo.
- PostgreSQL lifecycle: unique loopback-only database created, all migrations
  applied, then `DROP DATABASE ... WITH (FORCE)` completed; catalog count after
  cleanup was zero.
- W1 standalone: 25/25 pass.
- Money standalone: 11/11 pass, including the eight-reconciler contention case.
- TypeScript, production build, and script-catalog audit: exit 0.
- Score remains 58; no score or acceptance-policy change was made.

The four skips are the existing tests in `tests/qcf1-tiga-keadaan.test.ts`:

1. `frame SCARLET/pump/10ml GAGAL` needs the historical PALSU frame and an
   explicitly opted-in paid Gemini call.
2. `foto asli dibandingkan dirinya sendiri LULUS` has the same artifact and
   paid-call requirements.
3. `OCR pada frame palsu NYATA menolak mereknya` is local/free, but requires
   the same missing historical PALSU frame.
4. `hero tanpa merek tepercaya = UNVERIFIED` has the same artifact and
   paid-call requirements.

The historical path `/tmp/bikinfyp-audit.r8g5CW/c-no-face-2.5.png` was absent.
The approved task did not authorize manufacturing a substitute, network use,
or paid provider calls. `UJI_QCF1_NYATA` remained unset. These are therefore
classified gated skips, not product-test failures.

## Defect and remediation

The aggregate baseline on accepted SHA
`09cddfbb5940f2d6d72a3624c0ea2ff6d2f7a410` produced 1,113 pass, 2 fail, and
4 skip. Both failures were genuine PostgreSQL `40001` serialization collisions:
the eight-reconciler money test and a neutral Story Ads transaction. The raw
baseline and its create/migrate/drop proof are retained here.

The production transaction helper still uses `SERIALIZABLE` and still retries
the entire transaction. The remediation raises the bounded attempt count from
three to eight and adds capped exponential backoff plus jitter for `40001` and
`40P01`. It does not weaken isolation or assertions.

## Runner provenance

Two pre-execution connection attempts used the project's default local endpoint
on port 54329. That endpoint was unavailable, so both attempts stopped before
database creation, migration, or test execution. A read-only probe then verified
the local PostgreSQL server on `localhost:5432`. The recorded exact-SHA run used
that loopback endpoint and a uniquely named disposable database. Database URLs
are intentionally redacted from evidence.

`aggregate.tap` contains the complete migration, test, and cleanup transcript;
`aggregate-proof.txt` contains timestamps, redacted environment state, and the
exact code/tree SHA. `manifest.json` hashes every evidence payload.
