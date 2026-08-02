# QC Acceptance Policy

Setiap panggilan `runQc` membuat `qc_result` baru dengan `checked_at` baru dan
worker menyimpannya sebelum memutuskan retry/finalisasi. Hasil QC dari render
atau retry sebelumnya tidak boleh digunakan ulang.

## `hands_only` (satu-satunya format render yang didukung saat ini)

| Check | Status yang diterima | Ketentuan |
|---|---|---|
| QC-01 lip-sync | `skip` saja | N/A karena format ini tidak menampilkan pembicara. |
| QC-02 tangan/jari | `pass` | Detektor gagal atau anomali adalah `fail`. |
| QC-03 identitas produk | `pass` | Dua shot dan referensi produk wajib tersedia; input/detektor yang tidak cukup adalah `skip` dan menolak output. |
| QC-04 audio | `pass` | Audio tidak boleh senyap. |
| QC-05 durasi | `pass` | Harus dalam toleransi yang ditetapkan. |
| QC-06 overlay | `pass` | Ekspektasi overlay bertimeline wajib tersedia dan OCR harus membuktikan tidak terpotong/bertumpuk. Ketidakpastian OCR adalah `skip` dan menolak output. |
| QC-07 compliance teks | `pass` | Tidak ada kata terlarang. |
| QC-08 label AIGC | `pass` | Parameter, metadata, dan stream video harus valid. |
| QC-09 tanpa wajah | `pass` | Shot wajib tersedia; detektor gagal adalah `fail`. |

`skip` tidak pernah dihitung sebagai `pass`. Satu-satunya `skip` yang diizinkan
adalah QC-01 pada `hands_only`; status apa pun selain `pass` untuk check wajib,
check wajib yang hilang, atau format tanpa kebijakan eksplisit membuat `passed`
bernilai `false`. Format baru harus menambah kebijakan serta pengujian sebelum
boleh diproses production.
