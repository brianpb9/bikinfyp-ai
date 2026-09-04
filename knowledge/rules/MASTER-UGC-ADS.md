# MASTER — AI UGC ADS
Untuk Claude Code (Higgsfield/Chrome) dan engine BikinFYP. Berlaku bersama STANDARD-10-ugc v2 (gate 12 baris, gate klip, skor setelah klip, data filter, aturan uang). Dokumen ini menambahkan apa yang KHUSUS Ads.
Disusun 18 Aug 2026 dari 25+ skrip MW-3/JJ Glow, Story OS v1.0 (HDRV), 9 render nyata.

## 1. Apa itu Ads (dan bukan)
Brand bicara lewat wajah orang biasa, ditayangkan berbayar berhari-hari ke orang yang tidak minta. Yang dijual: SATU perasaan/situasi yang bikin brand nempel — bukan penjelasan produk, bukan lelucon. Ads yang benar terasa seperti potongan hidup seseorang; produk hadir tanpa diperkenalkan.
Bukan Ads: lelucon yang mati di tontonan kedua (odol di laci sendok), b-roll tangan menaruh produk (aku ngopi terus), kalimat katalog ("isinya dua sabun batang"), CTA belanja.
Uji kamar: kalau naskah masih masuk akal dengan CTA "keranjang kuning", itu Affiliate yang menyamar → tulis ulang.

## 2. Insight sebelum ide (wajib)
Setiap brand/kategori punya satu kebenaran manusia yang bisa dipegang bertahun-tahun. Tulis satu kalimat, tanpa produk di dalamnya. Contoh MW-3: "orang yang menahan senyum" (nutup mulut saat tertawa, senyum bibir rapat, hindari foto). Semua ide lahir dari insight itu; kampanye = insight × situasi berbeda.
Format: INSIGHT: <kebenaran manusia> · TAGLINE (caption saja, tidak diucapkan): <2–3 kata> · BAHASA VISUAL: <satu gestur berulang yang jadi tanda kampanye>.

## 3. Story OS untuk Ads (adaptasi HDRV Story OS)
Durasi 10 / 20 / 30 detik. Beat wajib, ditulis Button-first:
- BUTTON dulu: satu tanya kecil yang tersisa di ujung (hasil foto tidak diperlihatkan; "keterima nggak?"; "besok dia senyum nggak?"). CTA hidup di dalamnya, bukan ditempel.
- SPIKE: pelampiasan — protagonis mengalahkan tekanannya sendiri DI DEPAN SAKSI (saksi boleh suara saja: petugas, ibu, pewawancara, grup call). Di 65–80% durasi.
- HOOK: konflik/anomali sudah ada di frame pertama, tanpa kata; shot 1 tanpa wajah (data filter). Boleh mencuri momen dari spike.
- FRICTION: tekanan NAIK minimal dua kali (musuh terbaik: kebiasaan/refleks sendiri, waktu yang habis, suara yang memanggil). Bukan penjelasan hook. Kausalitas keras: tiap beat "karena itu / tapi ternyata", nol "lalu".
Proporsi: 10 dtk = HOOK 3 · FRICTION+SPIKE 4 · BUTTON 3. 20 dtk = 4 · 7 · 5 · 4. 30 dtk = 4 · 11 · 9 · 6.
Satu emosi dominan per video (deg-degan→lega, geram→puas, haru). Satu reversal. Bahan bakar: vanity (dilihat/dihormati) paling cocok untuk kecantikan/personal care; greed/lust hati-hati.
Scene card per shot: FUNGSI · KONFLIK · GESER (apa yang berubah) · DORONG (memaksa shot berikutnya) · TES 3 DTK.

