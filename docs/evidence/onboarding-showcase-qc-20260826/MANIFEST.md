# Onboarding showcase QC/provenance — 26 Agustus 2026

Task: `ONBOARDING-VIDEO-PROOF-20260826`

Reviewer finding: `1787697425000-reviewer-CHANGES_REQUESTED`

## Boundary

Public showcase approval is no longer granted by a self-declared provenance
string. Each selected clip must have an entry in
`lib/onboarding-showcase-approvals.json` binding:

- exact public path and SHA-256;
- owned provenance class and the commit that introduced the current bytes;
- `qcResult=pass`;
- three inspected sample times;
- a committed contact sheet and its SHA-256.

Tests independently hash the media and contact sheet, read the asset's latest
Git commit, and reject any allowlist row without an exact matching approval.

## Inspected approvals

| Clip | Source lineage | Samples | Inspection result |
|---|---|---|---|
| `tangan.mp4` | owned pipeline render, current bytes from `a089584` | 2 / 7.5 / 12 s | Mosseru bottle/wordmark remains coherent; hands-only framing |
| `persona/ootd.mp4` | Founder-generated owned Grok render, current bytes from `2ecdc5a` | 2 / 5 / 8 s | no product-evidence claim; one coherent adult persona/outfit |
| `persona/unboxing.mp4` | Founder-generated owned Grok render, current bytes from `2ecdc5a` | 1 / 3 / 5 s | JJ Glow boxes remain coherent across samples |
| `persona/close-up.mp4` | Founder-generated owned Grok render, current bytes from `2ecdc5a` | 2 / 5 / 8 s | Elformula bottle remains coherent across samples |
| `persona/di-mobil.mp4` | Founder-generated owned Grok render, current bytes from `2ecdc5a` | 2 / 5 / 8 s | JJ Glow boxes remain coherent across samples |
| `brand/skintific-5x-ceramide.mp4` | owned pipeline render, current bytes from `0e3ef3f` | 0.5 / 2.5 / 4.5 s | SKINTIFIC 5X CERAMIDE identity remains readable |
| `brand/scarlett-acneserum.mp4` | owned pipeline render, current bytes from `0e3ef3f` | 0.5 / 2.5 / 4.5 s | SCARLETT ACNE SERUM identity remains readable |
| `brand/wardah-lightening-serum.mp4` | owned pipeline render, current bytes from `0e3ef3f` | 0.5 / 2.5 / 4.5 s | Wardah LIGHTENING serum ampoule identity remains readable |
| `brand/somethinc-niacinamide.mp4` | owned pipeline render, current bytes from `0e3ef3f` | 0.5 / 2.5 / 4.5 s | SOMETHINC 5% Niacinamide identity remains readable |
| `brand/glad2glow-centella.mp4` | owned pipeline render, current bytes from `0e3ef3f` | 0.5 / 2.5 / 4.5 s | Glad2Glow CENTELLA identity remains readable |
| `brand/maybelline-superstay-matte-ink.mp4` | owned pipeline render, current bytes from `0e3ef3f` | 0.5 / 2.5 / 4.5 s | MAYBELLINE SUPERSTAY MATTE INK identity remains readable |
| `brand/mosseru-showergel.mp4` | owned pipeline render, current bytes from `0e3ef3f` | 0.5 / 2.5 / 4.5 s | Mosseru shower-gel identity remains readable |
| `brand/barberdaily-sixblade-razor.mp4` | owned pipeline render, current bytes from `0e3ef3f` | 0.5 / 2.5 / 4.5 s | Barber Daily 6 BLADES SHAVER identity remains readable |

The contact sheets in this directory are deterministic frame extractions from
the exact committed public MP4s. They are review aids, not claims that the
Grok clips passed the production BikinFYP pipeline.

## Rejections

- `/showcase/genz.mp4` is removed from both onboarding surfaces. Its exact
  evidence sheet shows `Cuma Rp65.574`, while the committed source manifest
  says `159 ribu`; no approved evidence supports the rendered price.
- `/showcase/hijaber.mp4` is removed from both onboarding surfaces. Direct
  inspection confirms the known r10 `CENTELLA` → `SKNTELLA` fidelity failure
  recorded at `test_output/content-lab/LOG.md` line 134.
- `/showcase/ibu.mp4` is also removed conservatively because direct inspection
  found label gibberish.
- `/showcase/persona/review-produk.mp4` is excluded because no reviewable
  source-product identity record accompanies its green jar.

The rejected binaries remain as historical repository assets; absence from the
approval ledger makes them impossible to select for the public AI proof strip.
