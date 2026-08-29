# Normal representative metadata acquisition — zero-candidate receipt

This immutable bundle records the bounded, read-only staging acquisition attempt authorized for Lane C.

- GitHub run: `33264551551`
- Job: `99132193362`
- Control SHA: `503a8bfbf47d7873dbf07d40ce29ad40390b57d0`
- Staging app SHA: `ee767201679ae2213c40be6f913241f372d2378a`
- Task: `NORMAL-REPRESENTATIVE-METADATA-ACQUISITION-20260829`
- Decision: `FAIL_CLOSED`
- Failure code: `CANONICAL_CANDIDATE_COUNT_NOT_ONE`
- Canonical candidate count: `0`
- Actions artifact: `9718242465` / `normal-representative-metadata-33264551551-1`
- Artifact digest: `sha256:eb5ab24bce8a80293df26f2808101055cd5beb05b2da097eedae5a027bcaed1f`

The run verified the staging target, an initially empty allow-list, the exact runner `/32`, and exact allow-list readback. It then found no row satisfying the approved canonical candidate predicate. The control did not choose a fallback and did not mutate staging data.

Primary cleanup removed the run-owned allow-list entry and read back an empty list. Secondary cleanup verified ownership and observed that the list was already empty. A separate Render CLI read after the run also returned an empty allow-list.

`GITHUB-RUN.json` and `GITHUB-ARTIFACT.json` preserve the sanitized Actions API provenance. `ARTIFACT.zip.base64` is the exact downloaded Actions archive in text-safe form. The verifier recomputes its GitHub digest, checks its exact entry names, extracts both entries, and compares their bytes with the committed copies. `RENDER-ALLOWLIST-READBACK.json` preserves the independent post-cleanup Render response. Run `node verify.mjs` in this directory to verify the complete fail-closed contract and its negative tamper suite.

The result is not a successful metadata acquisition and contains no fabricated manifest. It is the fail-closed proof that Lane C cannot proceed without a separately approved action that creates or changes staging data, which this lane explicitly forbids.

No secret value, runner IP, object contents, database URL, or credential is present in this bundle.
