import { BookingStatus } from "@prisma/client";
import { prisma } from "./db";

export type MealConsumptionRow = {
  date: string;
  meal: string;
  dishName: string;
  included: boolean;
  priceRupees: number | null;
  quantityTotal: number;
  quantityLeft: number;
  totalCooked: number;
  served: number;
  noShow: number;
  cancelledPreCutoff: number;
  cancelledPostCutoff: number;
  wastageCount: number;
  wastagePercent: number;
};

export type ExtraRevenueRow = {
  date: string;
  meal: string;
  dishName: string;
  priceRupees: number;
  totalSold: number;
  servedCount: number;
  noShowCount: number;
  totalRevenueRupees: number;
  servedRevenueRupees: number;
  noShowRevenueRupees: number;
};

export function toInputDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function calculateConsumptionMetrics(
  bookings: { count: number; status: BookingStatus; updatedAt: Date }[],
  cutoffAt: Date
) {
  let booked = 0;
  let served = 0;
  let noShow = 0;
  let cancelledPreCutoff = 0;
  let cancelledPostCutoff = 0;

  for (const b of bookings) {
    if (b.status === BookingStatus.BOOKED) booked += b.count;
    else if (b.status === BookingStatus.SERVED) served += b.count;
    else if (b.status === BookingStatus.NO_SHOW) noShow += b.count;
    else if (b.status === BookingStatus.CANCELLED) {
      if (b.updatedAt >= cutoffAt) {
        cancelledPostCutoff += b.count;
      } else {
        cancelledPreCutoff += b.count;
      }
    }
  }

  const totalCooked = booked + served + noShow + cancelledPostCutoff;
  const wastageCount = noShow + cancelledPostCutoff;
  const wastagePercent = totalCooked > 0 ? Math.round((wastageCount / totalCooked) * 100) : 0;

  return {
    booked,
    served,
    noShow,
    cancelledPreCutoff,
    cancelledPostCutoff,
    totalCooked,
    wastageCount,
    wastagePercent,
  };
}

export function calculateRevenueMetrics(
  bookings: { count: number; status: BookingStatus; updatedAt: Date }[],
  cutoffAt: Date,
  priceRupees: number
) {
  let servedCount = 0;
  let noShowCount = 0;
  let activeBookedCount = 0;
  let postCutoffCancelledCount = 0;

  for (const b of bookings) {
    if (b.status === BookingStatus.SERVED) servedCount += b.count;
    else if (b.status === BookingStatus.NO_SHOW) noShowCount += b.count;
    else if (b.status === BookingStatus.BOOKED) activeBookedCount += b.count;
    else if (b.status === BookingStatus.CANCELLED && b.updatedAt >= cutoffAt) {
      postCutoffCancelledCount += b.count;
    }
  }

  const totalSold = activeBookedCount + servedCount + noShowCount + postCutoffCancelledCount;
  const totalRevenueRupees = totalSold * priceRupees;
  const servedRevenueRupees = servedCount * priceRupees;
  const noShowRevenueRupees = (noShowCount + postCutoffCancelledCount) * priceRupees;

  return {
    totalSold,
    servedCount,
    noShowCount,
    totalRevenueRupees,
    servedRevenueRupees,
    noShowRevenueRupees,
  };
}

export function escapeCSVField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCSV(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const headerLine = headers.map(escapeCSVField).join(",");
  const dataLines = rows.map((row) => row.map(escapeCSVField).join(","));
  return [headerLine, ...dataLines].join("\n");
}

export async function getMealConsumptionReport(
  startDate: Date,
  endDate: Date
): Promise<{ rows: MealConsumptionRow[]; totals: { cooked: number; served: number; wasted: number } }> {
  const offerings = await prisma.offering.findMany({
    where: {
      service: {
        published: true,
        serviceDate: {
          gte: startDate,
          lte: endDate,
        },
      },
    },
    include: {
      menuItem: { select: { name: true, included: true, priceRupees: true } },
      service: { select: { meal: true, serviceDate: true, cutoffAt: true } },
      bookings: {
        select: {
          count: true,
          status: true,
          updatedAt: true,
        },
      },
    },
    orderBy: [
      { service: { serviceDate: "desc" } },
      { service: { meal: "asc" } },
      { menuItem: { name: "asc" } },
    ],
  });

  let totalCookedAll = 0;
  let totalServedAll = 0;
  let totalWastedAll = 0;

  const rows: MealConsumptionRow[] = offerings.map((offering) => {
    const metrics = calculateConsumptionMetrics(offering.bookings, offering.service.cutoffAt);

    totalCookedAll += metrics.totalCooked;
    totalServedAll += metrics.served;
    totalWastedAll += metrics.wastageCount;

    return {
      date: toInputDate(offering.service.serviceDate),
      meal: offering.service.meal,
      dishName: offering.menuItem.name,
      included: offering.menuItem.included,
      priceRupees: offering.menuItem.priceRupees,
      quantityTotal: offering.quantityTotal,
      quantityLeft: offering.quantityLeft,
      ...metrics,
    };
  });

  return {
    rows,
    totals: {
      cooked: totalCookedAll,
      served: totalServedAll,
      wasted: totalWastedAll,
    },
  };
}

export async function getExtraRevenueReport(
  startDate: Date,
  endDate: Date
): Promise<{ rows: ExtraRevenueRow[]; totalRevenue: number }> {
  const offerings = await prisma.offering.findMany({
    where: {
      menuItem: { included: false, priceRupees: { not: null } },
      service: {
        published: true,
        serviceDate: {
          gte: startDate,
          lte: endDate,
        },
      },
    },
    include: {
      menuItem: { select: { name: true, priceRupees: true } },
      service: { select: { meal: true, serviceDate: true, cutoffAt: true } },
      bookings: {
        select: {
          count: true,
          status: true,
          updatedAt: true,
        },
      },
    },
    orderBy: [
      { service: { serviceDate: "desc" } },
      { service: { meal: "asc" } },
      { menuItem: { name: "asc" } },
    ],
  });

  let overallRevenue = 0;

  const rows: ExtraRevenueRow[] = [];

  for (const offering of offerings) {
    const price = offering.menuItem.priceRupees ?? 0;
    const metrics = calculateRevenueMetrics(offering.bookings, offering.service.cutoffAt, price);

    overallRevenue += metrics.totalRevenueRupees;

    rows.push({
      date: toInputDate(offering.service.serviceDate),
      meal: offering.service.meal,
      dishName: offering.menuItem.name,
      priceRupees: price,
      ...metrics,
    });
  }

  return {
    rows,
    totalRevenue: overallRevenue,
  };
}
