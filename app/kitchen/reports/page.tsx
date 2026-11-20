import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import {
  getExtraRevenueReport,
  getMealConsumptionReport,
} from "@/lib/reports";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reports | Messline",
};

function formatUtcDate(val: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val.trim());
  if (!match) return new Date();
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return new Date(Date.UTC(y, m - 1, d));
}

function toInputDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { type?: string; start?: string; end?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== Role.KITCHEN && user.role !== Role.SECRETARY) {
    redirect("/");
  }

  const now = new Date();
  const defaultStartDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7));
  const defaultEndDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  const startStr = searchParams.start || toInputDate(defaultStartDate);
  const endStr = searchParams.end || toInputDate(defaultEndDate);
  const reportType = searchParams.type === "revenue" ? "revenue" : "consumption";

  const startDate = formatUtcDate(startStr);
  const endDate = formatUtcDate(endStr);

  const consumptionData =
    reportType === "consumption"
      ? await getMealConsumptionReport(startDate, endDate)
      : null;

  const revenueData =
    reportType === "revenue"
      ? await getExtraRevenueReport(startDate, endDate)
      : null;

  const exportUrl = `/api/kitchen/export?type=${reportType}&start=${startStr}&end=${endStr}`;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Reports & Exports</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Audit meal attendance, kitchen food wastage, and extra dish revenue.
          </p>
        </div>
        <div>
          <a
            href={exportUrl}
            download
            className="inline-flex items-center justify-center rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Download CSV
          </a>
        </div>
      </div>

      <div className="mt-6 rounded border border-neutral-200 bg-white p-4 shadow-sm">
        <form method="GET" className="flex flex-wrap items-end gap-4 text-sm">
          <div>
            <label htmlFor="report-type" className="block text-xs font-medium text-neutral-700">
              Report Type
            </label>
            <select
              id="report-type"
              name="type"
              defaultValue={reportType}
              className="mt-1 block rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none"
            >
              <option value="consumption">Meal Consumption & Wastage</option>
              <option value="revenue">Extra Dish Revenue</option>
            </select>
          </div>

          <div>
            <label htmlFor="report-start" className="block text-xs font-medium text-neutral-700">
              Start Date
            </label>
            <input
              id="report-start"
              type="date"
              name="start"
              defaultValue={startStr}
              className="mt-1 block rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="report-end" className="block text-xs font-medium text-neutral-700">
              End Date
            </label>
            <input
              id="report-end"
              type="date"
              name="end"
              defaultValue={endStr}
              className="mt-1 block rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="rounded border border-neutral-300 bg-neutral-50 px-4 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Filter
          </button>
        </form>
      </div>

      {/* KPI Cards */}
      {consumptionData && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Total Plates Cooked</p>
            <p className="mt-1 text-2xl font-semibold text-neutral-900">{consumptionData.totals.cooked}</p>
          </div>
          <div className="rounded border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Total Served</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-700">{consumptionData.totals.served}</p>
          </div>
          <div className="rounded border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Total Wasted (No-Show + Late Cancel)</p>
            <p className="mt-1 text-2xl font-semibold text-red-700">{consumptionData.totals.wasted}</p>
          </div>
        </div>
      )}

      {revenueData && (
        <div className="mt-6">
          <div className="rounded border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Total Extra Dish Revenue</p>
            <p className="mt-1 text-2xl font-semibold text-neutral-900">₹{revenueData.totalRevenue}</p>
          </div>
        </div>
      )}

      {/* Preview Table */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-neutral-900">Report Preview</h2>

        {consumptionData && (
          consumptionData.rows.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">No meal records found for the selected dates.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded border border-neutral-200 bg-white shadow-sm">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-600">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Meal</th>
                    <th className="py-2.5 px-3">Dish</th>
                    <th className="py-2.5 px-3">Cooked</th>
                    <th className="py-2.5 px-3">Served</th>
                    <th className="py-2.5 px-3">No-Show</th>
                    <th className="py-2.5 px-3">Wasted</th>
                    <th className="py-2.5 px-3">Wastage %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {consumptionData.rows.map((row, idx) => (
                    <tr key={`${row.date}-${row.meal}-${row.dishName}-${idx}`} className="hover:bg-neutral-50">
                      <td className="py-2.5 px-3 whitespace-nowrap">{row.date}</td>
                      <td className="py-2.5 px-3 capitalize">{row.meal.toLowerCase()}</td>
                      <td className="py-2.5 px-3 font-medium text-neutral-900">{row.dishName}</td>
                      <td className="py-2.5 px-3">{row.totalCooked}</td>
                      <td className="py-2.5 px-3 text-emerald-700">{row.served}</td>
                      <td className="py-2.5 px-3 text-neutral-600">{row.noShow}</td>
                      <td className="py-2.5 px-3 text-red-600 font-medium">{row.wastageCount}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                            row.wastagePercent > 20
                              ? "bg-red-50 text-red-700"
                              : row.wastagePercent > 0
                              ? "bg-amber-50 text-amber-800"
                              : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {row.wastagePercent}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {revenueData && (
          revenueData.rows.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">No extra dish sales found for the selected dates.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded border border-neutral-200 bg-white shadow-sm">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-600">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Meal</th>
                    <th className="py-2.5 px-3">Dish</th>
                    <th className="py-2.5 px-3">Price</th>
                    <th className="py-2.5 px-3">Total Sold</th>
                    <th className="py-2.5 px-3">Served</th>
                    <th className="py-2.5 px-3">Total Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {revenueData.rows.map((row, idx) => (
                    <tr key={`${row.date}-${row.meal}-${row.dishName}-${idx}`} className="hover:bg-neutral-50">
                      <td className="py-2.5 px-3 whitespace-nowrap">{row.date}</td>
                      <td className="py-2.5 px-3 capitalize">{row.meal.toLowerCase()}</td>
                      <td className="py-2.5 px-3 font-medium text-neutral-900">{row.dishName}</td>
                      <td className="py-2.5 px-3">₹{row.priceRupees}</td>
                      <td className="py-2.5 px-3">{row.totalSold}</td>
                      <td className="py-2.5 px-3 text-emerald-700">{row.servedCount}</td>
                      <td className="py-2.5 px-3 font-semibold text-neutral-900">₹{row.totalRevenueRupees}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </main>
  );
}
