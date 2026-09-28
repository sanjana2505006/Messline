# Contributing

I assign the work. If there is no issue with your name on it, ask before you start. Small fixes for a typo or a broken seed are fine as a PR without an issue.

## Branch

`feat/short-name`, `fix/short-name`, or `chore/short-name`.

Branch off `main`. One issue per PR.

## Before you open the PR

```bash
npm run lint
npm run build
```

If the database changed, run `npm run db:migrate` and commit the new folder under `prisma/migrations`. Don't edit a migration that is already on `main`.

Say how you tested it in the PR. If you touched a screen, add a screenshot.

## Leave these alone unless the issue says so

- `prisma/schema.prisma`
- `docs/rules.md`
- the docker port (`5434`) and the app port (`3001`)

Don't add a library for something the stack already covers. zod is already here for request bodies. Prisma is the database. If you think you need something else, ask in the issue first.

Don't commit `.env`. Copy `.env.example`.

Don't reformat files you didn't change.