## 4. Bridging produk (wajib, tanpa klaim)
Cerita bagus tanpa jembatan = penonton tidak tahu kenapa produknya ini. Tiga jembatan, minimal dua dipakai:
1. AKSI jujur dengan produk di friction (sikat gigi berbusa di meja rias; tube dimasukkan saku seperti jimat; cek gigi di cermin kecil "udah bersih").
2. PRODUK di frame pertama tanpa dijelaskan (di meja rias di antara lipstik; di saku blazer; di rak di bawah foto).
3. PENGAKUAN ringan di CTA sebelum frasa wajib ("Tadi sikat gigi dulu, hehe." / "Yang ini nggak aku hapus." / "Nanti aku kabarin ya.").
Penonton yang menyimpulkan manfaat; kita tidak pernah mengucapkannya.

## 5. Aturan bahasa
Kalimat orang beneran, pendek, ≤8 kata per baris: "Ih, jangan sekarang dong." / "Udah. Masuk aja." / "Ya udah deh." / "Iya, iya. Aku baru bangun. Kenapa?" Dilarang: copy iklan, kalimat penjelasan, "aslinya…" sebagai pembuka body, superlatif. Dialog boleh berhenti di tengah (hitungan, napas). Tempo dialog mengikuti pita genre & durasi (aturan lama 1,5 kata/detik DIBATALKAN 4 Sep 2026 — pita tempo per genre & durasi berlaku (lib/script-engine/pita-tempo.ts). Diukur: 17 kata/15 dtk meninggalkan 8,48 dtk sunyi (56% video diam); 49 kata + arahan aktif menyisakan 0,40 dtk).
CTA wajib: "Detailnya **ada** di bawah ya" (buffer "ada"), didahului satu klausa cerita.

## 6. Klaim & filter (ketat)
Nol angka, harga, durasi hasil, before/after, close-up organ (gigi/kulit makro). Kata manfaat (whitening/brightening/memutihkan/instan) hanya di label fisik. Senyum bibir tertutup default; senyum terbuka hanya sebagai PAYOFF, jarak wajar. Kosakata pemicu dan aturan tubuh/kamar mandi/negasi: lihat STANDARD v2 §B.8 dan §E. Kamar tidur = risiko belum teruji → pakaian tidur lengkap dan longgar; alternatif sofa ruang tamu.

## 7. Struktur produksi
Shot 1 tanpa wajah. 20–30 detik = 2 klip; klip 2 dari MASTER frame yang sama untuk wajah. Talking >15 detik dalam satu klip = wajah tidak dijamin, katakan. Suara saksi ditulis "off camera" eksplisit. Layar HP/kartu/kertas selalu menghadap menjauh (teks liar). Produk true-size lock.

## 8. Contoh acuan Ads (lulus)
- "Foto KTP" 10 dtk — "Jangan senyum ya, Mbak." → senyum lepas → "…ya udah deh." → KTP lama tetap terbalik.
- "Wawancara Kerja" 20/30 dtk — tangan sendiri sebagai musuh, suara pewawancara, "Tadi aku senyum. Beneran senyum.", HP bergetar di ujung.
- "Video Call Mendadak" 20 dtk — horor sehari-hari, cahaya dari bawah, "Ya ampun. Grup kantor.", twist "kamu yang presentasi besok, kan?".
- "Sebelum Ijab" 20 dtk — taruhan tertinggi, tiga jembatan produk (sikat gigi di meja rias, cek cermin "udah bersih", "tadi sikat gigi dulu, hehe").
- "Foto Bersama" 30 dtk — tangan di semua foto lama, timer, "Yang ini nggak aku hapus."
Gagal: laci sendok (lelucon), aku ngopi terus (b-roll), lampu/jam versi tanpa tekanan tengah (hook bagus, body datar).

## 9. Alur
INSIGHT → BUTTON → SPIKE → HOOK → FRICTION → scene cards → dialog → cek bridging (≥2) → gate 12 baris → cek pemicu → prompt → frame → render → gate klip → skor dengan benchmark bernama (iklan berbayar kategori sama yang sedang tayang).
