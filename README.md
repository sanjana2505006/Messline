# Messline

Students book mess food. A booking takes plates off the count. Cancel before the cutoff and the plates come back. Cancel after the cutoff and they stay taken, because the kitchen already cooked it.

I maintain this repo and open the issues. The behaviour that is already locked is in [docs/rules.md](docs/rules.md). Read that before writing a feature.

There is no real mess behind the data. The seed is the mess.

## Run

```bash
cp .env.example .env
npm install
npm run docker:up
npm run db:migrate
npm run db:seed
npm run dev
```

App: http://localhost:3001

Postgres is on port **5434**.

The home page lists whatever the seed put in. It is not the product. When the menu issue starts, that page gets replaced.

## Logins

Passwords are hashed. Sign-in is not built, so these do nothing until that issue lands. Use these accounts when you build it. Don't add your own users to the seed.

| who | email | password |
| --- | --- | --- |
| student | meera@messline.dev | student123 |
| student | kabir@messline.dev | student123 |
| kitchen | kitchen@messline.dev | kitchen123 |
| secretary | secretary@messline.dev | secretary123 |

Today's lunch has veg thali (40 plates, included) and chicken biryani (2 plates, Rs 90). Cutoff is two hours after you ran the seed. Yesterday's lunch is sambar, cutoff already passed, quantity 0. That row is there so a complaint has a dish to point at.

`npm run db:reset` wipes the database and seeds again. `npm run db:studio` opens Prisma Studio if you want to move a cutoff by hand.

## CI

Pull requests run lint, `prisma validate`, and a production build. That check has to pass.
