# Local callback matrix

Evidence class: `LOCAL_SIMULATION` — these are deterministic application tests,
not callbacks originated by Duitku and not managed-staging observations.

| Case | Expected result | Test evidence |
| --- | --- | --- |
| Valid HMAC, paid | one credit and order `paid` | `signature VALID resultCode 00` |
| Invalid HMAC | HTTP 401, no balance change | `signature PALSU` |
| Amount mismatch | HTTP 422, audited, no balance change | `signature valid dengan amount salah` |
| Duplicate callback | balance credited once | `callback sama 2x -> idempoten` |
| Failed result | order `failed`, no credit | `resultCode 01 (gagal)` |
| Late failure after paid | does not downgrade `paid` | `resultCode 01 SETELAH paid` |
| Unknown order | ignored, no side effect | `order tidak dikenal` |
| Wrong merchant | HTTP 401 | `callback merchantCode lain` |
| Sandbox non-tester | no wallet credit | `callback sandbox TIDAK mengkredit` |
| Sandbox allowlisted tester | test credit allowed | `callback sandbox TETAP mengkredit` |

Command:

```text
node --import tsx --test tests/duitku.test.ts tests/security-duitku.test.ts tests/pembayaran-sandbox.test.ts tests/duitku-sandbox-runner.test.ts
```

Result: 26 passed, 0 failed.
