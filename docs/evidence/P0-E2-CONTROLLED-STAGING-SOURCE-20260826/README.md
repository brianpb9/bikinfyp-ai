# Controlled staging E2 source

Result: **PASS** on staging deploy
`0c541a0ccae1c9c46ab1726a24724f2a5e16727b`.

The E2 source is a committed synthetic NOVA product fixture admitted only when
`RENDER_SERVICE_ID` equals the exact managed staging web service. Its page and
image paths are exact; production identity returns 404 and does not extend the
marketplace whitelist. Redirects are followed manually only after validating
each hop and resolving every address against complete non-global IPv4/IPv6
ranges. The HTTP/TLS connection is pinned to those validated addresses while
retaining the original hostname for SNI, certificate verification, and Host;
there is no check/use DNS race. Image downloads use the same pinned,
manual-redirect transport, and every controlled-image hop must remain the
exact permitted image URL.

The public E2 API created one retail product with exact source, price,
category, ordered PostgreSQL image list, and an R2 image/sidecar pair whose
hash matched and whose classifier result was reference-eligible. Arbitrary,
sibling-spoofed, private, link-local, and unsafe-redirect sources all failed
closed without product or R2 mutation.

The managed run used no provider, generation, payment, money, or queue path.
Final reads proved zero target database, financial, queue, and R2 residue.
Only staging web was deployed; staging worker and both production services
remained on their prior exact SHAs.
