# Rules

These are already decided. A PR that breaks one of them needs a comment from me before it is written. Schema changes go through me too.

One mess. No second hostel, no delivery, no payment gateway.

## Who can do what

- Student: book, cancel their own booking, file a complaint, leave one review per dish.
- Kitchen: create the service, set quantity and cutoff, mark published. Bookings only work on published services.
- Secretary: mark a complaint acknowledged. They do not edit the menu.

There is no public signup. Accounts are the ones in the seed, plus any I add later.

## Menu

A menu item is the dish (thali, biryani, sambar). A service is breakfast, lunch, or dinner on a date. An offering is that dish on that service, with a plate count.

`included` means it is part of the mess plan and `priceRupees` stays null. Extras have a price and a small quantity.

`quantityLeft` starts equal to `quantityTotal`. Nothing else writes that column except booking and cancel.

## Booking

One open booking per student per offering. If they already have a row with status `BOOKED`, update the count or reject the second request. Do not insert another `BOOKED` row.

Booking and the stock change are one transaction. The update only succeeds when enough plates are left:

```sql
UPDATE "Offering"
SET "quantityLeft" = "quantityLeft" - $count
WHERE id = $id
  AND "quantityLeft" >= $count
```

If that updates zero rows, the booking is not created. The student sees that it is sold out. Two people booking the last plate at the same time: one commit, one failure. `quantityLeft` never goes below zero.

Count has to be a positive integer. You cannot book more than `quantityLeft`.

## Cancel

Read `cutoffAt` on the service.

- Before cutoff: status becomes `CANCELLED` and `quantityLeft` goes back up by `count`, and it cannot go past `quantityTotal`.
- After cutoff: status can become `CANCELLED`, but the plates stay consumed.

Do this in one transaction too.

`SERVED` and `NO_SHOW` are for the kitchen after the meal. They do not change `quantityLeft`.

## Complaints

A complaint is about a menu item on a service (sambar at yesterday's lunch), not a generic "food was bad". Optional photo. Status is `OPEN` or `ACKNOWLEDGED`. Students do not close it themselves.

## Reviews

One review per student per menu item. Stars are 1 to 5. The average shown on a dish is the average of those rows. Validate with zod on the way in.
