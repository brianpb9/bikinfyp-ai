/*
 * Service worker AIUGC.ID — sekadar cukup untuk jadi aplikasi, tidak lebih.
 *
 * ---------------------------------------------------------------------------
 * KENAPA SEDIKIT SEKALI YANG DI-CACHE
 * ---------------------------------------------------------------------------
 * Aplikasi ini menampilkan SALDO TOKEN, STATUS JOB, dan HARGA. Semua itu
 * berubah, dan menyajikan versi basi bukan sekadar tidak enak dilihat — orang
 * akan menekan Generate dengan keyakinan yang salah tentang saldonya, atau
 * mengira videonya masih diproses padahal sudah jadi (atau sebaliknya).
 *
 * Jadi aturannya keras:
 *   - /api/**            TIDAK PERNAH disentuh service worker. Lewat begitu saja.
 *   - navigasi halaman   jaringan dulu; cache hanya dipakai saat benar-benar
 *                        offline, dan yang keluar adalah halaman offline yang
 *                        JUJUR, bukan halaman lama yang tampak hidup.
 *   - /_next/static/**   cache selamanya — nama berkasnya sudah memuat hash
 *                        isinya, jadi berkas dengan nama sama mustahil berbeda.
 *   - ikon & manifest    cache, boleh basi sebentar, tidak ada ruginya.
 *
 * ---------------------------------------------------------------------------
 * KENAPA NAVIGASI TIDAK BOLEH CACHE-FIRST
 * ---------------------------------------------------------------------------
 * Deploy di sini blue/green dan sering. HTML yang di-cache menunjuk ke bundel
 * JS versi lama; sesudah deploy, bundel itu hilang dan aplikasinya membuka
 * layar putih tanpa satu pesan pun. Kegagalan diam yang paling mahal, karena
 * yang mengalaminya cuma pengguna yang PERNAH membuka aplikasi — justru
 * pelanggan yang sudah membayar.
 */

const VERSI = "aiugc-v1";
const STATIS = `${VERSI}-statis`;
const HALAMAN_OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(STATIS)
      .then((c) => c.addAll([HALAMAN_OFFLINE, "/manifest.json", "/icons/icon-192.png"]))
      // Gagal menyiapkan cache TIDAK boleh menggagalkan pemasangan: aplikasinya
      // tetap jalan tanpa service worker, dan itu jauh lebih baik daripada
      // worker yang gagal pasang berulang kali.
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((k) => Promise.all(k.filter((n) => !n.startsWith(VERSI)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Lintas-asal dan API dilewati SEPENUHNYA — termasuk tidak dicatat.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Aset ber-hash: aman di-cache selamanya, namanya memuat hash isinya.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(request).then((hit) =>
        hit ?? fetch(request).then((res) => {
          if (res.ok) { const salin = res.clone(); caches.open(STATIS).then((c) => c.put(request, salin)); }
          return res;
        })
      )
    );
    return;
  }

  // Ikon & manifest: cache, perbarui di latar.
  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.json") {
    e.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
    return;
  }

  // Navigasi: JARINGAN DULU. Lihat catatan blue/green di atas.
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request).catch(() =>
        caches.match(HALAMAN_OFFLINE).then((hit) =>
          hit ?? new Response("Kamu sedang offline.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } })
        )
      )
    );
  }
});
