import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getRebatePolicy } from "@/lib/rebates";
import { rupees } from "@/lib/rebate-policy";
import { submitRebate } from "@/app/rebate-actions";
export const dynamic = "force-dynamic";
export default async function StudentRebates({
  searchParams,
}: {
  searchParams: { error?: string; saved?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "STUDENT") redirect("/");
  const [policy, requests, credits] = await Promise.all([
    getRebatePolicy(),
    prisma.absenceRebate.findMany({
      where: { studentId: user.id },
      include: { ledger: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.rebateLedger.aggregate({
      where: { studentId: user.id },
      _sum: { amountPaise: true },
    }),
  ]);
  const daily = policy.breakfastPaise + policy.lunchPaise + policy.dinnerPaise;
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Absence rebates</h1>
      <p>
        Total posted credit:{" "}
        <strong>{rupees(credits._sum.amountPaise ?? 0)}</strong>. This is a mess
        credit ledger, not a payment or withdrawal balance.
      </p>
      <p>
        Policy v{policy.version}: {policy.minimumDays}–31 consecutive days, at
        least {policy.noticeHours} hours notice before midnight IST. Daily
        maximum {rupees(daily)}. Consumed or late-cancelled included meals are
        excluded at settlement; extras do not earn credit. Existing bookings
        must be cancelled separately.
      </p>
      {searchParams.error && (
        <p role="alert" className="text-red-700">
          {searchParams.error}
        </p>
      )}
      {searchParams.saved && (
        <p role="status">Application submitted for review.</p>
      )}
      <form action={submitRebate} className="border rounded p-4 space-y-4">
        <h2 className="font-semibold">Apply for absence credit</h2>
        <label className="block">
          First absent day (IST)
          <input
            className="block border p-2"
            type="date"
            name="start"
            required
          />
        </label>
        <label className="block">
          Last absent day (IST)
          <input className="block border p-2" type="date" name="end" required />
        </label>
        <label className="block">
          Reason
          <textarea
            className="block w-full border p-2"
            name="reason"
            minLength={3}
            maxLength={500}
            required
          />
        </label>
        <button
          className="rounded bg-neutral-900 text-white px-4 py-2"
          disabled={!daily}
        >
          Submit application
        </button>
        {!daily && (
          <p>The secretary must configure rates before applications open.</p>
        )}
      </form>
      <h2 className="font-semibold">Latest 100 applications</h2>
      <ul className="space-y-3">
        {requests.map((r) => (
          <li className="border rounded p-4" key={r.id}>
            <p>
              {r.startDate.toISOString().slice(0, 10)} —{" "}
              {r.endDate.toISOString().slice(0, 10)} · {r.status}
            </p>
            <p>{r.reason}</p>
            <p>
              Estimate {rupees(r.estimatedPaise)} · Posted{" "}
              {r.ledger ? rupees(r.ledger.amountPaise) : "Not settled"}
            </p>
            {r.decisionReason && <p>Decision: {r.decisionReason}</p>}
          </li>
        ))}
      </ul>
      {!requests.length && <p>No applications yet.</p>}
    </main>
  );
}
