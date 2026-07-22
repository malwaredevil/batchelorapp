# Contributing

This is a private household application. It is not open for public contributions.

If you have been invited to contribute, please note:

- **Branch**: all work goes to `main` via the Replit agent workflow
- **Style**: TypeScript strict mode, Prettier formatting enforced on commit
- **Tests**: run `pnpm run typecheck` before pushing; CI runs typecheck + build on every PR
- **Database**: never run `drizzle-kit push --force` — use additive-only migrations in `lib/db/src/bootstrap.ts`
- **Secrets**: never commit secrets, credentials, or `.env` files

For questions, contact the project owner directly.
