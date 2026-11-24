import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Meal, Role } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import {
  batchCreateMeals,
  getWeeklyPlannerData,
  publishWeekServices,
} from "@/lib/weekly";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Weekly Planner | Messline",
};

function mealLabel(meal: Meal): string {
  return meal.charAt(0).toUpperCase() + meal.slice(1).toLowerCase();
}

function formatCutoffTime(d: Date): string {
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

async function publishWeekAction(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user || user.role !== Role.KITCHEN) {
    redirect("/");
  }

  const rawIds = String(formData.get("serviceIds") ?? "");
  const serviceIds = rawIds.split(",").filter((id) => id.length > 0);
  const weekOffset = String(formData.get("week") ?? "0");

  if (serviceIds.length > 0) {
    await publishWeekServices(serviceIds);
  }

  revalidatePath("/kitchen/weekly");
  revalidatePath("/kitchen");
  revalidatePath("/");
  redirect(`/kitchen/weekly?week=${weekOffset}&published=1`);
}

async function quickCreateMealAction(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user || user.role !== Role.KITCHEN) {
    redirect("/");
  }

  const date = String(formData.get("date") ?? "");
  const meal = formData.get("meal") as Meal;
  const cutoff = String(formData.get("cutoff") ?? "");
  const weekOffset = String(formData.get("week") ?? "0");

  const offerings: { menuItemId: string; count: number }[] = [];
  formData.forEach((value, key) => {
    if (key.startsWith("dish_")) {
      const itemId = key.replace("dish_", "");
      const count = Number(value);
      if (count > 0) {
        offerings.push({ menuItemId: itemId, count });
      }
    }
  });

  if (offerings.length === 0) {
    redirect(`/kitchen/weekly?week=${weekOffset}&error=no_dishes`);
  }

  try {
    await batchCreateMeals([
      {
        meal,
        serviceDate: date,
        cutoffAt: cutoff,
        offerings,
      },
    ]);
  } catch {
    redirect(`/kitchen/weekly?week=${weekOffset}&error=failed`);
  }

  revalidatePath("/kitchen/weekly");
  revalidatePath("/kitchen");
  revalidatePath("/");
  redirect(`/kitchen/weekly?week=${weekOffset}&created=1`);
}

export default async function WeeklyPlannerPage({
  searchParams,
}: {
  searchParams: { week?: string; published?: string; created?: string; error?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== Role.KITCHEN) redirect("/");

  const weekOffset = parseInt(searchParams.week ?? "0", 10) || 0;
  const plannerData = await getWeeklyPlannerData(weekOffset);

  const startFormatted = plannerData.startMonday.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const endFormatted = plannerData.endSunday.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Weekly Menu Planner</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {startFormatted} – {endFormatted} (Kitchen Operations)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {plannerData.unpublishedServiceIds.length > 0 && (
            <form action={publishWeekAction}>
              <input type="hidden" name="serviceIds" value={plannerData.unpublishedServiceIds.join(",")} />
              <input type="hidden" name="week" value={weekOffset} />
              <button
                type="submit"
                className="rounded bg-emerald-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Publish Week ({plannerData.unpublishedServiceIds.length} drafts)
              </button>
            </form>
          )}

          <div className="flex items-center gap-2 text-sm">
            <Link
              href={`/kitchen/weekly?week=${weekOffset - 1}`}
              className="rounded border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50"
            >
              ← Previous
            </Link>
            {weekOffset !== 0 && (
              <Link
                href="/kitchen/weekly"
                className="rounded border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Current Week
              </Link>
            )}
            <Link
              href={`/kitchen/weekly?week=${weekOffset + 1}`}
              className="rounded border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Next →
            </Link>
          </div>
        </div>
      </div>

      {searchParams.published && (
        <div role="status" className="mt-6 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Services published successfully.
        </div>
      )}
      {searchParams.created && (
        <div role="status" className="mt-6 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Service scheduled successfully.
        </div>
      )}
      {searchParams.error && (
        <div role="status" className="mt-6 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Could not schedule service. Please check plate counts and future cutoff requirements.
        </div>
      )}

      {/* 7-Day Planner Matrix */}
      <div className="mt-8 space-y-6">
        {plannerData.days.map((day) => (
          <div
            key={day.dateString}
            className={`rounded-lg border bg-white p-5 shadow-sm ${
              day.isToday ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200"
            }`}
          >
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <div className="flex items-center gap-3">
                <span className="text-base font-semibold text-neutral-900">
                  {day.dayName}, {day.dayLabel}
                </span>
                {day.isToday && (
                  <span className="rounded bg-neutral-900 px-2 py-0.5 text-xs font-medium text-white">
                    Today
                  </span>
                )}
                {day.isPast && (
                  <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                    Past
                  </span>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              {[Meal.BREAKFAST, Meal.LUNCH, Meal.DINNER].map((meal) => {
                const slot = day.slots[meal];
                const defaultCutoffHour = meal === Meal.BREAKFAST ? "06:30" : meal === Meal.LUNCH ? "11:00" : "18:00";
                const defaultCutoffString = `${day.dateString}T${defaultCutoffHour}`;

                return (
                  <div
                    key={meal}
                    className="flex flex-col justify-between rounded border border-neutral-100 bg-neutral-50/50 p-4"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
                          {mealLabel(meal)}
                        </span>
                        {slot.service ? (
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                              slot.service.published
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-50 text-amber-800"
                            }`}
                          >
                            {slot.service.published ? "Published" : "Draft"}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-400">Not scheduled</span>
                        )}
                      </div>

                      {slot.service ? (
                        <div className="mt-3">
                          <p className="text-xs text-neutral-500">
                            Cutoff: {formatCutoffTime(slot.service.cutoffAt)}
                          </p>
                          <ul className="mt-2 space-y-1.5 text-xs text-neutral-700">
                            {slot.service.offerings.map((o) => (
                              <li key={o.id} className="flex justify-between border-b border-neutral-100 py-1">
                                <span className="font-medium">{o.name}</span>
                                <span className="text-neutral-500">
                                  {o.quantityLeft} / {o.quantityTotal} left
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="mt-3">
                          {!day.isPast && (
                            <form action={quickCreateMealAction} className="space-y-2">
                              <input type="hidden" name="date" value={day.dateString} />
                              <input type="hidden" name="meal" value={meal} />
                              <input type="hidden" name="week" value={weekOffset} />
                              <div>
                                <label className="block text-[11px] text-neutral-500">Cutoff (IST)</label>
                                <input
                                  type="datetime-local"
                                  name="cutoff"
                                  defaultValue={defaultCutoffString}
                                  required
                                  className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="block text-[11px] text-neutral-500">Dishes & Quantities</label>
                                {plannerData.activeMenuItems.map((item) => (
                                  <div key={item.id} className="flex items-center justify-between text-xs">
                                    <span className="truncate pr-2">{item.name}</span>
                                    <input
                                      type="number"
                                      name={`dish_${item.id}`}
                                      placeholder="0"
                                      min="0"
                                      className="w-16 rounded border border-neutral-300 px-1.5 py-0.5 text-right text-xs"
                                    />
                                  </div>
                                ))}
                              </div>
                              <button
                                type="submit"
                                className="mt-2 w-full rounded bg-neutral-900 py-1 text-xs font-medium text-white hover:bg-neutral-800"
                              >
                                Save Service Draft
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
