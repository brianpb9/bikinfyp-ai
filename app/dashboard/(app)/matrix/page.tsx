import { notFound } from "next/navigation";
import { config } from "@/lib/config";
import MatrixClient from "./MatrixClient";

export const dynamic = "force-dynamic";

// Gerbang fitur di sisi SERVER, bukan sekadar menyembunyikan tautan di sidebar.
// Halaman yang masih bisa dibuka lewat URL langsung tetap halaman yang hidup.
// Alasan penahanannya ada di lib/config.ts (enterpriseMatrixEnabled).
export default function MatrixPage() {
  if (!config.enterpriseMatrixEnabled) notFound();
  return <MatrixClient />;
}
