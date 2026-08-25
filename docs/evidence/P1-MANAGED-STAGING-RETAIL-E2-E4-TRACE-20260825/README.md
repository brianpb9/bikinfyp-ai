# Managed staging retail E2/E4 trace

Result: **PASS with bounded E2 blocker** on deployed app SHA
`246fa65949a487e82e4594c0bebb6ecc5a4e53bb`.

The only deterministic controlled source available was the managed staging
origin itself. E2 rejected it normally as outside the accepted marketplace
whitelist before fetch, product creation, or R2 writes. No controlled source
exists under the accepted `tiktok.com`, `shopee.co.id`, `tokopedia.com`, or
`shp.ee` domains. The trace did not substitute a third-party asset or bypass
SSRF validation.

E4 was exercised independently using an E1-created dedicated retail fixture.
The positive append proved exact ordered API/PostgreSQL/R2 identity and a valid
hash-bound sidecar. Deterministic brand-mismatch and unreadable-label requests
both returned their canonical HTTP 400 codes before DB or R2 mutation.

All dedicated DB rows and four R2 objects were removed. Final authoritative
reads found zero DB, financial, provider, queue, and R2 residue. Production
deploy identities were unchanged. No credential, JWT, signed URL, test ID, or
object key is included.
