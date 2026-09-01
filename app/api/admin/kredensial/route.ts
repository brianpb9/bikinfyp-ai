import { wajibAdminApi } from "@/lib/admin-auth";
import { ERR, errorResponse } from "@/lib/errors";
import { simpanKredensial, hapusKredensial, kredensialDikenal } from "@/lib/kredensial";
import { pgAudit, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    return Response.json({ ok: true, name, aksi: meta.aksi });
  } catch (err) {
    return errorResponse(err);
  }
}
