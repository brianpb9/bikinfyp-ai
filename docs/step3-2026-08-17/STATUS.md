# STEP 3 — Idea Stage + FYP Gate (PATCH 4)

**Tanggal:** 17 Agustus 2026 · **Status:** terpasang, **belum diuji ke model sungguhan** (kredit Anthropic habis)

---

## Yang dibangun

`lib/script-engine/idea-mechanics.ts` — bank 12 mekanik (§4), kategori jenuh,
anti-ulang 30 hari, penyaring ide generik.

`lib/script-engine/ide.ts` — Idea Stage (5 kandidat, mekanik berbeda) dan FYP
Gate (6 dimensi berbobot, ambang total 75 + ambang per dimensi, maksimal 2
putaran). Model kelas atas terpisah: `ANTHROPIC_MODEL_IDEAS`, bawaan
`claude-opus-5`.

Terpasang di `generateScripts()` — **sekali per permintaan, bukan per varian**.

## Tiga keputusan yang lahir dari menulisnya

**Ambang per dimensi ada supaya kelemahan kritis tidak bisa dirata-ratakan.**
Ide dengan scroll-stop 4 tapi sempurna di lima dimensi lain masih mencapai total
82 — di atas ambang 75. Tanpa ambang per dimensi, video yang tidak menghentikan
siapa pun lolos dengan nilai bagus. Ada tesnya.

**Dimensi yang tidak dinilai dihitung NOL, bukan diabaikan.** Penilai yang
melewatkan satu dimensi tidak boleh menghasilkan skor yang terlihat baik; itu
cara paling halus untuk lolos tanpa benar-benar dinilai.

**Semua kandidat dinilai, tidak berhenti di yang pertama lulus** — dan ini cacat
desain yang ditemukan tesnya, bukan yang saya rencanakan. Versi pertama berhenti
lebih awal demi hemat, sehingga peringkatnya cuma berisi satu entri dan **ketiga
varian naskah memakai ide yang sama persis**. Itu mengembalikan layar "pilih
naskah" jadi pilihan palsu — salah satu sebab keluaran terasa datar. Sekarang
varian ke-i memakai ide peringkat ke-i: tiga varian = tiga sudut.

## hook-devices.ts akhirnya hidup di produksi

Hook tanpa perangkat retoris yang bisa dikenali `POLA_PERANGKAT` **gugur
otomatis, tanpa dinilai model**. Sampai hari ini berkas itu ada tapi tidak
pernah memutuskan apa pun.

## Yang TIDAK terjadi diam-diam

- Gate gagal dua putaran → ide terbaik tetap dikembalikan **beserta peringkat
  dan sebab gagalnya**, dan dicatat di log. Tidak dirender sebagai "bagus".
- Idea Stage gagal total (model mati/kredit habis) → naskah tetap ditulis
  seperti sebelumnya. Ia lapisan mutu, bukan syarat hidup. Sebabnya dicatat.

## Yang MENGHALANGI, dan butuh Brian

**Kredit Anthropic habis.**

```
HTTP 400 — Your credit balance is too low to access the Anthropic API.
```

Diuji pada dua model (`claude-sonnet-4-6` dan `claude-opus-5`), jawabannya sama
— jadi ini soal saldo, bukan nama model.

Dua akibatnya:

1. Perbandingan hook Scarlett **sebelum vs sesudah** belum bisa dijalankan.
   Skripnya siap; tinggal dijalankan begitu saldo terisi.
2. **Di produksi sekarang, penulis naskah LLM sedang jatuh ke template** dan log
   `JATUH KE TEMPLATE` sedang menyala. Naskah tetap keluar, tapi ia template
   pengisi — persis kondisi yang STEP 1 dibuat untuk mengakhiri.

## Sisa PATCH 4/5

- L-19 (hook wajib memakai perangkat) sudah berlaku **di tahap ide**; sebagai
  aturan validator naskah ia belum ada.
- L-20 (segmen dilarang memakai VISUAL generik templates.ts) belum ada.
- Anti-ulang mekanik masih parameter — belum membaca riwayat merek dari basis
  data. Butuh kueri job_prompts × products; mekanik terpilih sudah punya tempat
  simpan (`ide_id`, `ide_skor` di migrasi 0032).
- STEP 4 (QC-13/QC-14) belum dimulai.
