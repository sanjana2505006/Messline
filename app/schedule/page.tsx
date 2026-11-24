import type { Metadata } from "next";
import Link from "next/link";
import { Meal, Role } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { getWeeklySchedule } from "@/lib/schedule";
import { bookPlatesAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Schedule | Messline",
};

const ERROR_MESSAGES: Record<string, string> = {
  NOT_STUDENT: "Only signed-in students can book meals.",
  INVALID_COUNT: "Please enter a valid positive number of plates.",
  NOT_FOUND: "Offering not found.",
  NOT_PUBLISHED: "This meal service is not currently open for booking.",
  CUTOFF_PASSED: "Booking is closed for this meal. The cutoff time has passed.",
  ALREADY_BOOKED: "You already have a booking for this dish.",
  SOLD_OUT: "This dish is sold out.",
};

function mealLabel(meal: Meal): string {
  return meal.charAt(0).toUpperCase() + meal.slice(1).toLowerCase();
}

function priceLabel(included: boolean, priceRupees: number | null): string {
  if (included) return "Included";
  if (priceRupees == null) return "No price";
  return `₹${priceRupees}`;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: { week?: string; booked?: string; error?: string };
}) {
  const user = await getCurrentUser();
  const isStudent = user?.role === Role.STUDENT;

  const weekOffset = parseInt(searchParams.week ?? "0", 10) || 0;
  const schedule = await getWeeklySchedule(weekOffset, user?.id);

  const startFormatted = schedule.startMonday.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const endFormatted = schedule.endSunday.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  const message = searchParams.booked
    ? "Booked."
    : searchParams.error
    ? ERROR_MESSAGES[searchParams.error] ?? "Could not book. Try again."
    : null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Weekly Meal Schedule</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {startFormatted} – {endFormatted}
          </p>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/schedule?week=${weekOffset - 1}`}
            className="rounded border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50"
          >
            ← Previous
          </Link>
          {weekOffset !== 0 && (
            <Link
              href="/schedule"
              className="rounded border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Current Week
            </Link>
          )}
          <Link
            href={`/schedule?week=${weekOffset + 1}`}
            className="rounded border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Next →
          </Link>
        </div>
      </div>

      {message && (
        <div
          role="status"
          className={`mt-6 rounded p-3 text-sm font-medium ${
            searchParams.booked
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message}
        </div>
      )}

      {/* Schedule Grid */}
      <div className="mt-8 space-y-6">
        {schedule.days.map((day) => (
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
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              {[Meal.BREAKFAST, Meal.LUNCH, Meal.DINNER].map((meal) => {
                const slot = day.slots[meal];
                return (
                  <div
                    key={meal}
                    className="flex flex-col justify-between rounded border border-neutral-100 bg-neutral-50/50 p-4"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                          {mealLabel(meal)}
                        </span>
                        {slot.serviceId && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                              slot.isCutoffPassed
                                ? "bg-neutral-100 text-neutral-600"
                                : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {slot.isCutoffPassed ? "Closed" : "Open"}
                          </span>
                        )}
                      </div>

                      {slot.offerings.length === 0 ? (
                        <p className="mt-3 text-xs italic text-neutral-400">No dishes scheduled</p>
                      ) : (
                        <ul className="mt-3 space-y-3">
                          {slot.offerings.map((offering) => (
                            <li key={offering.id} className="rounded border border-neutral-200 bg-white p-2.5">
                              <div className="flex items-start justify-between">
                                <Link
                                  href={`/dishes/${offering.menuItemId}`}
                                  className="font-medium text-sm text-neutral-900 hover:underline"
                                >
                                  {offering.name}
                                </Link>
                                <span className="text-xs text-neutral-500">
                                  {priceLabel(offering.included, offering.priceRupees)}
                                </span>
                              </div>

                              <p className="mt-1 text-xs text-neutral-500 line-clamp-1">
                                {offering.ingredients}
                              </p>

                              <div className="mt-2 flex items-center justify-between text-xs">
                                <span className="text-neutral-600">
                                  {offering.quantityLeft} / {offering.quantityTotal} left
                                </span>

                                {offering.studentBookedCount != null ? (
                                  <span className="rounded bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                                    Booked ({offering.studentBookedCount})
                                  </span>
                                ) : offering.isSoldOut ? (
                                  <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700">
                                    Sold out
                                  </span>
                                ) : slot.isCutoffPassed ? (
                                  <span className="text-neutral-400">Cutoff passed</span>
                                ) : isStudent ? (
                                  <form action={bookPlatesAction} className="flex items-center gap-1.5">
                                    <input
                                      type="hidden"
                                      name="returnUrl"
                                      value={`/schedule?week=${weekOffset}`}
                                    />
                                    <input type="hidden" name="offeringId" value={offering.id} />
                                    <input
                                      type="number"
                                      name="count"
                                      defaultValue="1"
                                      min="1"
                                      max={offering.quantityLeft}
                                      className="w-12 rounded border border-neutral-300 px-1.5 py-0.5 text-center text-xs focus:border-neutral-900 focus:outline-none"
                                    />
                                    <button
                                      type="submit"
                                      className="rounded bg-neutral-900 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-neutral-800"
                                    >
                                      Book
                                    </button>
                                  </form>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ul>
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
