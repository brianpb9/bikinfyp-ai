/** Template ini bergantung pada bukti perubahan/hasil yang tidak boleh dibuat
 * dari footage sintetis. Hanya rekaman asli yang terverifikasi yang sah. */
export const AI_RENDER_BLOCKED_TEMPLATE_IDS = [
  "before-after",
  "t05-before-after",
  "t08-day-1-vs-day-7",
  "t10-bukti-di-lengan",
] as const;

export function aiRenderBlockMessage(templateId: string | null | undefined): string | null {
  if (!templateId || !(AI_RENDER_BLOCKED_TEMPLATE_IDS as readonly string[]).includes(templateId)) return null;
  return "Template ini membutuhkan footage asli yang terverifikasi untuk membuktikan perubahan atau hasil. Render AI diblokir agar tidak membuat bukti produk sintetis.";
}
