import { AVATAR_PRESETS } from "./lib/avatar-presets";
import { paketCastRefTersimpan, kunciCastRef } from "./lib/media/cast-ref";
import { qcF1FrameFidelity } from "./lib/media/qc-frame";
import { config } from "./lib/config";
import fs from "node:fs";
const foto = "/Users/hadrava/HDRV/03_UGC_AI_ID/glad2glow_watsons.png";
// Arm kontrol: tanpa merek terkonfirmasi (keadaan produksi sebelum C9).
for (let i = 1; i <= 3; i++) {
  const t = await qcF1FrameFidelity({ framePath: foto, productPhotoPath: foto, productName: "Glad2Glow Pore Serum", merekEksplisit: null, productState: "hero" });
  console.log(`TANPA merek (coba ${i}):`, t.status, "|", t.detail.slice(0, 120));
  if (!/HTTP 503/.test(t.detail)) break;
  await new Promise((r) => setTimeout(r, 20000));
}
const avatar = AVATAR_PRESETS.find((a) => a.id === "kirana-aulia") ?? AVATAR_PRESETS[0];
const kunci = kunciCastRef({ presetId: avatar.id, customDesc: null });
for (let i = 1; i <= 8; i++) {
  try {
    const paket = await paketCastRefTersimpan(kunci, avatar.desc, config.storageDir);
    console.log("CAST-REF OK avatar=", avatar.id, JSON.stringify(paket));
    for (const p of [paket.netral, paket.tigaPerempat, paket.closeUp])
      console.log(" ", p, fs.existsSync(p) ? `${fs.statSync(p).size} bytes` : "MISSING");
    process.exit(0);
  } catch (e) {
    console.log(`CAST-REF percobaan ${i} gagal:`, (e as Error).message.slice(0, 90));
    await new Promise((r) => setTimeout(r, 45000));
  }
}
process.exit(2);
