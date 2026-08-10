import type { ReactNode } from "react";
import { requireOrgContext } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getOrgBalance } from "@/lib/org";
import { pgGetOrgBalance } from "@/lib/postgres/org";
import { DashboardChrome } from "../_components/DashboardChrome";

export const dynamic = "force-dynamic";

// Gerbang dashboard enterprise/brand (F-ENT-01). Node runtime Server
// Component — bukan Edge middleware, karena butuh query org_members lewat
// driver `pg` (lihat lib/dashboard-auth.ts). requireOrgContext() redirect
// sendiri kalau belum login / belum jadi anggota org manapun.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, membership } = await requireOrgContext();
  const balance = postgresRuntimeEnabled()
    ? await pgGetOrgBalance(membership.org_id)
    : getOrgBalance(membership.org_id);

  return (
    <DashboardChrome orgName={membership.org_name} balanceIdr={balance} userEmail={user.email}>
      {children}
    </DashboardChrome>
  );
}
