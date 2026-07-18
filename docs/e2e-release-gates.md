# Browser release gates

Playwright is the canonical browser-test framework.

Commands:

```text
pnpm run test:e2e
pnpm run test:a11y
pnpm run test:visual
```

The suite uses deterministic API routing and privacy-safe fixtures. Failure traces,
videos, and screenshots are retained only on failure. Use `PLAYWRIGHT_BASE_URL` for
Replit or production smoke runs; production smoke accounts must be dedicated test
accounts and must not use household passwords, OAuth tokens, or real storage
objects.

Accessibility failures with serious or critical axe impact fail CI. Any exception
must name the axe rule, selector, reason, owner, and expiration issue.
