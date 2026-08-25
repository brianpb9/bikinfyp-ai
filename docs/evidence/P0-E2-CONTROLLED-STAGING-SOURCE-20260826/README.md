# Controlled staging E2 source

Result: **PASS** on staging deploy
`246c48b5f311ccc04746b6ad0078bdb984137c18`.

The E2 source is a committed synthetic NOVA product fixture admitted only when
`RENDER_SERVICE_ID` equals the exact managed staging web service. Its page and
image paths are exact; production identity returns 404 and does not extend the
marketplace whitelist. Redirects are followed manually only after validating
each hop and resolving every address against private/reserved ranges.

The public E2 API created one retail product with exact source, price,
category, ordered PostgreSQL image list, and an R2 image/sidecar pair whose
hash matched and whose classifier result was reference-eligible. Arbitrary,
sibling-spoofed, private, link-local, and unsafe-redirect sources all failed
closed without product or R2 mutation.

The managed run used no provider, generation, payment, money, or queue path.
Final reads proved zero target database, financial, queue, and R2 residue.
Only staging web was deployed; staging worker and both production services
remained on their prior exact SHAs.
