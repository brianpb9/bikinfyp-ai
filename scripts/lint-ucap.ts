// Laporan kata rawan salah ucap di seluruh naskah katalog.
//
// Dipisahkan dari tes karena dua alasan: temuan "disimpulkan" tidak boleh
// menggagalkan CI, dan pola "-nya di" ternyata bentuk baku CTA afiliasi kita —
// memperbaikinya adalah keputusan produk, bukan perbaikan mekanis.
import { temuanSalahUcap } from "../lib/script-engine/kamus-ucap";
import { TEMPLATE_COPY, TEMPLATE_COPY_CAPACITY } from "../lib/script-engine/template-copy";
import { REGISTERS } from "../lib/script-engine/registers";

const ctx: any = { reg: REGISTERS.bestie, harga: "85 ribu", produk: "Serum Wardah", noun: "skincare",
  pain: "kusamnya", proof: "teksturnya", space: "Meja rias", aktivitas: "skincare-an malem", identitas: "tim glowing" };

let teramati = 0, disimpulkan = 0;
const perTemplate = new Map<string, number>();
for (const [id, varian] of Object.entries(TEMPLATE_COPY)) {
  for (let i = 0; i < TEMPLATE_COPY_CAPACITY; i++) {
    const c = varian[i](ctx);
    for (const t of temuanSalahUcap(`${c.hook} ${c.demo} ${c.cta}`)) {
      if (t.keyakinan === "teramati") { teramati++; perTemplate.set(id, (perTemplate.get(id) ?? 0) + 1); }
      else disimpulkan++;
    }
  }
}
console.log(`teramati:    ${teramati}`);
console.log(`disimpulkan: ${disimpulkan}`);
console.log(`template terdampak: ${perTemplate.size} dari ${Object.keys(TEMPLATE_COPY).length}`);
