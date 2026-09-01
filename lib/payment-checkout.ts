import { TOPUP_PACKAGES } from "./credits";
import { ERR } from "./errors";

export type CheckoutUser = { id: string; phone?: string | null; email?: string | null };
export type CheckoutDeps = {
  newOrderId: (userId: string) => string;
  persistPending: (input: { userId: string; orderId: string; packageId: string; amountIdr: number }) => Promise<void>;
  // Netral-provider: Duitku mengembalikan reference, Midtrans (rollback)
  // mengembalikan snap token — dua-duanya cuma "ref provider + URL bayar"
  // bagi alur checkout.
  createPayment: (input: {
    orderId: string;
    packageId: string;
    phone: string;
    email: string;
    /** Kanal yang dipilih pembeli (QRIS / VA). Kosong = jalur POP lama. */
    method?: string;
  }) => Promise<{ providerRef: string; redirectUrl: string; vaNumber?: string; qrString?: string }>;
  markInitiationFailed: (orderId: string, failure: Record<string, unknown>) => Promise<void>;
};

const errorPayload = (error: unknown) => ({
  failed_at: new Date().toISOString(),
  // Provider errors are retained for reconciliation, but never include credentials.
  error: error instanceof Error ? error.message.slice(0, 500) : "unknown provider initiation error",
});

/** Durable checkout: the pending order commits before any external provider request. */
export async function initiateCheckout(
  user: CheckoutUser,
  packageId: string,
  deps: CheckoutDeps,
  method?: string,
) {
  const pkg = TOPUP_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) throw ERR.BAD_REQUEST("Paketnya nggak ketemu. Coba pilih paket lain ya.", "Unknown package.");
  const orderId = deps.newOrderId(user.id);
  await deps.persistPending({ userId: user.id, orderId, packageId, amountIdr: pkg.priceIdr });
  try {
    const hasil = await deps.createPayment({
      orderId,
      packageId,
      phone: user.phone ?? "",
      email: user.email ?? "",
      method,
    });
    return { orderId, ...hasil };
  } catch (error) {
    await deps.markInitiationFailed(orderId, errorPayload(error));
    throw error;
  }
}
