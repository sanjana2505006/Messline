import { Meal } from "@prisma/client";
import { prisma } from "./db";

export type ScheduleOffering = {
  id: string;
  menuItemId: string;
  name: string;
  description: string;
  ingredients: string;
  included: boolean;
  priceRupees: number | null;
  quantityTotal: number;
  quantityLeft: number;
  isSoldOut: boolean;
  studentBookedCount: number | null;
};

export type ScheduleSlot = {
  meal: Meal;
  serviceId: string | null;
  cutoffAt: Date | null;
  isCutoffPassed: boolean;
  offerings: ScheduleOffering[];
};

export type ScheduleDay = {
  date: Date;
  dateString: string;
  dayName: string;
  dayLabel: string;
  isToday: boolean;
  slots: Record<Meal, ScheduleSlot>;
};

export type WeeklyScheduleResult = {
  weekOffset: number;
  startMonday: Date;
  endSunday: Date;
  days: ScheduleDay[];
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
  const dayOfWeek = utcNow.getUTCDay(); // 0 is Sunday, 1 is Monday...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(utcNow.getTime() + diffToMonday * 86400000);
  monday.setUTCDate(monday.getUTCDate() + offsetWeeks * 7);
  return monday;
}

export async function getWeeklySchedule(
  offsetWeeks: number = 0,
  studentUserId?: string
): Promise<WeeklyScheduleResult> {
  const monday = getMondayOfWeek(offsetWeeks);
  const sunday = new Date(monday.getTime() + 6 * 86400000);

  const startUtc = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 0, 0, 0));
  const endUtc = new Date(Date.UTC(sunday.getUTCFullYear(), sunday.getUTCMonth(), sunday.getUTCDate(), 23, 59, 59));

  const now = new Date();
  const todayIso = formatIsoDate(now);

  const services = await prisma.service.findMany({
    where: {
      published: true,
      serviceDate: {
        gte: startUtc,
        lte: endUtc,
      },
    },
    include: {
      offerings: {
        include: {
          menuItem: true,
          bookings: studentUserId
            ? {
                where: { userId: studentUserId, status: "BOOKED" },
                select: { count: true },
              }
            : false,
        },
      },
    },
    orderBy: [{ serviceDate: "asc" }, { meal: "asc" }],
  });

  const serviceMap = new Map<string, typeof services[number]>();
  for (const s of services) {
    const key = `${formatIsoDate(s.serviceDate)}_${s.meal}`;
    serviceMap.set(key, s);
  }

  const days: ScheduleDay[] = [];
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  for (let i = 0; i < 7; i++) {
    const currentDay = new Date(monday.getTime() + i * 86400000);
    const dateString = formatIsoDate(currentDay);
    const isToday = dateString === todayIso;

    const slots: Record<Meal, ScheduleSlot> = {
      [Meal.BREAKFAST]: { meal: Meal.BREAKFAST, serviceId: null, cutoffAt: null, isCutoffPassed: true, offerings: [] },
      [Meal.LUNCH]: { meal: Meal.LUNCH, serviceId: null, cutoffAt: null, isCutoffPassed: true, offerings: [] },
      [Meal.DINNER]: { meal: Meal.DINNER, serviceId: null, cutoffAt: null, isCutoffPassed: true, offerings: [] },
    };

    for (const meal of [Meal.BREAKFAST, Meal.LUNCH, Meal.DINNER]) {
      const key = `${dateString}_${meal}`;
      const service = serviceMap.get(key);

      if (service) {
        const isCutoffPassed = now >= service.cutoffAt;
        const offerings: ScheduleOffering[] = service.offerings.map((o) => {
          let bookedCount: number | null = null;
          if (studentUserId && "bookings" in o && Array.isArray(o.bookings) && o.bookings.length > 0) {
            bookedCount = o.bookings.reduce((sum, b) => sum + b.count, 0);
          }
          return {
            id: o.id,
            menuItemId: o.menuItemId,
            name: o.menuItem.name,
            description: o.menuItem.description,
            ingredients: o.menuItem.ingredients,
            included: o.menuItem.included,
            priceRupees: o.menuItem.priceRupees,
            quantityTotal: o.quantityTotal,
            quantityLeft: o.quantityLeft,
            isSoldOut: o.quantityLeft <= 0,
            studentBookedCount: bookedCount,
          };
        });

        slots[meal] = {
          meal,
          serviceId: service.id,
          cutoffAt: service.cutoffAt,
          isCutoffPassed,
          offerings,
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
      slots,
    });
  }

  return {
    weekOffset: offsetWeeks,
    startMonday: monday,
    endSunday: sunday,
    days,
  };
}
