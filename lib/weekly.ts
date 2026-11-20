import { Meal } from "@prisma/client";
import { prisma } from "./db";
import { parseCutoffAsIST } from "./service";

export type PlannerOffering = {
  id: string;
  menuItemId: string;
  name: string;
  quantityTotal: number;
  quantityLeft: number;
  included: boolean;
  priceRupees: number | null;
};

export type PlannerSlot = {
  meal: Meal;
  service: {
    id: string;
    published: boolean;
    cutoffAt: Date;
    isCutoffPassed: boolean;
    offerings: PlannerOffering[];
  } | null;
};

export type PlannerDay = {
  date: Date;
  dateString: string;
  dayName: string;
  dayLabel: string;
  isToday: boolean;
  isPast: boolean;
  slots: Record<Meal, PlannerSlot>;
};

function formatIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getMondayOfWeek(offsetWeeks: number = 0): Date {
  const now = new Date();
  const utcNow = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayOfWeek = utcNow.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(utcNow.getTime() + diffToMonday * 86400000);
  monday.setUTCDate(monday.getUTCDate() + offsetWeeks * 7);
  return monday;
}

export async function getWeeklyPlannerData(offsetWeeks: number = 0) {
  const monday = getMondayOfWeek(offsetWeeks);
  const sunday = new Date(monday.getTime() + 6 * 86400000);

  const startUtc = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 0, 0, 0));
  const endUtc = new Date(Date.UTC(sunday.getUTCFullYear(), sunday.getUTCMonth(), sunday.getUTCDate(), 23, 59, 59));

  const now = new Date();
  const todayIso = formatIsoDate(now);

  const [services, activeMenuItems] = await Promise.all([
    prisma.service.findMany({
      where: {
        serviceDate: {
          gte: startUtc,
          lte: endUtc,
        },
      },
      include: {
        offerings: {
          include: {
            menuItem: true,
          },
        },
      },
      orderBy: [{ serviceDate: "asc" }, { meal: "asc" }],
    }),
    prisma.menuItem.findMany({
      where: { active: true },
      select: { id: true, name: true, included: true, priceRupees: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const serviceMap = new Map<string, typeof services[number]>();
  for (const s of services) {
    const key = `${formatIsoDate(s.serviceDate)}_${s.meal}`;
    serviceMap.set(key, s);
  }

  const days: PlannerDay[] = [];
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const unpublishedServiceIds: string[] = [];

  for (let i = 0; i < 7; i++) {
    const currentDay = new Date(monday.getTime() + i * 86400000);
    const dateString = formatIsoDate(currentDay);
    const isToday = dateString === todayIso;
    const isPast = currentDay.getTime() < new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).getTime();

    const slots: Record<Meal, PlannerSlot> = {
      [Meal.BREAKFAST]: { meal: Meal.BREAKFAST, service: null },
      [Meal.LUNCH]: { meal: Meal.LUNCH, service: null },
      [Meal.DINNER]: { meal: Meal.DINNER, service: null },
    };

    for (const meal of [Meal.BREAKFAST, Meal.LUNCH, Meal.DINNER]) {
      const key = `${dateString}_${meal}`;
      const service = serviceMap.get(key);

      if (service) {
        if (!service.published) {
          unpublishedServiceIds.push(service.id);
        }

        slots[meal] = {
          meal,
          service: {
            id: service.id,
            published: service.published,
            cutoffAt: service.cutoffAt,
            isCutoffPassed: now >= service.cutoffAt,
            offerings: service.offerings.map((o) => ({
              id: o.id,
              menuItemId: o.menuItemId,
              name: o.menuItem.name,
              quantityTotal: o.quantityTotal,
              quantityLeft: o.quantityLeft,
              included: o.menuItem.included,
              priceRupees: o.menuItem.priceRupees,
            })),
          },
        };
      }
    }

    days.push({
      date: currentDay,
      dateString,
      dayName: dayNames[i],
      dayLabel: currentDay.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
      isToday,
      isPast,
      slots,
    });
  }

  return {
    weekOffset: offsetWeeks,
    startMonday: monday,
    endSunday: sunday,
    days,
    activeMenuItems,
    unpublishedServiceIds,
  };
}

export async function publishWeekServices(serviceIds: string[]) {
  if (serviceIds.length === 0) return { count: 0 };
  const result = await prisma.service.updateMany({
    where: {
      id: { in: serviceIds },
      published: false,
    },
    data: { published: true },
  });
  return { count: result.count };
}

export type BatchCreateMealInput = {
  meal: Meal;
  serviceDate: string; // YYYY-MM-DD
  cutoffAt: string; // YYYY-MM-DDTHH:mm
  offerings: { menuItemId: string; count: number }[];
};

export async function batchCreateMeals(meals: BatchCreateMealInput[]) {
  if (meals.length === 0) return { ok: true, createdCount: 0 };

  return prisma.$transaction(async (tx) => {
    let createdCount = 0;
    for (const m of meals) {
      const dateUtc = new Date(`${m.serviceDate}T00:00:00.000Z`);
      const cutoffDate = parseCutoffAsIST(m.cutoffAt);

      if (cutoffDate.getTime() <= Date.now()) {
        throw new Error(`Cutoff for ${m.meal} on ${m.serviceDate} must be in the future.`);
      }

      const existing = await tx.service.findUnique({
        where: { meal_serviceDate: { meal: m.meal, serviceDate: dateUtc } },
      });

      if (existing) {
        continue; // Skip existing to prevent crashing batch
      }

      await tx.service.create({
        data: {
          meal: m.meal,
          serviceDate: dateUtc,
          cutoffAt: cutoffDate,
          published: false,
          offerings: {
            create: m.offerings.map((o) => ({
              menuItemId: o.menuItemId,
              quantityTotal: o.count,
              quantityLeft: o.count,
            })),
          },
        },
      });
      createdCount++;
    }
    return { ok: true, createdCount };
  });
}
