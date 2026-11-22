import Link from "next/link";
import { redirect } from "next/navigation";
import { RebateStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getRebatePolicy, getRebateStatement } from "@/lib/rebates";
import { rupees, statementMonth } from "@/lib/rebate-policy";
import { decideRebates, saveRebatePolicy } from "@/app/rebate-actions";
import { PrintButton } from "./PrintButton";
export const dynamic = "force-dynamic";
export default async function SecretaryRebates({
  searchParams,
}: {
  searchParams: {
    month?: string;
    status?: string;
    error?: string;
    completed?: string;
    failed?: string;
    policySaved?: string;
  };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SECRETARY") redirect("/");
  let month: string;
  try {
    month = statementMonth(searchParams.month).month;
  } catch {
    month = statementMonth(undefined).month;
  }
  const status = Object.values(RebateStatus).includes(
    searchParams.status as RebateStatus,
  )
    ? (searchParams.status as RebateStatus)
    : undefined;
  const [policy, requests, statement] = await Promise.all([
    getRebatePolicy(),
    prisma.absenceRebate.findMany({
      where: status ? { status } : {},
      include: { student: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    getRebateStatement(user.id, month),
  ]);
  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Absence rebate review</h1>
      <p>
        Single mess · amounts in INR · approval records eligibility; settlement
        posts credit after the absence ends. No payments are sent.
      </p>
      {searchParams.error && (
        <p role="alert" className="text-red-700">
          {searchParams.error}
        </p>
      )}
      {searchParams.completed && (
        <p role="status">
          Completed {searchParams.completed}; failed {searchParams.failed ?? 0}.
          Reloaded totals reflect committed operations only.
        </p>
      )}
      {searchParams.policySaved && (
        <p role="status">Policy saved for new applications.</p>
      )}
      <details className="print:hidden border rounded p-4">
        <summary>Configure policy (v{policy.version})</summary>
        <form action={saveRebatePolicy} className="space-y-3 mt-3">
          <input type="hidden" name="version" value={policy.version} />
          {(
            [
              {
                key: "minimumDays",
                label: "Minimum consecutive days",
                min: 1,
                max: 31,
              },
              {
                key: "noticeHours",
                label: "Notice hours before midnight IST",
                min: 0,
                max: 720,
              },
              {
                key: "breakfastPaise",
                label: "Breakfast rate (paise)",
                min: 0,
                max: 100000,
              },
              {
                key: "lunchPaise",
                label: "Lunch rate (paise)",
                min: 0,
                max: 100000,
              },
              {
                key: "dinnerPaise",
                label: "Dinner rate (paise)",
                min: 0,
                max: 100000,
              },
            ] as const
          ).map((f) => (
            <label key={f.key} className="block">
              {f.label}
              <input
                className="ml-2 border p-1"
                type="number"
                step="1"
                name={f.key}
                min={f.min}
                max={f.max}
                defaultValue={policy[f.key]}
                required
              />
            </label>
          ))}
          <p>
            100 paise = ₹1. Existing applications retain their submitted policy
            version.
          </p>
          <button className="border rounded px-3 py-2">Save policy</button>
        </form>
      </details>
      <form method="get" className="flex flex-wrap gap-3 print:hidden">
        <label>
          Status{" "}
          <select
            name="status"
            defaultValue={status ?? ""}
            className="border p-2"
          >
            <option value="">All</option>
            {Object.values(RebateStatus).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Statement month{" "}
          <input
            type="month"
            name="month"
            defaultValue={month}
            className="border p-2"
          />
        </label>
        <button className="border px-3">Filter</button>
      </form>
      <section className="print:hidden">
        <h2 className="font-semibold">Latest 100 applications</h2>
        <form action={decideRebates} className="space-y-3">
          {requests.map((r) => (
            <label className="block border rounded p-3" key={r.id}>
              <input
                type="checkbox"
                name="ids"
                value={r.id}
                className="mr-2"
                disabled={r.status === "REJECTED" || r.status === "SETTLED"}
              />
              {r.student.name} · {r.startDate.toISOString().slice(0, 10)} —{" "}
              {r.endDate.toISOString().slice(0, 10)} · {r.status} · estimate{" "}
              {rupees(r.estimatedPaise)}
              <span className="block text-sm">{r.reason}</span>
            </label>
          ))}
          <label className="block">
            Decision reason (required for approve/reject)
            <textarea
              name="reason"
              maxLength={500}
              className="block border p-2 w-full"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button name="decision" value="APPROVED" className="border p-2">
              Approve selected
            </button>
            <button name="decision" value="REJECTED" className="border p-2">
              Reject selected
            </button>
            <button name="decision" value="SETTLED" className="border p-2">
              Settle selected
            </button>
          </div>
          <p>
            Up to 50 selections; failures remain visible and do not produce
            credit.
          </p>
        </form>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">
          Settlement statement · {month} (IST)
        </h2>
        <p>
          Single mess total posted credit:{" "}
          <strong>{rupees(statement.totalPaise)}</strong> ·{" "}
          {statement.entries.length} ledger entries
        </p>
        <p className="text-sm">
          The current account schema has no hostel-wing field; this statement
          reports the single mess rather than inventing wing groups.
        </p>
        <div className="flex gap-3 print:hidden">
          <Link
            href={`/secretary/rebates/statement?month=${month}`}
            className="border rounded px-3 py-2"
          >
            Download CSV
          </Link>
          <PrintButton />
        </div>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Monthly settled absence credits</caption>
          <thead>
            <tr>
              <th>Student</th>
              <th>Absence</th>
              <th>Credit</th>
              <th>Posted (IST)</th>
            </tr>
          </thead>
          <tbody>
            {statement.entries.map((e) => (
              <tr key={e.id} className="border-t">
                <td>{e.student.name}</td>
                <td>
                  {e.rebate.startDate.toISOString().slice(0, 10)} —{" "}
                  {e.rebate.endDate.toISOString().slice(0, 10)}
                </td>
                <td>{rupees(e.amountPaise)}</td>
                <td>
                  {e.createdAt.toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
