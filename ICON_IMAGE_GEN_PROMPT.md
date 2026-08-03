# Prompt Image-Gen — Ikon App BikinFYP AI

Siap tempel ke Midjourney/DALL-E/tool image-gen lain manapun. Berdasarkan Konsep G (rekomendasi) — bisa diedit bagian warna/gaya kalau mau coba varian lain.

## Prompt utama

```
App icon logo design, bold 3D letters spelling "FYP", heavy condensed sans-serif typography,
slightly italic forward-leaning slant, dynamic glitch double-exposure shadow effect behind the
main letters (a slightly offset duplicate in a darker warm amber tone, like a fast-motion or
VHS glitch trail), the letters filled with a warm amber-to-orange gradient (bright golden
yellow #fbbf24 at top-left fading to deep amber-orange #d97706 at bottom-right), dark charcoal
outline or dark ink background (#18181b) for high contrast, flat vector illustration style,
clean sticker/app-icon aesthetic, NOT photorealistic, NOT 3D render, no drop shadow beyond the
described glitch offset, no extra text or taglines, no other graphic elements, no background
scene or photograph, single centered lettermark only, generous even padding on all four sides
(subject fills about 70% of the frame, safe margin for app icon corner masking), perfectly
square 1:1 aspect ratio, high resolution, crisp clean edges, bold and legible even at very
small sizes (app icon on a phone home screen), energetic and youthful TikTok-native creator
tool branding, professional app icon design, not clip art, not stock icon
```

## Negative prompt (kalau tool-nya punya field terpisah)
```
photo, realistic, 3d render, human face, hands, background scene, texture, noise, grain,
extra text, watermark, signature, multiple objects, busy composition, low contrast, blurry,
gradient banding, drop shadow, bevel, emboss, clip art, stock icon, generic
```

## Spesifikasi teknis yang wajib diperhatikan
- **Rasio**: 1:1 (persegi) — wajib, app icon selalu persegi
- **Resolusi**: minimal 1024×1024 px (biar bisa di-scale ke semua ukuran icon Android/iOS tanpa pecah)
- **Format akhir**: PNG dengan background solid (bukan transparent) untuk versi utama — kalau tool-nya bisa generate versi transparent juga, ambil sekalian, lebih fleksibel buat di-edit nanti
- **Safe zone**: jangan sampai hurufnya mepet ke tepi — Android bakal motong ikon jadi bentuk bulat/rounded-square otomatis (adaptive icon), jadi konten penting harus di ~70% tengah, bukan nyampe pinggir

## Kalau mau coba varian lain (tinggal ganti bagian ini di prompt)
- **Konsep H (background gelap, kontras tinggi)**: ganti `dark charcoal outline or dark ink background` jadi `dark charcoal/near-black background (#18181b), the letters glowing in amber gradient, subtle amber underline bar beneath the letters`
- **Konsep I (gaya bubble/sticker ceria)**: ganti bagian gradient jadi `cream-white letters (#fff8e8) with thick dark outline, sticker/badge style, playful rounded bold typography, warm amber-to-orange gradient background`

## Setelah dapat hasil yang bagus
Kirim ke saya file PNG-nya (resolusi paling tinggi yang ada) — saya yang urus generate semua ukuran icon Android (48/72/96/144/192/512px + adaptive icon layers) dan iOS, plus pasang manifest.json dan file verifikasi buat TWA-nya.
