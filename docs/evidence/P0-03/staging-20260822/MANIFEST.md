# Manifest artefak staging — provenance per berkas

Ditambahkan atas temuan Reviewer terhadap `6c0f4eb`: berkas JSON di direktori
ini **bukan keluaran mentah**. Ia proyeksi — memilih, mengganti nama, dan
meratakan field. Tanpa manifest ini, nilai seperti `status: "live"` (yang
bersifat sementara) tetap hanya klaim tertulis.

Semua perintah **hanya baca**. Nol deploy, nol restart, nol migrasi, nol
koneksi database, nol tulis.

| Artefak | Perintah persis | Waktu UTC | Exit | Filter sanitasi |
|---|---|---|---|---|
| `services.json` | `render services --output json --confirm` | 2026-08-22T12:51:37Z | 0 | F1 |
| `deploys-web.json` | `render deploys list srv-d9n28tijnfac73a87lt0 --output json --confirm` | 2026-08-22T12:51:37Z | 0 | F2 |
| `deploys-worker.json` | `render deploys list srv-d9n28ue417fc73ch2b60 --output json --confirm` | 2026-08-22T12:51:37Z | 0 | F2 |
| `postgres.json` | `render postgres list --output json --confirm` | 2026-08-22T12:51:37Z | 0 | F3 |
| `health-web.txt` | `curl -sS -m 45 -o - -w '\nHTTP_STATUS=%{http_code}\n' https://racun-ai-staging-web.onrender.com/api/health` | 2026-08-22T12:51:37Z | 0 | tidak ada (transcript apa adanya) |
| `meta-web.txt` | `curl -sS -m 30 -o - -w '\nHTTP_STATUS=%{http_code}\n' https://racun-ai-staging-web.onrender.com/api/meta` | 2026-08-22T13:00:04Z | 0 | tidak ada (transcript apa adanya) |

## Pipeline sanitasi — perintah yang BENAR-BENAR menghasilkan tiap artefak

Versi pertama manifest ini hanya menuliskan SET NAMA FIELD dan menyebutnya
"filter deterministik". Itu bukan transformasi: ia tidak membaca stdout, tidak
menentukan path field bersarang, tidak memfilter record, tidak membatasi lima
deploy, dan tidak menulis JSON. Akibatnya proyeksi yang di-commit tidak bisa
direproduksi siapa pun. Temuan Reviewer; di bawah ini pipeline sebenarnya.

Kenapa disanitasi sama sekali: keluaran `render` memuat env var, connection
string, dan URL dashboard. Menyimpannya mentah berarti memasukkan rahasia ke
dalam repo.

### F1 — `services.json`
```sh
render services --output json --confirm | python3 -c "
import sys,json
out=[]
for row in json.load(sys.stdin):
    s=row.get('service',row); n=s.get('name','')
    if 'staging' in n:
        out.append({'name':n,'id':s.get('id'),'type':s.get('type'),
                    'runtime':(s.get('serviceDetails') or {}).get('runtime') or s.get('runtime'),
                    'region':(s.get('serviceDetails') or {}).get('region')})
print(json.dumps(out,indent=2))" > services.json
```

### F2 — `deploys-web.json` / `deploys-worker.json`
```sh
render deploys list <SERVICE_ID> --output json --confirm | python3 -c "
import sys,json
rows=json.load(sys.stdin); rows=rows if isinstance(rows,list) else [rows]
out=[]
for r in rows[:5]:
    d=r.get('deploy',r); c=d.get('commit') or {}
    out.append({'deployId':d.get('id'),'status':d.get('status'),
                'commit':c.get('id'),'finishedAt':d.get('finishedAt'),'createdAt':d.get('createdAt')})
print(json.dumps(out,indent=2))" > deploys-<peran>.json
```
`SERVICE_ID`: web `srv-d9n28tijnfac73a87lt0`, worker `srv-d9n28ue417fc73ch2b60`.
Batas lima deploy berasal dari `rows[:5]` di atas — urutannya urutan yang
dikembalikan API, tidak diurutkan ulang.

### F3 — `postgres.json`
```sh
render postgres list --output json --confirm | python3 -c "
import sys,json
out=[]
for p in json.load(sys.stdin).get('data',[]):
    if 'staging' in (p.get('name') or ''):
        out.append({'name':p.get('name'),'id':p.get('id'),'databaseName':p.get('databaseName'),
                    'status':p.get('status'),'createdAt':p.get('createdAt')})
print(json.dumps(out,indent=2))" > postgres.json
```

Ketiganya membuang seluruh field selain yang disebut — termasuk `envVars`,
`connectionString`, dan `dashboardUrl`.

## Batas yang melekat pada artefak ini

`status: "live"` adalah keadaan **pada waktu pengambilan di atas**, bukan
jaminan saat dokumen ini dibaca. Deploy bisa berganti kapan saja. Yang tidak
berubah oleh waktu adalah `commit` yang tercatat pada deploy tersebut dan
`deployId`-nya — keduanya immutable dan bisa dicocokkan ulang lewat perintah
yang sama.
