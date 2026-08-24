# P1 W1 disposable PostgreSQL gate remediation — 24 Agustus 2026

TASK=`P1-W1-DISPOSABLE-PG-GATE-REMEDIATION-20260824`

## Exact code under test

```text
CODE_SHA=b6bc116b1640fd561c982349262e5e070fa07f64
CODE_TREE=7484f05d1b77a86de838f1d2c25adc459024390a
INITIAL_WORKTREE_CLEAN=true
```

Baseline task SHA was
`7d9268a40f4ee0d922d07c12721169bdec54ffcf`. The W1 wrapper previously
supplied the disposable URL to migrations but not to the test process. Story
Ads fixtures also reused PID-derived organization identity, so one failing or
repeated fixture contaminated later route ownership checks.

## Remediation

- The W1 wrapper now supplies the same disposable `DATABASE_URL` to migrations
  and the actual test runner. The existing loopback guard and guaranteed
  `DROP DATABASE ... WITH (FORCE)` EXIT trap remain intact.
- Organization owners, organization slugs, and run IDs are unique per fixture
  invocation. E7 owner and intruder identities no longer share state with
  earlier Story Ads fixtures.
- Neutral Story Ads retain zero product references and receive a canonical
  blank-prop scale lock containing both required provider-gate phrases:
  `true small size` and `normal conversational distance`. The product-size
  contradiction remains active for every non-canonical/product-bound use.
- The talking-head test follows the real M11 lifecycle: video generation,
  `AWAITING_APPROVAL`, approval through the dashboard route, then W1 resume.
  It proves no TTS occurs before approval, exactly one Gemini TTS request occurs
  after approval, and approved video clips are reused without a second video
  provider call.
- Resume preserves the original paid video-provider provenance instead of
  replacing it with the synthetic loader label `reused-from-disk`. That
  original identity also controls audio and compositor behavior.

No prompt guard, product-truth boundary, role boundary, skip gate, production
configuration, remote state, or score was weakened or changed.

## Machine-generated verification

Raw transcripts and hashes are in
`docs/evidence/P1-W1-disposable-pg-exact-b6bc116/manifest.json`. The manifest
records argv, redacted environment status, timestamps, wall duration, exit
code, stdout/stderr byte counts, and SHA-256. The database URL itself is not
recorded. W1, money, and D2 each create and drop a disposable loopback database.

| Verification | Result | Skip | Exit |
|---|---:|---:|---:|
| W1 product truth wrapper | 25/25 pass | 0 | 0 |
| Money/concurrency wrapper | 11/11 pass | 0 | 0 |
| D2 org-photo/CAS PostgreSQL | 4/4 pass | 0 | 0 |
| Affected Story Ads/prompt/snapshot units | 119/119 pass | 0 | 0 |
| `npx tsc --noEmit` | PASS | n/a | 0 |

Hash integrity was recomputed after capture for every stdout/stderr file and
matched the manifest. The evidence commit after this capture is documentation
only and must remain a direct child of `CODE_SHA`.

**CANONICAL_SHIPPING_READINESS remains 58/100.**
