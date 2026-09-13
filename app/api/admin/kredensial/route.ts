import { wajibAdminApi } from "@/lib/admin-auth";
import { ERR, errorResponse } from "@/lib/errors";
import { simpanKredensial, hapusKredensial, kredensialDikenal, pastikanLingkunganDuitku } from "@/lib/kredensial";
import type { HasilDeteksi } from "@/lib/duitku-deteksi";
import { pgAudit, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kalimat untuk operator — tanpa kunci dalam bentuk apa pun. */
function ringkasDeteksi(hasil: HasilDeteksi | null): { status: string; pesan: string } {
  if (!hasil) return { status: "belum_lengkap", pesan: "Kode merchant atau API key Duitku masih kosong." };
  if (hasil.status === "dikenali") {
    return {
      status: "dikenali",
      pesan: `Dikenali Duitku sebagai ${hasil.lingkungan.toUpperCase()} — dipakai sekarang.`,
    };
  }
  if (hasil.status === "tidak_terjangkau") {
    return { status: hasil.status, pesan: `Duitku belum bisa dihubungi, lingkungan belum dipastikan (${hasil.alasan}).` };
  }
  return {
    status: hasil.status,
    pesan: "Belum dikenali Duitku di production maupun sandbox. Pastikan kode merchant dan API key-nya sepasang.",
  };
}

// POST /api/admin/kredensial {name, value} — ganti kredensial partner.
// DELETE-nya lewat {name, value: ""} supaya satu jalur saja yang perlu dijaga.
//
// SATU-SATUNYA JALUR TULIS DI SELURUH AREA ADMIN. Karena itu ia dijaga
// berlapis: gerbang admin, nama yang harus ada di daftar, dan audit yang
// mencatat SIAPA mengganti APA — tanpa pernah mencatat nilainya.
export async function POST(req: Request) {
  try {
    const admin = await wajibAdminApi(req);
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "");
    const value = String(body.value ?? "");

    if (!kredensialDikenal(name)) {
      throw ERR.BAD_REQUEST("Kredensial itu tidak dikelola dari halaman ini.", `Unknown credential: ${name}`);
    }

    if (value === "") {
      await hapusKredensial(name);
    } else {
      await simpanKredensial(name, value, admin.email ?? admin.id);
    }

    // NILAINYA TIDAK PERNAH MASUK AUDIT. Log audit dibaca lebih banyak orang
    // dan berpindah lebih jauh daripada database itu sendiri; menaruh kunci
    // partner di sana membatalkan seluruh gunanya menyimpannya terenkripsi.
    //
    // `aksi` dihitung LEBIH DULU supaya objek audit tidak menyebut `value`
    // sama sekali. Itu bukan gaya penulisan: selama objeknya masih memuat
    // kata itu — walau cuma dalam perbandingan — tidak ada asersi yang bisa
    // membedakan kebocoran dari perbandingan yang sah, dan penjagaannya jadi
    // tidak bisa diuji. Terbukti: mutasi yang menambahkan `value` ke audit
    // lolos dari versi pertama test.
    const aksi = value === "" ? "dikembalikan ke env" : "diganti";
    const meta = { name, aksi };
    if (postgresRuntimeEnabled()) await pgAudit(admin.id, "admin.kredensial", "runtime_secrets", name, meta);

    // Kode merchant atau API key Duitku berubah -> tanyakan lingkungannya ke
    // Duitku SEKARANG, supaya operator melihat hasilnya di layar yang sama —
    // bukan baru tahu dari checkout pembeli yang gagal.
    if (name === "DUITKU_MERCHANT_CODE" || name === "DUITKU_API_KEY") {
      const hasil = await pastikanLingkunganDuitku({ paksa: true });
      return Response.json({ ok: true, name, aksi: meta.aksi, duitku: ringkasDeteksi(hasil) });
    }

    return Response.json({ ok: true, name, aksi: meta.aksi });
  } catch (err) {
    return errorResponse(err);
  }
}
