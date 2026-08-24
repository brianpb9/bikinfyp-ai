# Manifest refresh production read-only — 24 Agustus 2026

Artefak di direktori ini adalah pembacaan production control-plane dan
endpoint publik secara read-only pada 24 Agustus 2026. Tidak ada deploy,
restart, migrasi, perubahan konfigurasi, koneksi datastore, autentikasi,
aktivasi payment, atau panggilan provider.

Keluaran Render CLI tidak disimpan mentah. Pipeline membaca JSON di memory,
memilih hanya dua service ID production yang disetujui, lalu mencetak allowlist
field eksplisit. Nilai environment, connection string, dashboard URL,
credential, dan field lain dibuang. Untuk halaman legal, body HTML tidak
disimpan; hanya HTTP status dan byte count dari curl.

| Artefak | Mulai UTC | Selesai UTC | Exit | Filter |
|---|---|---|---|---|
| `services.json` | `2026-08-24T06:01:14Z` | `2026-08-24T06:01:15Z` | Render 0, filter 0 | F1 |
| `deploys-web.json` | `2026-08-24T06:01:21Z` | `2026-08-24T06:01:22Z` | Render 0, filter 0 | F2, satu hasil pertama |
| `deploys-worker.json` | `2026-08-24T06:01:26Z` | `2026-08-24T06:01:27Z` | Render 0, filter 0 | F2, satu hasil pertama |
| `health-web.txt` | `2026-08-24T06:01:32Z` | `2026-08-24T06:01:32Z` | curl 0 | response publik apa adanya |
| `meta-web.txt` | `2026-08-24T06:01:48Z` | `2026-08-24T06:01:48Z` | curl 0, filter 0 | F3 |
| `legal-pages.txt` | `2026-08-24T06:02:01Z` | `2026-08-24T06:02:02Z` | curl 0 per halaman | status + byte count saja |

CLI yang dipakai adalah `/opt/homebrew/bin/render`, versi `v2.22.0`.
`PIPESTATUS=0 0` diamati untuk setiap pipeline Render dan pipeline meta.

## F1 — service production

```sh
render services --output json --confirm | python3 -c '
import sys,json
wanted={"srv-d9nhccfqj5pc73et9hrg","srv-d9ni3ndaeets73c07kq0"}; out=[]
for row in json.load(sys.stdin):
    s=row.get("service",row)
    if s.get("id") not in wanted: continue
    d=s.get("serviceDetails") or {}
    out.append({"name":s.get("name"),"id":s.get("id"),"type":s.get("type"),
                "suspended":s.get("suspended",d.get("suspended")),
                "autoDeploy":s.get("autoDeploy",d.get("autoDeploy")),
                "url":s.get("url",d.get("url"))})
print(json.dumps(out,indent=2,sort_keys=True))'
```

Allowlist F1: `name`, `id`, `type`, `suspended`, `autoDeploy`, `url`. Hanya
dua ID di set `wanted` yang dapat keluar.

## F2 — live deploy per service

```sh
render deploys list <SERVICE_ID> --output json --confirm | python3 -c '
import sys,json
rows=json.load(sys.stdin); rows=rows if isinstance(rows,list) else [rows]; out=[]
for r in rows[:1]:
    d=r.get("deploy",r); c=d.get("commit") or {}
    out.append({"deployId":d.get("id"),"status":d.get("status"),
                "commit":c.get("id"),"finishedAt":d.get("finishedAt")})
print(json.dumps(out,indent=2,sort_keys=True))'
```

`SERVICE_ID` adalah `srv-d9nhccfqj5pc73et9hrg` untuk web dan
`srv-d9ni3ndaeets73c07kq0` untuk worker. Allowlist F2: `deployId`, `status`,
`commit`, `finishedAt`. `rows[:1]` menyimpan satu hasil pertama sesuai urutan
API tanpa pengurutan ulang.

## Health publik

```sh
curl -sS -m 45 -w '\nHTTP_STATUS=%{http_code}\n' \
  https://bikinfyp-ai.onrender.com/api/health
```

Response publik disimpan apa adanya bersama status dan exit curl. Tidak ada
header autentikasi.

## F3 — meta publik tersanitasi

```sh
curl -sS -m 45 -w '\nHTTP_STATUS=%{http_code}' \
  https://bikinfyp-ai.onrender.com/api/meta | python3 -c '
import sys,json
raw=sys.stdin.read(); body,status=raw.rsplit("\nHTTP_STATUS=",1); d=json.loads(body)
safe={k:d.get(k) for k in ("code","message_id","message_en","retryable")}
print(json.dumps(safe,indent=2,sort_keys=True,ensure_ascii=False))
print("HTTP_STATUS="+status)'
```

Allowlist F3: `code`, `message_id`, `message_en`, `retryable`, ditambah HTTP
status yang dibuat curl. Endpoint menjawab 401; tidak ada cookie, token, atau
header autentikasi yang dikirim.

## Halaman legal — status dan byte count saja

```sh
for legal_path in /legal/privacy /legal/terms /legal/refund; do
  curl -sS -m 45 -o /dev/null \
    -w "PATH=$legal_path HTTP_STATUS=%{http_code} BYTES=%{size_download}\n" \
    "https://bikinfyp-ai.onrender.com$legal_path"
done
```

Body dialihkan ke `/dev/null`, sehingga tidak masuk artefak. Timestamp lokal
per request dan exit curl per halaman ada di `legal-pages.txt`.
