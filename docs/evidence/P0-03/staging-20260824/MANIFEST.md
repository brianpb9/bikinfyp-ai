# Manifest refresh staging read-only — 24 Agustus 2026

Artefak di direktori ini diambil ulang oleh Builder setelah Reviewer menolak
pesan `.agent-bus` yang diabaikan Git sebagai provenance immutable. Seluruh
pembacaan terjadi pada 24 Agustus 2026. Tidak ada deploy, restart, migrasi,
koneksi datastore, perubahan konfigurasi, atau mutasi remote.

Keluaran Render CLI tidak disimpan mentah karena dapat membawa field yang
tidak layak masuk repository. Setiap pipeline di bawah membaca JSON di memory,
memilih record bernama `staging`, lalu hanya mencetak allowlist field yang
ditulis eksplisit. Nilai environment, connection string, dashboard URL, dan
credential tidak dicetak atau disimpan.

| Artefak | Mulai UTC | Selesai UTC | Exit | Filter |
|---|---|---|---|---|
| `services.json` | `2026-08-24T05:52:47Z` | `2026-08-24T05:52:48Z` | Render 0, filter 0 | F1 |
| `deploys-web.json` | `2026-08-24T05:52:36Z` | `2026-08-24T05:52:36Z` | Render 0, filter 0 | F2, satu hasil pertama |
| `deploys-worker.json` | `2026-08-24T05:52:41Z` | `2026-08-24T05:52:42Z` | Render 0, filter 0 | F2, satu hasil pertama |
| `postgres.json` | `2026-08-24T05:52:53Z` | `2026-08-24T05:52:53Z` | Render 0, filter 0 | F3 |
| `keyvalues.json` | `2026-08-24T05:53:01Z` | `2026-08-24T05:53:02Z` | Render 0, filter 0 | F4 |
| `health-web.txt` | `2026-08-24T05:53:07Z` | `2026-08-24T05:53:09Z` | curl 0 | transcript response publik apa adanya |

CLI yang dipakai adalah `/opt/homebrew/bin/render`, versi `v2.22.0`.
`PIPESTATUS=0 0` diamati untuk setiap pipeline Render di tabel.

## F1 — service staging

```sh
render services --output json --confirm | python3 -c '
import sys,json
out=[]
for row in json.load(sys.stdin):
    s=row.get("service",row)
    if "staging" not in (s.get("name") or ""): continue
    d=s.get("serviceDetails") or {}
    out.append({"name":s.get("name"),"id":s.get("id"),"type":s.get("type"),
                "suspended":s.get("suspended",d.get("suspended")),
                "autoDeploy":s.get("autoDeploy",d.get("autoDeploy"))})
print(json.dumps(out,indent=2,sort_keys=True))'
```

Allowlist F1: `name`, `id`, `type`, `suspended`, `autoDeploy`.

## F2 — live deploy per service

```sh
render deploys list <SERVICE_ID> --output json --confirm | python3 -c '
import sys,json
rows=json.load(sys.stdin); rows=rows if isinstance(rows,list) else [rows]
out=[]
for r in rows[:1]:
    d=r.get("deploy",r); c=d.get("commit") or {}
    out.append({"deployId":d.get("id"),"status":d.get("status"),
                "commit":c.get("id"),"finishedAt":d.get("finishedAt")})
print(json.dumps(out,indent=2,sort_keys=True))'
```

`SERVICE_ID` adalah `srv-d9n28tijnfac73a87lt0` untuk web dan
`srv-d9n28ue417fc73ch2b60` untuk worker. Allowlist F2: `deployId`, `status`,
`commit`, `finishedAt`. `rows[:1]` menyimpan satu hasil pertama dalam urutan
yang dikembalikan API; pipeline tidak mengurutkan ulang.

## F3 — PostgreSQL staging

```sh
render postgres list --output json --confirm | python3 -c '
import sys,json
raw=json.load(sys.stdin); rows=raw.get("data",raw) if isinstance(raw,dict) else raw
out=[]
for row in rows:
    p=row.get("postgres",row)
    if "staging" not in (p.get("name") or ""): continue
    out.append({"name":p.get("name"),"id":p.get("id"),"status":p.get("status")})
print(json.dumps(out,indent=2,sort_keys=True))'
```

Allowlist F3: `name`, `id`, `status`.

## F4 — Key Value staging

```sh
render keyvalues list --output json --confirm | python3 -c '
import sys,json
raw=json.load(sys.stdin); rows=raw.get("data",raw) if isinstance(raw,dict) else raw
out=[]
for row in rows:
    k=row.get("keyValue",row)
    if "staging" not in (k.get("name") or ""): continue
    out.append({"name":k.get("name"),"id":k.get("id"),"status":k.get("status")})
print(json.dumps(out,indent=2,sort_keys=True))'
```

Allowlist F4: `name`, `id`, `status`.

## Health publik

```sh
curl -sS -m 45 -w '\nHTTP_STATUS=%{http_code}\n' \
  https://racun-ai-staging-web.onrender.com/api/health
```

Timestamp lokal sebelum request adalah
`2026-08-24T12:53:07+0700 Asia/Jakarta`. Transcript menyimpan body, status
HTTP, exit curl, serta batas waktu mulai/selesai. Endpoint ini publik; tidak ada
header autentikasi atau credential dalam command.
