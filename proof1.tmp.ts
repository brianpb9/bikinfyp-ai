import { AVATAR_PRESETS } from "./lib/avatar-presets";
import { paketCastRefTersimpan, kunciCastRef } from "./lib/media/cast-ref";
import { qcF1FrameFidelity, bolehJadiReferensi } from "./lib/media/qc-frame";
import { config } from "./lib/config";
import fs from "node:fs";

const foto = "/Users/hadrava/HDRV/glad2glow_watsons.png";
const hasil = await qcF1FrameFidelity({
  framePath: foto, productPhotoPath: foto,
  productName: "Glad2Glow Pore Serum", merekEksplisit: "Glad2Glow", productState: "hero",
});
console.log("QC-F1:", JSON.stringify(hasil));
console.log("bolehJadiReferensi:", bolehJadiReferensi(hasil));

const avatar = AVATAR_PRESETS.find((a) => a.id === "kirana-aulia") ?? AVATAR_PRESETS[0];
const kunci = kunciCastRef({ presetId: avatar.id, customDesc: null });
for (let i = 1; i <= 4; i++) {
  try {
    const paket = await paketCastRefTersimpan(kunci, avatar.desc, config.storageDir);
    console.log("CAST-REF OK:", JSON.stringify(paket));
    for (const p of [paket.netral, paket.tigaPerempat, paket.closeUp])
      console.log(" ", p, fs.existsSync(p) ? `${fs.statSync(p).size} bytes` : "MISSING");
    break;
  } catch (e) {
    console.log(`CAST-REF percobaan ${i} gagal:`, (e as Error).message.slice(0, 100));
    if (i === 4) process.exit(2);
    await new Promise((r) => setTimeout(r, 25000));
  }
}
