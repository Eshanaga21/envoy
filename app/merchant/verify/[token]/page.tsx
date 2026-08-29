import { MerchantVerificationCard } from "@/components/merchant-verification-card";
import { getMerchantVerification } from "@/lib/db";

export default async function MerchantVerificationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await getMerchantVerification(token);
  if (!result) return <main className="grid min-h-screen place-items-center bg-slate-50 p-5"><p className="rounded-xl bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">This verification link is invalid or has expired.</p></main>;
  return <MerchantVerificationCard {...result} />;
}
