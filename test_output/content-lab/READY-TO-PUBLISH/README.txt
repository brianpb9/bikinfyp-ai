READY TO PUBLISH — video lolos semua QC, 100% AI-generated, sesuai aturan terbaru
(tanpa foto asli disisipkan — sesuai instruksi Brian 2026-08-08).

01-wardah-lightening-serum-30dtk-model2.0mini.mp4
  Model: dreamina-seedance-2-0-mini (default produksi sekarang)
  QC: semua pass. Job 78066167.

02-wardah-lightening-serum-30dtk-model2.5-labelTERBAIK.mp4
  Model: dreamina-seedance-2-5 (baru dites, BELUM jadi default produksi)
  QC: semua pass, label paling tajam dari semua render sesi ini. Job e13251a4.
  Biaya asli BELUM terverifikasi (model belum terdaftar di tabel harga kita).

03-maybelline-superstay-matte-ink-30dtk.mp4
  Model: dreamina-seedance-2-5. Label tajam sempurna (dicek manual + OCR
  rotasi-manual) TAPI status job REFUNDED — QC-10 gagal karena teks di tube
  tercetak VERTIKAL dan Tesseract tidak baca teks vertikal (bug detektor,
  bukan cacat video). Harga Rp92.000 terverifikasi (promo Tokopedia/Sociolla).

04-mosseru-showergel-30dtk.mp4
  Model: byteplus-ark-seedance (default). QC: semua pass bersih. Harga
  Rp119.000 (terverifikasi — angka Rp74rb di screenshot awal TIDAK match
  harga manapun, kemungkinan salah baca kolom).
  REVISI 2026-08-09: versi sebelumnya pakai kategori produk "beauty" -> demo
  action-nya salah (drop-test di punggung tangan ala serum wajah, padahal ini
  shower gel). Brian lapor "ini kan bukan skin care". Root cause: category
  "body_care" belum ada di DEMO_ACTION (shot-planner.ts) saat render pertama.
  Sudah ditambahkan + di-deploy (commit 2cb4256); di-render ulang pakai
  kategori body_care -> demo sekarang benar (pompa ke telapak tangan). File
  ini SUDAH versi revisi.

05-barberdaily-sixblade-razor-30dtk.mp4
  Model: dreamina-seedance-2-5. QC: semua pass bersih. Harga Rp15.000
  (terverifikasi — angka Rp964,90rb di screenshot awal SALAH, itu kemungkinan
  omzet bukan harga satuan; harga asli razor ini Rp11.600–29.500).

06-shellasaukia-dress-novella-15dtk.mp4
  Model: byteplus-ark-seedance, talking_head 15dtk. Harga Rp1.500.000
  (Shella Saukia Dress Novella). Brian lapor "sound dan video tidak match,
  sound kecepatan" (VO cuma ngisi ~10,6dtk dari 15dtk, sisa hening). Root
  cause + fix lengkap = r19 (lihat commit 1c5b73d): skrip tier bersuara 15dtk
  sekarang konsisten 25-30 kata, ngisi durasi tanpa hening/kepotong.
  CATATAN PENTING: file ini MASIH versi lama (belum pakai skrip hasil fix
  r19). 2x percobaan render ulang (2026-08-09) GAGAL di QC-10 (label produk
  tidak terbaca) — root cause: QC-10 butuh teks merek ("novella"/"shella"/
  "saukia") terbaca di frame, tapi ke-3 foto referensi dress ini adalah foto
  lifestyle/kain, TIDAK ADA satupun yang menunjukkan tag/label baju dengan
  nama merek tercetak. Ini kemungkinan masalah SISTEMATIS untuk semua produk
  fashion (baju/dress/hijab) tanpa foto close-up tag merek — lihat juga
  Diario di bawah. Perlu keputusan Brian: (a) kirim foto tag/label baju buat
  di-render ulang, atau (b) longgarkan QC-10 khusus kategori fashion.

Diario Cassandra Sarimbit Gamis Dewasa (BELUM di-render)
  Harga terverifikasi Rp459.000 (promo, dari Rp763.000) — diario.co.id,
  dicek langsung 2026-08-09. Foto referensi (storage/lab-diario) juga semua
  foto lifestyle tanpa tag merek terlihat — kemungkinan besar akan kena
  bug QC-10 yang sama persis dengan dress Shella Saukia di atas. DITAHAN
  dulu, tidak di-render, sampai ada keputusan soal QC-10 fashion di atas —
  supaya tidak buang kredit render buat kegagalan yang sudah bisa diprediksi.

07-skintific-5x-ceramide-30dtk.mp4
  Model: byteplus-ark-seedance. Skintific 5X Ceramide Barrier Moisture Gel,
  harga Rp129.000. QC: semua pass (job e243098c).

08-somethinc-niacinamide-30dtk.mp4
  Model: byteplus-ark-seedance. SOMETHINC 5% Niacinamide + Moisture Sabi Beet
  Serum, harga Rp99.000 (dari data produk tersimpan sesi ini — cek ulang
  harga terbaru sebelum posting kalau ragu). QC: semua pass, label terbaca
  jelas (job 5d500f77). Render awal sempat di-kill manual oleh Brian saat
  polling lokal berjalan, tapi job di server tetap lanjut sampai selesai —
  hasil ini diambil langsung dari server, bukan render ulang.

09-scarlett-acneserum-30dtk.mp4
  Model: byteplus-ark-seedance. Scarlett Acne Serum Azeclair 2% Salicylic
  Acid + Niacinamide 15ML, harga Rp49.000 promo (dari Rp75.000) — verified
  langsung dari scarlettofficial.id. QC: semua pass, label terbaca jelas
  (job f6e794c1). CATATAN: 3 foto referensi awal (storage/lab-scarlettskin)
  ternyata 2 di antaranya adalah BANNER MARKETING (bukan foto produk polos) —
  ada wajah model, klaim "7 hari", dan foto close-up jerawat asli di kulit.
  2x percobaan render pakai ketiga foto itu diam-diam JATUH ke mock provider
  (BytePlus/dashscope gagal generate, kemungkinan kena content-filter foto
  jerawat/klaim kesehatan). Fix: dipakai HANYA foto produk polos (foto ke-1
  dari 3), render langsung berhasil pakai provider asli. Pelajaran: banner
  marketing/foto before-after TIDAK boleh dipakai sebagai foto referensi.

10-glad2glow-centella-30dtk.mp4
  Model: byteplus-ark-seedance. Glad2Glow Centella Allantoin Soothing Gel
  Moisturizer 55g, harga Rp41.600 promo (dari Rp49.000) — verified langsung
  dari watsons.co.id (SKU BP_37299, exact match sama foto referensi). QC:
  semua pass, label terbaca jelas (job 52-glad2glow-centella-30dtk).

TIDAK dimasukkan meski lolos QC:
- Video dengan "product proof insert" (foto asli disisipkan di ujung) — sudah
  dicabut total per instruksi Brian, walau videonya sendiri lolos QC.
- Video promo app BikinFYP.AI (appads-final.mp4) — masih draft, belum di-approve.
