# Content types — what each one locks

| Field | AI UGC Affiliate | AI UGC Ads |
|---|---|---|
| Distribution | organic TikTok Shop / Shopee / Reels by an affiliate creator | paid ad (TikTok Ads, Meta) in UGC style |
| CTA line | **spoken**, must contain "keranjang kuning" (Shopee: "keranjang oren"; other: "keranjang"). Ex: "Udah, ganti aja. Linknya di keranjang kuning ya." | **spoken**, "Detailnya ada di bawah ya" (the buffer word "ada" is required — "-nya di" alone is mispronounced by TTS) |
| On-screen text | allowed but **default OFF**; user must enable; ≤ 9 words; subtitle-like; never prices, CTA cards, or claims | **forbidden** — omit the line entirely |
| Price in dialogue | allowed, written as words ("delapan belas ribu"), never digits | not allowed unless user insists; words only |
| Music | "no music" default for talking-head; allowed for no-face/mechanism formats; attach at upload via TikTok Commercial Music Library, do not describe in prompt | "no music" in prompt; music (if any) attached at upload; never mixed into the described video |
| Claims | standard: no medical/whitening/instant, no numbers except price | strict: only what is visible in frame or clearly subjective ("aku suka", "ringan banget buat ukuran segini"); no hours/watt/RPM/gram, no "tahan seharian", no "mirip brand X" |
| Caption | full caption + up to 8 hashtags | short caption, no hashtag spam, no "keranjang kuning" |
| Hook allowed to mention product | only in H4/H11-style formats (trend/after-routine); default: product not named in hook | same |

Why: text overlay and music are the two fastest tells that a video was assembled, and the whole value of UGC is "this is a real person talking". Playbook videos with overlay/caption cards were rejected.
