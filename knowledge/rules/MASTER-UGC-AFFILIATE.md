# MASTER — AI UGC AFFILIATE
Untuk Claude Code (Higgsfield/Chrome) dan engine BikinFYP. Berlaku bersama STANDARD-10-ugc v2 (gate 12 baris, gate klip, skor setelah klip, data filter, aturan uang). Dokumen ini menambahkan apa yang KHUSUS Affiliate.
Disusun 18 Aug 2026 dari 15+ skrip JJ Glow, 9 render nyata, playbook BikinFYP.

## 1. Apa itu Affiliate (dan bukan)
Affiliator/pembeli bicara di akun sendiri: "aku beli/pakai ini, kamu juga bisa". Yang dijual: pengalaman pribadi + akses beli. Nada spontan, agak "ngaku", boleh rame; satu ide sekali pakai per akun; algoritma organik — hook harus menang dalam 1 detik di feed yang mute.
Bukan Affiliate: iklan brand yang halus tanpa tindakan pribadi; naskah tanpa satu pun "aku beli/pakai/simpan/rebutan"; klaim manfaat.
Uji kamar: kalau tidak ada tindakan pribadi, itu Ads yang salah kamar.

## 2. Ide yang menang
Anomali sosial + kejadian pribadi yang kebaca tanpa kata di detik 0–1:
- social_theft: direbutin/disembunyiin/dijaga (brankas, dititip di warung, kulkas isi sabun)
- forbidden: "nggak boleh disentuh sembarangan" (museum, sarung tangan)
- absence: yang tersisa cuma ini (meja rias kosong)
- anomaly_pov: framing yang belum dipakai kategori (POV dari dalam kantong belanja)
- time_compression: habisnya cepat karena sekeluarga rebutan
- confession: "iya, itu aku" setelah anomali
- secret/mystery_box: open loop, isi tidak bocor di gambar maupun kalimat
Level minimal L2 untuk kategori jenuh; L4 = dunia nyata dilebihkan; L5 = fisika dilanggar, efek foreground, dialog jujur.
Kalimat harus spesifik produk (uji ganti-produk gagal = generik).

## 3. Struktur 15 detik (default Affiliate)
HOOK 0–5 tanpa wajah/wajah sekejap, anomali tanpa dialog · BODY 5–10 pengakuan/alasan (bukan katalog): "Bulan lalu sabun ini dipakai satu rumah. Sisa tiga hari." · CTA 10–15 satu take, produk hero, label terbaca, diam 1 detik, kalimat cerita + frasa wajib.
Boleh 20 detik kalau body butuh dua beat (alasan + bukti). Tetap kausal: body menjawab pertanyaan hook.

## 4. Bridging produk
Lebih ringan dari Ads karena affiliator boleh bicara soal beli/pakai: tunjuk isi/netto, pegang dua bar, buka kotak, tepuk kantong belanja, struk kelihatan. Tetap tanpa klaim manfaat; harga boleh ditulis kata; promo hanya di caption.

## 5. Bahasa & CTA
Sehari-hari, aku-kamu (beauty/fashion), gue-lo (gadget/food), Bun (home/kids). ≤10 kata per shot, tempo dialog mengikuti pita genre & durasi (aturan lama 1,5 kata/detik DIBATALKAN 4 Sep 2026 — pita tempo per genre & durasi berlaku (lib/script-engine/pita-tempo.ts). Diukur: 17 kata/15 dtk meninggalkan 8,48 dtk sunyi (56% video diam); 49 kata + arahan aktif menyisakan 0,40 dtk). CTA lisan wajib "keranjang kuning" (Shopee: keranjang oren; Tokopedia: keranjang), buffer "linknya **ada** di", didahului klausa cerita: "Sekarang dijaga. Kalau mau, keranjang kuning ya." Caption penuh + ≤8 hashtag, promo/harga di caption.

## 6. Klaim & filter
Standar: nol medis/whitening/instan; angka hanya harga (kata) dan isi ("isi lima"). Kosakata pemicu, tubuh, kamar mandi, negasi: STANDARD v2 §B.8 dan §E. Teks overlay boleh, default OFF, ≤9 kata, post-production. Musik: default tanpa; boleh untuk no-face; ditambah saat upload.

## 7. Variasi katalog per talent
Gesture body dan kalimat CTA tidak identik >2 video berturut-turut (buka kotak / tuang dua bar / tunjuk netto / putar kotak / tepuk kantong / tumpuk menara). Rotasi mekanik; anti-repeat mekanik per brand 30 hari.

## 8. Contoh acuan Affiliate (lulus & jadi)
- "Disimpan di brankas" L4 forbidden — jadi.
- "Museum" L4 scale — frame terbaik, label terbaca 720p.
- "Mystery box dari adik" L2 secret — jadi.
- "Habisnya kecepetan" L5 time_compression — jadi (dialog: sekeluarga rebutan).
- Cadangan kuat: POV kantong belanja, kulkas, dititip di warung, CCTV minimarket (versi tenang: "slides the row into her basket in one long motion").
Gagal: pain-hook L1 polos ("sabun lama bikin kusam"), review sensori generik, hook yang butuh kalimat.

## 9. Alur
ide (one-liner + mekanik + why_stop) → gate 12 baris → cek pemicu → prompt 15 dtk → frame → render satu per satu (ditolak & bersih → antre lagi) → gate klip → skor dengan benchmark bernama (akun afiliasi teratas kategori sama).
