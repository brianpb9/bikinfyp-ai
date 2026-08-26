# C2 TYPE_MISMATCH RED contract — 2026-08-26

Task: `P0-C2-TYPE-MISMATCH-RED-CONTRACT-20260826`

## Result

Engineering discovery is complete and the RED contract is reproducible. The
focused harness has four passing discovery/control tests and exactly one
intentional failure:

`C2_MISSING_INVARIANT`, followed by the exact missing seam/effect ordering for
every E1/E3/E6/E7/A1–A4 boundary and the absent central production module.

This is a Product Policy input gap, not a compiler, fixture, provider, money,
or infrastructure failure. Current storage has only `products.category`.
That value comes from a user choice, UI default, or keyword guess; it is not an
independent authoritative statement of what the photographed product is.

The example “toothpaste categorised as facewash” therefore cannot be
implemented truthfully from current inputs. No taxonomy, classifier result,
reason code, or rejection policy was added.

## Proposed central seam (not implemented)

Future policy may provide a trusted, provenance-bearing opaque type token. A
central seam tentatively named `validateAuthoritativeProductType` would compare
the declared category/type token with that independent token:

- matching trusted token: admit;
- different trusted token: reject control flow (not a returned decision that a
  handler can ignore) before persistence/admission/spend;
- missing token or provenance: return an explicit policy-undetermined result,
  never silently reject or admit on the test reference model.

The name and reference behavior are test-only. `TYPE_MISMATCH` remains
proposal-only. Correct insertion points are before E1/E3/E6/E7 persistence and,
as defense in depth, after the authoritative product row is loaded/locked but
before A1–A4 generation, snapshot, job insert, hold, enqueue, or provider work.

## Genuine product-policy inputs required

1. An approved taxonomy and version, including whether `category` itself is a
   type token or remains a merchandising category.
2. An authoritative signal source and provenance contract (human confirmation,
   trusted catalogue, approved classifier, or another explicitly authorised
   source), plus how E1/E3/E6/E7 populate and mutate it.
3. Approved normalization/mapping and confidence/unknown behavior. Keyword
   guessing and UI defaults cannot be promoted into truth implicitly.
4. Mutation and legacy-row treatment, including whether missing/ambiguous
   signals block create, edit, admission, or only request remediation.
5. Canonical API/audit reason-code and copy. `TYPE_MISMATCH` is still only the
   matrix proposal.

## Reproduction

```sh
node scripts/verify-c2-type-mismatch-red.mjs
```

The verifier succeeds only when the inner RED suite exits 1 for exactly the
intended missing invariant, with four passing discovery/control tests and no
compile/module/setup error. The RED test parses TypeScript AST call expressions
per exported handler, scans every import declaration from the central module,
and requires named imports from
`@/lib/product-type-boundary`; receiver methods, namespace access, and locally
shadowed names do not satisfy it. All production `app/` and `lib/` sources are
also scanned for direct or indirect contract-test issuer access. Each
known storage, persistence, provider-generation, script/job/audit write, credit,
managed-trace queue, and ordinary enqueue effect must be an AST descendant
of the seam's effect callback; a merely prior or ignored call cannot satisfy
it. The seam rejection must be awaited or returned. Its first argument must be
the typed `buildAuthoritativeTypeBoundaryInput(declaredSource, trustedSource)`
dataflow boundary; raw objects, comments, and the same expression on both sides
cannot satisfy it. Trusted sources are opaque ingress-issued capabilities
tracked by runtime identity, so structurally forged same-data/different-ID
objects fail while a legitimately issued similarly named source remains valid.
Even a frozen clone of an issued capability—with identical fields and issuer-
looking prefix—fails because runtime object identity, not caller-selected
structure or `Object.isFrozen`, is authoritative.
Production handlers may not import the contract-test capability issuer. If the
central production module later exists, the same test directly probes it with
trusted-match, trusted-mismatch, and missing-policy inputs. Mismatch must throw,
not merely return `REJECT_MISMATCH`, and invoke zero effects; a trusted match
must invoke exactly one effect; missing policy must also invoke zero effects.
Boundary-level mutation controls prove that an
ignored returned decision yields false 2xx while rejection yields non-success.
No actual handler is required to accept or reject from `category` alone:
production has no authorised trusted-signal ingress yet, and manufacturing one
inside this task would make the test itself define policy. The normal `npm test`
glob does not include the
`.red.ts` file, so an intentional RED cannot break unrelated CI.

No deploy, provider call, payment, credit hold, queue mutation, database
mutation, new secret, or production operation was performed.
