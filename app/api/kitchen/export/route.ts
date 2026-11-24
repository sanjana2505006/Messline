import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import {
  buildCSV,
  getExtraRevenueReport,
  getMealConsumptionReport,
  toInputDate,
} from "@/lib/reports";

export const dynamic = "force-dynamic";

function parseDate(val: string | null, fallback: Date): Date {
  if (!val) return fallback;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val.trim());
  if (!match) return fallback;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  return isNaN(date.getTime()) ? fallback : date;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || (user.role !== Role.KITCHEN && user.role !== Role.SECRETARY)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const reportType = searchParams.get("type") === "revenue" ? "revenue" : "consumption";

  const now = new Date();
  const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7));
  const defaultEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  const startDate = parseDate(searchParams.get("start"), defaultStart);
  const endDate = parseDate(searchParams.get("end"), defaultEnd);

  if (reportType === "revenue") {
    const { rows } = await getExtraRevenueReport(startDate, endDate);
    const headers = [
      "Date",
      "Meal",
      "Dish",
      "Price (INR)",
      "Total Sold",
      "Served Count",
      "No-Show Count",
      "Total Revenue (INR)",
      "Served Revenue (INR)",
      "No-Show Revenue (INR)",
    ];
    const data = rows.map((r) => [
      r.date,
      r.meal,
      r.dishName,
      r.priceRupees,
      r.totalSold,
      r.servedCount,
      r.noShowCount,
      r.totalRevenueRupees,
      r.servedRevenueRupees,
      r.noShowRevenueRupees,
    ]);
    const csv = buildCSV(headers, data);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="messline-extra-revenue-${toInputDate(startDate)}.csv"`,
      },
    });
  } else {
    const { rows } = await getMealConsumptionReport(startDate, endDate);
    const headers = [
      "Date",
      "Meal",
      "Dish",
      "Type",
      "Price (INR)",
      "Capacity",
      "Unbooked Left",
      "Total Cooked",
      "Served",
      "No-Show",
      "Cancelled (Pre-Cutoff)",
      "Cancelled (Post-Cutoff)",
      "Wasted Plates",
      "Wastage %",
    ];
    const data = rows.map((r) => [
      r.date,
      r.meal,
      r.dishName,
      r.included ? "Included" : "Extra",
      r.priceRupees ?? "",
      r.quantityTotal,
      r.quantityLeft,
      r.totalCooked,
      r.served,
      r.noShow,
      r.cancelledPreCutoff,
      r.cancelledPostCutoff,
      r.wastageCount,
      `${r.wastagePercent}%`,
    ]);
    const csv = buildCSV(headers, data);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="messline-meal-consumption-${toInputDate(startDate)}.csv"`,
      },
    });
  }
}
