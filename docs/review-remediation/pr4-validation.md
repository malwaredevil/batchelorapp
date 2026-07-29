# PR 4 validation

Generated after the focused validation repair.

## Typecheck

```text

> workspace@0.0.0 typecheck /home/runner/work/batchelorapp/batchelorapp
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck


> workspace@0.0.0 typecheck:libs /home/runner/work/batchelorapp/batchelorapp
> tsc --build

Scope: 7 of 23 workspace projects
artifacts/api-server pretypecheck$ pnpm -w run typecheck:libs
artifacts/e2e typecheck$ tsc --noEmit
artifacts/elaine typecheck$ tsc -p tsconfig.json --noEmit
artifacts/mockup-sandbox typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server pretypecheck: > workspace@0.0.0 typecheck:libs /home/runner/work/batchelorapp/batchelorapp
artifacts/api-server pretypecheck: > tsc --build
artifacts/api-server pretypecheck: Done
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/e2e typecheck: Done
artifacts/modules typecheck$ tsc -b tsconfig.json
artifacts/mockup-sandbox typecheck: Done
artifacts/web typecheck$ tsc -p tsconfig.json --noEmit
artifacts/elaine typecheck: Done
scripts typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck: Done
artifacts/api-server typecheck: Done
artifacts/web typecheck: Done
artifacts/modules typecheck: Done
```

Exit code: 0

## Semantic and formatting lint

```text

> workspace@0.0.0 lint /home/runner/work/batchelorapp/batchelorapp
> pnpm run format:check && pnpm run lint:semantic && pnpm --filter @workspace/scripts run check-raw-fetch


> workspace@0.0.0 format:check /home/runner/work/batchelorapp/batchelorapp
> prettier --check .

Checking formatting...
All matched files use Prettier code style!

> workspace@0.0.0 lint:semantic /home/runner/work/batchelorapp/batchelorapp
> eslint artifacts lib scripts --ext .ts,.tsx


Oops! Something went wrong! :(

ESLint: 9.39.5

TypeError: pLimit is not a function
    at pLocate (/home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/p-locate@5.0.0/node_modules/p-locate/index.js:31:16)
    at module.exports (/home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/locate-path@6.0.0/node_modules/locate-path/index.js:37:9)
    at runMatcher (/home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/find-up@5.0.0/node_modules/find-up/index.js:15:11)
    at module.exports (/home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/find-up@5.0.0/node_modules/find-up/index.js:29:27)
    at ConfigLoader.locateConfigFileToUse (/home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/eslint@9.39.5_jiti@2.7.0/node_modules/eslint/lib/config/config-loader.js:542:27)
    at #locateConfigFileToUse (/home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/eslint@9.39.5_jiti@2.7.0/node_modules/eslint/lib/config/config-loader.js:714:40)
    at LegacyConfigLoader.loadConfigArrayForDirectory (/home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/eslint@9.39.5_jiti@2.7.0/node_modules/eslint/lib/config/config-loader.js:778:37)
    at directoryFilter (/home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/eslint@9.39.5_jiti@2.7.0/node_modules/eslint/lib/eslint/eslint-helpers.js:309:24)
    at NodeHfs.<anonymous> (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@humanfs+core@0.19.2/node_modules/@humanfs/core/src/hfs.js:584:32)
    at async NodeHfs.walk (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@humanfs+core@0.19.2/node_modules/@humanfs/core/src/hfs.js:614:3)
 ELIFECYCLE  Command failed with exit code 2.
 ELIFECYCLE  Command failed with exit code 2.
```

Exit code: 2

## API tests

```text

> @workspace/api-server@0.0.0 test /home/runner/work/batchelorapp/batchelorapp/artifacts/api-server
> vitest run


[1m[46m RUN [49m[22m [36mv3.2.6 [39m[90m/home/runner/work/batchelorapp/batchelorapp/artifacts/api-server[39m

 [32m✓[39m src/lib/app-config-bootstrap.test.ts [2m([22m[2m23 tests[22m[2m)[22m[33m 1044[2mms[22m[39m
   [33m[2m✓[22m[39m rowNeedsLabelSync() — drift predicate[2m > [22mreturns true when the row's label differs from the default [33m 978[2mms[22m[39m
 [32m✓[39m src/lib/app-config-drift.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 240[2mms[22m[39m
 [32m✓[39m src/routes/config.test.ts [2m([22m[2m45 tests[22m[2m)[22m[33m 1197[2mms[22m[39m
   [33m[2m✓[22m[39m bootstrapDefaults — step coverage and error classification[2m > [22mcalls db.delete, db.insert, and db.update during bootstrap [33m 877[2mms[22m[39m
 [32m✓[39m src/routes/agentphone.test.ts [2m([22m[2m29 tests[22m[2m)[22m[33m 1053[2mms[22m[39m
[90mstdout[2m | src/routes/upload-rejection.test.ts[2m > [22m[2mTravels POST /api/travels/trips/:id/documents — upload rejection[2m > [22m[2maccepts a valid PDF and returns 201
[22m[39mWarning: Indexing all PDF objects

 [32m✓[39m src/routes/upload-rejection.test.ts [2m([22m[2m32 tests[22m[2m | [22m[33m4 skipped[39m[2m)[22m[33m 1439[2mms[22m[39m
 [32m✓[39m src/routes/supplemental-upload-rejection.test.ts [2m([22m[2m31 tests[22m[2m)[22m[33m 1321[2mms[22m[39m
 [32m✓[39m src/middleware/uploadSizeGuard.test.ts [2m([22m[2m16 tests[22m[2m | [22m[33m1 skipped[39m[2m)[22m[32m 262[2mms[22m[39m
{"level":50,"time":1785318961116,"pid":2939,"hostname":"runnervmvrwv9","err":{"type":"Error","message":"gmail api down","stack":"Error: gmail api down\n    at /home/runner/work/batchelorapp/batchelorapp/artifacts/api-server/src/routes/travels/gmail.test.ts:638:30\n    at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:155:11\n    at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:752:26\n    at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1897:20\n    at new Promise (<anonymous>)\n    at runWithTimeout (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1863:10)\n    at runTest (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1574:12)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at runSuite (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1729:8)\n    at runSuite (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1729:8)"},"userId":42,"messageId":"msg-3","msg":"gmail: bulk-link failed for message"}
{"level":50,"time":1785318961137,"pid":2939,"hostname":"runnervmvrwv9","err":{"type":"Error","message":"boom","stack":"Error: boom\n    at /home/runner/work/batchelorapp/batchelorapp/artifacts/api-server/src/routes/travels/gmail.test.ts:765:40\n    at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:155:11\n    at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:752:26\n    at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1897:20\n    at new Promise (<anonymous>)\n    at runWithTimeout (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1863:10)\n    at runTest (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1574:12)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at runSuite (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1729:8)\n    at runSuite (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1729:8)"},"userId":42,"msg":"gmail: manual scan failed"}
 [32m✓[39m src/routes/travels/gmail.test.ts [2m([22m[2m35 tests[22m[2m)[22m[33m 950[2mms[22m[39m
 [32m✓[39m src/routes/elaine-email.test.ts [2m([22m[2m20 tests[22m[2m)[22m[33m 929[2mms[22m[39m
[90mstderr[2m | src/lib/storage-reconcile.test.ts
[22m[39mUsing an object as a third argument is deprecated. Vitest 4 will throw an error if the third argument is not a timeout number. Please use the second argument for options. See more at https://vitest.dev/guide/migration

 [32m✓[39m src/lib/storage-reconcile.test.ts [2m([22m[2m25 tests[22m[2m)[22m[32m 20[2mms[22m[39m
 [32m✓[39m src/lib/reminder-scheduler.test.ts [2m([22m[2m38 tests[22m[2m)[22m[32m 48[2mms[22m[39m
 [32m✓[39m src/routes/slack.test.ts [2m([22m[2m12 tests[22m[2m)[22m[33m 527[2mms[22m[39m
   [33m[2m✓[22m[39m Slack webhook — job-queue path (#308)[2m > [22menqueues a slack.turn job for a valid inbound DM and returns 200 [33m 459[2mms[22m[39m
 [32m✓[39m src/routes/travels/documents.test.ts [2m([22m[2m20 tests[22m[2m)[22m[33m 909[2mms[22m[39m
[90mstderr[2m | src/routes/auth.test.ts[2m > [22m[2mPOST /auth/change-password — #313 session-persistence preservation[2m > [22m[2mpreserves userId on the regenerated session
[22m[39mError: DB error during UPDATE
    at Object.<anonymous> (/home/runner/work/batchelorapp/batchelorapp/artifacts/api-server/src/routes/auth.test.ts:323:13)
    at Object.mockCall (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+spy@3.2.6/node_modules/@vitest/spy/dist/index.js:96:15)
    at Object.spy [as query] (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/tinyspy@4.0.4/node_modules/tinyspy/dist/index.js:47:80)
    at /home/runner/work/batchelorapp/batchelorapp/artifacts/api-server/src/routes/auth.ts:364:20
    at processTicksAndRejections (node:internal/process/task_queues:104:5)

 [32m✓[39m src/routes/auth.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 1402[2mms[22m[39m
 [32m✓[39m src/elaine/update-app-config-action.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 1844[2mms[22m[39m
 [32m✓[39m src/routes/messenger/link-preview.test.ts [2m([22m[2m9 tests[22m[2m)[22m[33m 910[2mms[22m[39m
 [32m✓[39m src/routes/pool-concurrency.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 1546[2mms[22m[39m
 [32m✓[39m src/lib/jobs/worker.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 51[2mms[22m[39m
{"level":50,"time":1785318965706,"pid":3167,"hostname":"runnervmvrwv9","err":{"type":"Error","message":"Resend API error","stack":"Error: Resend API error\n    at /home/runner/work/batchelorapp/batchelorapp/artifacts/api-server/src/routes/travels/settings.test.ts:366:7\n    at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:155:11\n    at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:752:26\n    at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1897:20\n    at new Promise (<anonymous>)\n    at runWithTimeout (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1863:10)\n    at runTest (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1574:12)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at runSuite (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1729:8)\n    at runSuite (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1729:8)"},"userId":42,"msg":"settings: test reminder email failed"}
 [32m✓[39m src/routes/travels/settings.test.ts [2m([22m[2m22 tests[22m[2m)[22m[33m 888[2mms[22m[39m
[90mstderr[2m | src/middleware/webhookLimiter.test.ts[2m > [22m[2mwebhookLimiter — store error handling (passOnStoreError: false)[2m > [22m[2mdoes not silently pass the request when the store throws
[22m[39mError: DB connection refused
    at FakeStore.increment (/home/runner/work/batchelorapp/batchelorapp/artifacts/api-server/src/middleware/webhookLimiter.test.ts:30:29)
    at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/express-rate-limit@8.5.2_express@5.2.1/node_modules/express-rate-limit/dist/index.mjs:868:52
    at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/express-rate-limit@8.5.2_express@5.2.1/node_modules/express-rate-limit/dist/index.mjs:825:5

[90mstderr[2m | src/middleware/webhookLimiter.test.ts[2m > [22m[2mwebhookLimiter — namespace / key prefix[2m > [22m[2muses the 'webhook' prefix so webhook keys do not collide with other limiters
[22m[39mError: DB connection refused
    at FakeStore.increment (/home/runner/work/batchelorapp/batchelorapp/artifacts/api-server/src/middleware/webhookLimiter.test.ts:30:29)
    at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/express-rate-limit@8.5.2_express@5.2.1/node_modules/express-rate-limit/dist/index.mjs:868:52
    at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/express-rate-limit@8.5.2_express@5.2.1/node_modules/express-rate-limit/dist/index.mjs:825:5

 [32m✓[39m src/routes/admin/storage-reconcile.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 57[2mms[22m[39m
 [32m✓[39m src/lib/review-remediation-quality.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 4[2mms[22m[39m
 [32m✓[39m src/middleware/webhookLimiter.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 647[2mms[22m[39m
   [33m[2m✓[22m[39m webhookLimiter — namespace / key prefix[2m > [22mPostgresRateLimitStore constructor is called with 'webhook' in production config [33m 594[2mms[22m[39m
 [32m✓[39m src/lib/jobs/registry.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 4[2mms[22m[39m
 [32m✓[39m src/lib/operations.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 3[2mms[22m[39m
 [32m✓[39m src/middleware/app-upload-guard.test.ts [2m([22m[2m3 tests[22m[2m)[22m[33m 4049[2mms[22m[39m

[2m Test Files [22m [1m[32m25 passed[39m[22m[90m (25)[39m
[2m      Tests [22m [1m[32m414 passed[39m[22m[2m | [22m[33m5 skipped[39m[90m (419)[39m
[2m   Start at [22m 09:55:56
[2m   Duration [22m 13.11s[2m (transform 2.42s, setup 0ms, collect 6.46s, tests 21.34s, environment 5ms, prepare 2.00s)[22m

```

Exit code: 0

## Docs generator tests

```text

> @workspace/scripts@0.0.0 docs:test /home/runner/work/batchelorapp/batchelorapp/scripts
> tsx ./src/docs/generate.test.ts

Generated docs in docs/generated
docs generator scope tests passed
```

Exit code: 0

## API server build

```text

> @workspace/api-server@0.0.0 build /home/runner/work/batchelorapp/batchelorapp/artifacts/api-server
> node ./build.mjs


  dist/index.mjs                              19.2mb ⚠️
  dist/scripts/send-reminder-alerts.mjs        3.3mb ⚠️
  dist/pino-worker.mjs                       153.5kb
  dist/pino-file.mjs                         142.1kb
  dist/pino-pretty.mjs                       114.7kb
  dist/instrument.mjs                          8.0kb
  dist/thread-stream-worker.mjs                7.4kb
  dist/index.mjs.map                          30.0mb
  dist/scripts/send-reminder-alerts.mjs.map    5.5mb
  dist/pino-worker.mjs.map                   256.9kb
  dist/pino-file.mjs.map                     229.1kb
  dist/pino-pretty.mjs.map                   204.0kb
  dist/instrument.mjs.map                     17.4kb
  dist/thread-stream-worker.mjs.map           12.0kb

⚡ Done in 1154ms
```

Exit code: 0

## Modules build

```text

> @workspace/modules@0.0.0 build /home/runner/work/batchelorapp/batchelorapp/artifacts/modules
> vite build --config vite.config.ts

[36mvite v7.3.5 [32mbuilding client environment for production...[36m[39m
transforming...
[33m../../lib/ui/src/sonner.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[33m../../lib/ui/src/tooltip.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[33m../../lib/ui/src/progress.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[33m../../lib/ui/src/label.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[33m../../lib/ui/src/sheet.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[33m../../lib/ui/src/dropdown-menu.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[33m../../lib/ui/src/avatar.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[33m../../lib/ui/src/select.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[33m../../lib/ui/src/command.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[33m../../lib/ui/src/toggle-group.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[33m../../lib/ui/src/calendar.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[33m../../lib/ui/src/collapsible.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[33m../../lib/ui/src/field.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[33m../../lib/ui/src/resizable.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[33m../../lib/ui/src/sidebar.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.[39m
[32m✓[39m 4941 modules transformed.
rendering chunks...
computing gzip size...
[2mdist/public/[22m[32mindex.html                                   [39m[1m[2m    1.46 kB[22m[1m[22m[2m │ gzip:   0.55 kB[22m
[2mdist/public/[22m[2massets/[22m[32melaine-avatar-DtXPEBYP.png            [39m[1m[2m1,018.87 kB[22m[1m[22m
[2mdist/public/[22m[2massets/[22m[35mindex-NO8435Xh.css                    [39m[1m[2m  205.43 kB[22m[1m[22m[2m │ gzip:  30.22 kB[22m
[2mdist/public/[22m[2massets/[22m[36mnav-guard-CtIwlOne.js                 [39m[1m[2m    0.12 kB[22m[1m[22m[2m │ gzip:   0.13 kB[22m[2m │ map:     1.99 kB[22m
[2mdist/public/[22m[2massets/[22m[36mchevrons-up-down-CSAKEMhP.js          [39m[1m[2m    0.18 kB[22m[1m[22m[2m │ gzip:   0.16 kB[22m[2m │ map:     1.02 kB[22m
[2mdist/public/[22m[2massets/[22m[36mskeleton-KWJMjdq6.js                  [39m[1m[2m    0.18 kB[22m[1m[22m[2m │ gzip:   0.16 kB[22m[2m │ map:     0.62 kB[22m
[2mdist/public/[22m[2massets/[22m[36mtrending-up-tdA35z6W.js               [39m[1m[2m    0.18 kB[22m[1m[22m[2m │ gzip:   0.17 kB[22m[2m │ map:     0.99 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcircle-check-CokxI6Ok.js              [39m[1m[2m    0.18 kB[22m[1m[22m[2m │ gzip:   0.17 kB[22m[2m │ map:     1.02 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcircle-stop-ChWZy7DM.js               [39m[1m[2m    0.20 kB[22m[1m[22m[2m │ gzip:   0.17 kB[22m[2m │ map:     1.09 kB[22m
[2mdist/public/[22m[2massets/[22m[36mrotate-cw-uR2v0FAi.js                 [39m[1m[2m    0.20 kB[22m[1m[22m[2m │ gzip:   0.18 kB[22m[2m │ map:     1.00 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcircle-x-CvLp-yCI.js                  [39m[1m[2m    0.21 kB[22m[1m[22m[2m │ gzip:   0.18 kB[22m[2m │ map:     1.09 kB[22m
[2mdist/public/[22m[2massets/[22m[36mdollar-sign-Cq9ESTHg.js               [39m[1m[2m    0.22 kB[22m[1m[22m[2m │ gzip:   0.19 kB[22m[2m │ map:     1.07 kB[22m
[2mdist/public/[22m[2massets/[22m[36msquare-check-big-dYKBlDLb.js          [39m[1m[2m    0.23 kB[22m[1m[22m[2m │ gzip:   0.20 kB[22m[2m │ map:     1.09 kB[22m
[2mdist/public/[22m[2massets/[22m[36mupload-BdPi_x3u.js                    [39m[1m[2m    0.23 kB[22m[1m[22m[2m │ gzip:   0.19 kB[22m[2m │ map:     1.08 kB[22m
[2mdist/public/[22m[2massets/[22m[36mdownload-D054ojF8.js                  [39m[1m[2m    0.23 kB[22m[1m[22m[2m │ gzip:   0.19 kB[22m[2m │ map:     1.09 kB[22m
[2mdist/public/[22m[2massets/[22m[36mellipsis-vertical-B2Fqo2Q6.js         [39m[1m[2m    0.24 kB[22m[1m[22m[2m │ gzip:   0.17 kB[22m[2m │ map:     1.22 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcopy-C-FBh_vH.js                      [39m[1m[2m    0.24 kB[22m[1m[22m[2m │ gzip:   0.21 kB[22m[2m │ map:     1.08 kB[22m
[2mdist/public/[22m[2massets/[22m[36mlink-2-Bw3YgENZ.js                    [39m[1m[2m    0.24 kB[22m[1m[22m[2m │ gzip:   0.20 kB[22m[2m │ map:     1.13 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcircle-question-mark-CZRBUQh7.js      [39m[1m[2m    0.25 kB[22m[1m[22m[2m │ gzip:   0.21 kB[22m[2m │ map:     1.20 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcircle-alert-D_vqqv5M.js              [39m[1m[2m    0.25 kB[22m[1m[22m[2m │ gzip:   0.19 kB[22m[2m │ map:     1.24 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcalendar-BmZjxFJt.js                  [39m[1m[2m    0.26 kB[22m[1m[22m[2m │ gzip:   0.20 kB[22m[2m │ map:     1.23 kB[22m
[2mdist/public/[22m[2massets/[22m[36mtriangle-alert-sgR0ZEPw.js            [39m[1m[2m    0.27 kB[22m[1m[22m[2m │ gzip:   0.21 kB[22m[2m │ map:     1.19 kB[22m
[2mdist/public/[22m[2massets/[22m[36mornaments-BDPnoRtq.js                 [39m[1m[2m    0.27 kB[22m[1m[22m[2m │ gzip:   0.21 kB[22m[2m │ map:     2.17 kB[22m
[2mdist/public/[22m[2massets/[22m[36meraser-DmW4osLm.js                    [39m[1m[2m    0.28 kB[22m[1m[22m[2m │ gzip:   0.22 kB[22m[2m │ map:     1.10 kB[22m
[2mdist/public/[22m[2massets/[22m[36mhash-Awl-cCz-.js                      [39m[1m[2m    0.30 kB[22m[1m[22m[2m │ gzip:   0.19 kB[22m[2m │ map:     1.36 kB[22m
[2mdist/public/[22m[2massets/[22m[36mlist-idFGXh6M.js                      [39m[1m[2m    0.30 kB[22m[1m[22m[2m │ gzip:   0.19 kB[22m[2m │ map:     1.32 kB[22m
[2mdist/public/[22m[2massets/[22m[36mfile-down-CLRzobdR.js                 [39m[1m[2m    0.31 kB[22m[1m[22m[2m │ gzip:   0.22 kB[22m[2m │ map:     1.23 kB[22m
[2mdist/public/[22m[2massets/[22m[36mprinter-DvOJRZEK.js                   [39m[1m[2m    0.32 kB[22m[1m[22m[2m │ gzip:   0.24 kB[22m[2m │ map:     1.26 kB[22m
[2mdist/public/[22m[2massets/[22m[36mrefresh-cw-gEOzttNA.js                [39m[1m[2m    0.32 kB[22m[1m[22m[2m │ gzip:   0.23 kB[22m[2m │ map:     1.25 kB[22m
[2mdist/public/[22m[2massets/[22m[36mrefresh-ccw-AMh-jGsZ.js               [39m[1m[2m    0.32 kB[22m[1m[22m[2m │ gzip:   0.23 kB[22m[2m │ map:     1.26 kB[22m
[2mdist/public/[22m[2massets/[22m[36mflip-horizontal-2-CpCvnvxa.js         [39m[1m[2m    0.33 kB[22m[1m[22m[2m │ gzip:   0.21 kB[22m[2m │ map:     1.42 kB[22m
[2mdist/public/[22m[2massets/[22m[36msave-j27_TAii.js                      [39m[1m[2m    0.33 kB[22m[1m[22m[2m │ gzip:   0.23 kB[22m[2m │ map:     1.20 kB[22m
[2mdist/public/[22m[2massets/[22m[36mshare-2-6oOFujBI.js                   [39m[1m[2m    0.36 kB[22m[1m[22m[2m │ gzip:   0.23 kB[22m[2m │ map:     1.48 kB[22m
[2mdist/public/[22m[2massets/[22m[36mimage-plus-K0XCcNMe.js                [39m[1m[2m    0.37 kB[22m[1m[22m[2m │ gzip:   0.25 kB[22m[2m │ map:     1.39 kB[22m
[2mdist/public/[22m[2massets/[22m[36mlock-CQQKZjyL.js                      [39m[1m[2m    0.37 kB[22m[1m[22m[2m │ gzip:   0.23 kB[22m[2m │ map:     1.97 kB[22m
[2mdist/public/[22m[2massets/[22m[36mflip-horizontal-DGqNZTIT.js           [39m[1m[2m    0.38 kB[22m[1m[22m[2m │ gzip:   0.24 kB[22m[2m │ map:     1.46 kB[22m
[2mdist/public/[22m[2massets/[22m[36mgoogle-maps-loader-DYHGwRbK.js        [39m[1m[2m    0.41 kB[22m[1m[22m[2m │ gzip:   0.30 kB[22m[2m │ map:     3.21 kB[22m
[2mdist/public/[22m[2massets/[22m[36msliders-vertical-C80oM5Jf.js          [39m[1m[2m    0.42 kB[22m[1m[22m[2m │ gzip:   0.24 kB[22m[2m │ map:     1.70 kB[22m
[2mdist/public/[22m[2massets/[22m[36mpalette-Dh0y-MMu.js                   [39m[1m[2m    0.51 kB[22m[1m[22m[2m │ gzip:   0.28 kB[22m[2m │ map:     1.69 kB[22m
[2mdist/public/[22m[2massets/[22m[36mwand-sparkles-We7sjFN1.js             [39m[1m[2m    0.52 kB[22m[1m[22m[2m │ gzip:   0.29 kB[22m[2m │ map:     1.74 kB[22m
[2mdist/public/[22m[2massets/[22m[36marrow-up-narrow-wide-BRxAXzsf.js      [39m[1m[2m    0.52 kB[22m[1m[22m[2m │ gzip:   0.27 kB[22m[2m │ map:     2.51 kB[22m
[2mdist/public/[22m[2massets/[22m[36mLockButton-B_PnmZVj.js                [39m[1m[2m    0.53 kB[22m[1m[22m[2m │ gzip:   0.36 kB[22m[2m │ map:     1.31 kB[22m
[2mdist/public/[22m[2massets/[22m[36mfile-image-pMBDG2x5.js                [39m[1m[2m    0.60 kB[22m[1m[22m[2m │ gzip:   0.32 kB[22m[2m │ map:     2.39 kB[22m
[2mdist/public/[22m[2massets/[22m[36mscan-line-KWKlZCpA.js                 [39m[1m[2m    0.62 kB[22m[1m[22m[2m │ gzip:   0.34 kB[22m[2m │ map:     2.49 kB[22m
[2mdist/public/[22m[2massets/[22m[36meye-CeWFdhgj.js                       [39m[1m[2m    0.64 kB[22m[1m[22m[2m │ gzip:   0.34 kB[22m[2m │ map:     2.34 kB[22m
[2mdist/public/[22m[2massets/[22m[36mverdict-Ci9g2Mzn.js                   [39m[1m[2m    0.68 kB[22m[1m[22m[2m │ gzip:   0.42 kB[22m[2m │ map:     1.81 kB[22m
[2mdist/public/[22m[2massets/[22m[36museAppConfigSummary-CdkC9PRJ.js       [39m[1m[2m    0.73 kB[22m[1m[22m[2m │ gzip:   0.45 kB[22m[2m │ map:     2.31 kB[22m
[2mdist/public/[22m[2massets/[22m[36mbadge-Bk9h1F8N.js                     [39m[1m[2m    0.74 kB[22m[1m[22m[2m │ gzip:   0.40 kB[22m[2m │ map:     2.12 kB[22m
[2mdist/public/[22m[2massets/[22m[36mtram-front-CojfIv2T.js                [39m[1m[2m    0.74 kB[22m[1m[22m[2m │ gzip:   0.42 kB[22m[2m │ map:     2.78 kB[22m
[2mdist/public/[22m[2massets/[22m[36mpottery-CGy1Dt5X.js                   [39m[1m[2m    1.15 kB[22m[1m[22m[2m │ gzip:   0.50 kB[22m[2m │ map:     6.21 kB[22m
[2mdist/public/[22m[2massets/[22m[36mCategoryEditDialog-DI6g0MO7.js        [39m[1m[2m    1.24 kB[22m[1m[22m[2m │ gzip:   0.67 kB[22m[2m │ map:     5.36 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcollection-detail-field-Dzontny2.js   [39m[1m[2m    1.35 kB[22m[1m[22m[2m │ gzip:   0.66 kB[22m[2m │ map:     4.04 kB[22m
[2mdist/public/[22m[2massets/[22m[36mCollectionErrorState-BFgzJc_3.js      [39m[1m[2m    1.49 kB[22m[1m[22m[2m │ gzip:   0.87 kB[22m[2m │ map:     5.20 kB[22m
[2mdist/public/[22m[2massets/[22m[36mBlockPreviewSvg-Gxg8f51f.js           [39m[1m[2m    1.52 kB[22m[1m[22m[2m │ gzip:   0.85 kB[22m[2m │ map:     7.42 kB[22m
[2mdist/public/[22m[2massets/[22m[36mGalleryPaginator-DpmKHxRC.js          [39m[1m[2m    1.78 kB[22m[1m[22m[2m │ gzip:   0.88 kB[22m[2m │ map:     5.89 kB[22m
[2mdist/public/[22m[2massets/[22m[36mfabric-pipeline-B9Y8h-wH.js           [39m[1m[2m    1.95 kB[22m[1m[22m[2m │ gzip:   0.97 kB[22m[2m │ map:     5.06 kB[22m
[2mdist/public/[22m[2massets/[22m[36mLayoutPreviewSvg-B4KGpSuO.js          [39m[1m[2m    1.97 kB[22m[1m[22m[2m │ gzip:   1.07 kB[22m[2m │ map:     9.45 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcategory-selector-B7mNFQAO.js         [39m[1m[2m    2.03 kB[22m[1m[22m[2m │ gzip:   0.99 kB[22m[2m │ map:     6.98 kB[22m
[2mdist/public/[22m[2massets/[22m[36mwhole-quilt-storage-B7UFXKJZ.js       [39m[1m[2m    2.23 kB[22m[1m[22m[2m │ gzip:   1.05 kB[22m[2m │ map:    10.08 kB[22m
[2mdist/public/[22m[2massets/[22m[36mnot-found-C33IKAt8.js                 [39m[1m[2m    2.36 kB[22m[1m[22m[2m │ gzip:   0.99 kB[22m[2m │ map:     6.23 kB[22m
[2mdist/public/[22m[2massets/[22m[36mSvgCell-5Mp7tkpC.js                   [39m[1m[2m    2.49 kB[22m[1m[22m[2m │ gzip:   0.79 kB[22m[2m │ map:     9.56 kB[22m
[2mdist/public/[22m[2massets/[22m[36mRichTextEditor-COo-II4W.js            [39m[1m[2m    2.91 kB[22m[1m[22m[2m │ gzip:   1.08 kB[22m[2m │ map:     8.95 kB[22m
[2mdist/public/[22m[2massets/[22m[36mtag-selector-DEGZe67H.js              [39m[1m[2m    2.94 kB[22m[1m[22m[2m │ gzip:   1.34 kB[22m[2m │ map:    10.19 kB[22m
[2mdist/public/[22m[2massets/[22m[36mfabric-density-DmMJjMZG.js            [39m[1m[2m    3.11 kB[22m[1m[22m[2m │ gzip:   1.25 kB[22m[2m │ map:     7.88 kB[22m
[2mdist/public/[22m[2massets/[22m[36mfabric-compare-nEBbqqMQ.js            [39m[1m[2m    3.13 kB[22m[1m[22m[2m │ gzip:   1.44 kB[22m[2m │ map:     5.47 kB[22m
[2mdist/public/[22m[2massets/[22m[36mpdf-export-roID5lA8.js                [39m[1m[2m    3.61 kB[22m[1m[22m[2m │ gzip:   1.52 kB[22m[2m │ map:     8.18 kB[22m
[2mdist/public/[22m[2massets/[22m[36mMagnetCheckDialog-BO6MKGRd.js         [39m[1m[2m    3.87 kB[22m[1m[22m[2m │ gzip:   1.67 kB[22m[2m │ map:    11.71 kB[22m
[2mdist/public/[22m[2massets/[22m[36mCalendarCore-Vw8fzc5p.js              [39m[1m[2m    3.89 kB[22m[1m[22m[2m │ gzip:   1.57 kB[22m[2m │ map:    27.13 kB[22m
[2mdist/public/[22m[2massets/[22m[36mFabricPicker-VljuYywJ.js              [39m[1m[2m    3.99 kB[22m[1m[22m[2m │ gzip:   1.61 kB[22m[2m │ map:    13.87 kB[22m
[2mdist/public/[22m[2massets/[22m[36mimage-lightbox-DaSX5M4K.js            [39m[1m[2m    4.21 kB[22m[1m[22m[2m │ gzip:   1.47 kB[22m[2m │ map:    11.73 kB[22m
[2mdist/public/[22m[2massets/[22m[36mDocuments-2o1-_g6n.js                 [39m[1m[2m    4.41 kB[22m[1m[22m[2m │ gzip:   1.76 kB[22m[2m │ map:    12.39 kB[22m
[2mdist/public/[22m[2massets/[22m[36mtag-selector-CI0-e3FN.js              [39m[1m[2m    4.62 kB[22m[1m[22m[2m │ gzip:   1.85 kB[22m[2m │ map:    16.46 kB[22m
[2mdist/public/[22m[2massets/[22m[36mAttachmentPickerDialog-D-ojaSIk.js    [39m[1m[2m    4.71 kB[22m[1m[22m[2m │ gzip:   1.77 kB[22m[2m │ map:    16.15 kB[22m
[2mdist/public/[22m[2massets/[22m[36madd-DodJtw5e.js                       [39m[1m[2m    4.77 kB[22m[1m[22m[2m │ gzip:   2.15 kB[22m[2m │ map:    13.87 kB[22m
[2mdist/public/[22m[2massets/[22m[36mmessenger-DzihPR4u.js                 [39m[1m[2m    5.04 kB[22m[1m[22m[2m │ gzip:   2.06 kB[22m[2m │ map:    17.05 kB[22m
[2mdist/public/[22m[2massets/[22m[36mmaintenance-ChNwx5J0.js               [39m[1m[2m    5.06 kB[22m[1m[22m[2m │ gzip:   1.96 kB[22m[2m │ map:    13.19 kB[22m
[2mdist/public/[22m[2massets/[22m[36msvg-export-BY42awzm.js                [39m[1m[2m    5.08 kB[22m[1m[22m[2m │ gzip:   1.50 kB[22m[2m │ map:    17.51 kB[22m
[2mdist/public/[22m[2massets/[22m[36madd-5pwJp_lv.js                       [39m[1m[2m    5.15 kB[22m[1m[22m[2m │ gzip:   2.08 kB[22m[2m │ map:    15.05 kB[22m
[2mdist/public/[22m[2massets/[22m[36mPreviewZoomModal-HUAuitIH.js          [39m[1m[2m    5.16 kB[22m[1m[22m[2m │ gzip:   1.96 kB[22m[2m │ map:    15.41 kB[22m
[2mdist/public/[22m[2massets/[22m[36mbulk-add-C6eeyR1I.js                  [39m[1m[2m    5.22 kB[22m[1m[22m[2m │ gzip:   1.94 kB[22m[2m │ map:    13.63 kB[22m
[2mdist/public/[22m[2massets/[22m[36mnotes-D6fyUOBV.js                     [39m[1m[2m    5.26 kB[22m[1m[22m[2m │ gzip:   1.98 kB[22m[2m │ map:    16.20 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcompare-BCHdZKPT.js                   [39m[1m[2m    5.66 kB[22m[1m[22m[2m │ gzip:   2.06 kB[22m[2m │ map:    13.55 kB[22m
[2mdist/public/[22m[2massets/[22m[36mwhole-quilt-list-De9NtteI.js          [39m[1m[2m    5.79 kB[22m[1m[22m[2m │ gzip:   2.29 kB[22m[2m │ map:    16.24 kB[22m
[2mdist/public/[22m[2massets/[22m[36mfabric-size-CE-xzeSg.js               [39m[1m[2m    6.07 kB[22m[1m[22m[2m │ gzip:   1.81 kB[22m[2m │ map:    15.13 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcompare-DjG3FO26.js                   [39m[1m[2m    6.09 kB[22m[1m[22m[2m │ gzip:   2.17 kB[22m[2m │ map:    13.95 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcamera-add-Bh2cJq3V.js                [39m[1m[2m    6.13 kB[22m[1m[22m[2m │ gzip:   2.22 kB[22m[2m │ map:    16.13 kB[22m
[2mdist/public/[22m[2massets/[22m[36mPrivacyPolicy-CHQDS66u.js             [39m[1m[2m    6.16 kB[22m[1m[22m[2m │ gzip:   2.09 kB[22m[2m │ map:    10.43 kB[22m
[2mdist/public/[22m[2massets/[22m[36mPaletteMatchModal-CKDdTO5r.js         [39m[1m[2m    6.21 kB[22m[1m[22m[2m │ gzip:   2.06 kB[22m[2m │ map:    18.78 kB[22m
[2mdist/public/[22m[2massets/[22m[36mTripShare-C20w-qGX.js                 [39m[1m[2m    6.83 kB[22m[1m[22m[2m │ gzip:   2.37 kB[22m[2m │ map:    18.36 kB[22m
[2mdist/public/[22m[2massets/[22m[36madd-5-3Ped_U.js                       [39m[1m[2m    6.84 kB[22m[1m[22m[2m │ gzip:   2.74 kB[22m[2m │ map:    19.21 kB[22m
[2mdist/public/[22m[2massets/[22m[36mMergeDialog-B__Bza2m.js               [39m[1m[2m    7.04 kB[22m[1m[22m[2m │ gzip:   2.53 kB[22m[2m │ map:    23.07 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcategories-Cs6pCiqa.js                [39m[1m[2m    7.10 kB[22m[1m[22m[2m │ gzip:   2.62 kB[22m[2m │ map:    22.52 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcell-parser-Bv2a8iBG.js               [39m[1m[2m    7.11 kB[22m[1m[22m[2m │ gzip:   2.41 kB[22m[2m │ map:    35.24 kB[22m
[2mdist/public/[22m[2massets/[22m[36mdetail-KIsaA4x6.js                    [39m[1m[2m    7.23 kB[22m[1m[22m[2m │ gzip:   2.48 kB[22m[2m │ map:    22.02 kB[22m
[2mdist/public/[22m[2massets/[22m[36mExplore-BnTzc48k.js                   [39m[1m[2m    7.34 kB[22m[1m[22m[2m │ gzip:   2.26 kB[22m[2m │ map:    19.31 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcalendar-BkGahO4b.js                  [39m[1m[2m    7.77 kB[22m[1m[22m[2m │ gzip:   2.88 kB[22m[2m │ map:    28.22 kB[22m
[2mdist/public/[22m[2massets/[22m[36mwatchlist-ZXxGdrBw.js                 [39m[1m[2m    7.78 kB[22m[1m[22m[2m │ gzip:   2.64 kB[22m[2m │ map:    21.25 kB[22m
[2mdist/public/[22m[2massets/[22m[36mstats-fLHcjLtS.js                     [39m[1m[2m    8.02 kB[22m[1m[22m[2m │ gzip:   2.88 kB[22m[2m │ map:    25.40 kB[22m
[2mdist/public/[22m[2massets/[22m[36mscan-Dj7Brqwf.js                      [39m[1m[2m    8.22 kB[22m[1m[22m[2m │ gzip:   3.01 kB[22m[2m │ map:    22.46 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcategories-_g5sHnTi.js                [39m[1m[2m    9.10 kB[22m[1m[22m[2m │ gzip:   3.22 kB[22m[2m │ map:    28.33 kB[22m
[2mdist/public/[22m[2massets/[22m[36madd-DzVUMe4u.js                       [39m[1m[2m    9.17 kB[22m[1m[22m[2m │ gzip:   3.34 kB[22m[2m │ map:    28.94 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcategories-BVbdHpZ0.js                [39m[1m[2m    9.28 kB[22m[1m[22m[2m │ gzip:   2.96 kB[22m[2m │ map:    28.57 kB[22m
[2mdist/public/[22m[2massets/[22m[36mscan-9V3NxfSL.js                      [39m[1m[2m    9.32 kB[22m[1m[22m[2m │ gzip:   3.44 kB[22m[2m │ map:    28.96 kB[22m
[2mdist/public/[22m[2massets/[22m[36m_shared-kJGUfmGD.js                   [39m[1m[2m    9.78 kB[22m[1m[22m[2m │ gzip:   3.75 kB[22m[2m │ map:    36.09 kB[22m
[2mdist/public/[22m[2massets/[22m[36mindex-DjMT58wU.js                     [39m[1m[2m   10.03 kB[22m[1m[22m[2m │ gzip:   3.22 kB[22m[2m │ map:    28.62 kB[22m
[2mdist/public/[22m[2massets/[22m[36mblocks-DmECbX5t.js                    [39m[1m[2m   10.10 kB[22m[1m[22m[2m │ gzip:   3.47 kB[22m[2m │ map:    28.32 kB[22m
[2mdist/public/[22m[2massets/[22m[36mCollectionPageShell-C1VFzwNl.js       [39m[1m[2m   10.12 kB[22m[1m[22m[2m │ gzip:   3.63 kB[22m[2m │ map:    35.61 kB[22m
[2mdist/public/[22m[2massets/[22m[36mimage-picker-BFJT_vV_.js              [39m[1m[2m   10.32 kB[22m[1m[22m[2m │ gzip:   3.54 kB[22m[2m │ map:    31.56 kB[22m
[2mdist/public/[22m[2massets/[22m[36mdetail-OxKW4fMr.js                    [39m[1m[2m   10.60 kB[22m[1m[22m[2m │ gzip:   3.40 kB[22m[2m │ map:    32.22 kB[22m
[2mdist/public/[22m[2massets/[22m[36mWishlist-CuR_92J0.js                  [39m[1m[2m   10.76 kB[22m[1m[22m[2m │ gzip:   3.78 kB[22m[2m │ map:    34.30 kB[22m
[2mdist/public/[22m[2massets/[22m[36mstats-CmKqomNo.js                     [39m[1m[2m   10.94 kB[22m[1m[22m[2m │ gzip:   3.67 kB[22m[2m │ map:    39.08 kB[22m
[2mdist/public/[22m[2massets/[22m[36madd-Yw4iacR4.js                       [39m[1m[2m   11.32 kB[22m[1m[22m[2m │ gzip:   3.75 kB[22m[2m │ map:    35.47 kB[22m
[2mdist/public/[22m[2massets/[22m[36mfabric-photo-preview-BvuMQ0Xl.js      [39m[1m[2m   11.54 kB[22m[1m[22m[2m │ gzip:   4.31 kB[22m[2m │ map:    39.76 kB[22m
[2mdist/public/[22m[2massets/[22m[36mReminderEditDialog-DOGAFTWW.js        [39m[1m[2m   11.78 kB[22m[1m[22m[2m │ gzip:   3.85 kB[22m[2m │ map:    41.44 kB[22m
[2mdist/public/[22m[2massets/[22m[36mmaintenance-CLx_z2sN.js               [39m[1m[2m   12.13 kB[22m[1m[22m[2m │ gzip:   3.96 kB[22m[2m │ map:    35.25 kB[22m
[2mdist/public/[22m[2massets/[22m[36mbarcode-lookup-BAVk9RM-.js            [39m[1m[2m   12.27 kB[22m[1m[22m[2m │ gzip:   3.99 kB[22m[2m │ map:    35.76 kB[22m
[2mdist/public/[22m[2massets/[22m[36mtravels-B7yDkVsD.js                   [39m[1m[2m   12.78 kB[22m[1m[22m[2m │ gzip:   2.76 kB[22m[2m │ map:    95.35 kB[22m
[2mdist/public/[22m[2massets/[22m[36mimage-editor-BG5Xg1C0.js              [39m[1m[2m   12.99 kB[22m[1m[22m[2m │ gzip:   4.81 kB[22m[2m │ map:    53.85 kB[22m
[2mdist/public/[22m[2massets/[22m[36mFabricCreaseRemoverModal-yO8HdsXq.js  [39m[1m[2m   13.42 kB[22m[1m[22m[2m │ gzip:   4.53 kB[22m[2m │ map:    48.74 kB[22m
[2mdist/public/[22m[2massets/[22m[36mindex-BwiTNmyx.js                     [39m[1m[2m   13.65 kB[22m[1m[22m[2m │ gzip:   4.65 kB[22m[2m │ map:    42.75 kB[22m
[2mdist/public/[22m[2massets/[22m[36mhallmark-events-b9ss_bVu.js           [39m[1m[2m   14.02 kB[22m[1m[22m[2m │ gzip:   4.72 kB[22m[2m │ map:    49.13 kB[22m
[2mdist/public/[22m[2massets/[22m[36mindex-C_QY3dPL.js                     [39m[1m[2m   14.65 kB[22m[1m[22m[2m │ gzip:   4.66 kB[22m[2m │ map:    46.64 kB[22m
[2mdist/public/[22m[2massets/[22m[36mDashboard-BM7PWgKs.js                 [39m[1m[2m   15.17 kB[22m[1m[22m[2m │ gzip:   5.04 kB[22m[2m │ map:    48.54 kB[22m
[2mdist/public/[22m[2massets/[22m[36myardage-DxVYlj-c.js                   [39m[1m[2m   15.39 kB[22m[1m[22m[2m │ gzip:   4.67 kB[22m[2m │ map:    46.23 kB[22m
[2mdist/public/[22m[2massets/[22m[36mWorldMap-Bz0wNKYi.js                  [39m[1m[2m   15.40 kB[22m[1m[22m[2m │ gzip:   5.32 kB[22m[2m │ map:    45.98 kB[22m
[2mdist/public/[22m[2massets/[22m[36mmaintenance-B6utagj7.js               [39m[1m[2m   16.24 kB[22m[1m[22m[2m │ gzip:   5.38 kB[22m[2m │ map:    44.52 kB[22m
[2mdist/public/[22m[2massets/[22m[36mindex-CAdEdEz9.js                     [39m[1m[2m   16.81 kB[22m[1m[22m[2m │ gzip:   5.42 kB[22m[2m │ map:    61.73 kB[22m
[2mdist/public/[22m[2massets/[22m[36mdetail-YFPlyvvR.js                    [39m[1m[2m   18.00 kB[22m[1m[22m[2m │ gzip:   5.21 kB[22m[2m │ map:    55.01 kB[22m
[2mdist/public/[22m[2massets/[22m[36mindex-mhEux9U9.js                     [39m[1m[2m   18.47 kB[22m[1m[22m[2m │ gzip:   6.30 kB[22m[2m │ map:    67.49 kB[22m
[2mdist/public/[22m[2massets/[22m[36mDestinations-DxtcTX3h.js              [39m[1m[2m   18.97 kB[22m[1m[22m[2m │ gzip:   4.64 kB[22m[2m │ map:    51.00 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcut-pattern-OFPfHKBo.js               [39m[1m[2m   20.37 kB[22m[1m[22m[2m │ gzip:   6.09 kB[22m[2m │ map:    64.20 kB[22m
[2mdist/public/[22m[2massets/[22m[36mTravelCalendar-CNzOrORc.js            [39m[1m[2m   20.79 kB[22m[1m[22m[2m │ gzip:   6.07 kB[22m[2m │ map:    73.44 kB[22m
[2mdist/public/[22m[2massets/[22m[36mdetail-DvFI4fWZ.js                    [39m[1m[2m   21.96 kB[22m[1m[22m[2m │ gzip:   6.13 kB[22m[2m │ map:    67.77 kB[22m
[2mdist/public/[22m[2massets/[22m[36mTrips-ThMwoOmy.js                     [39m[1m[2m   22.26 kB[22m[1m[22m[2m │ gzip:   6.91 kB[22m[2m │ map:    73.34 kB[22m
[2mdist/public/[22m[2massets/[22m[36mGmailReview-ClOYNEqE.js               [39m[1m[2m   22.84 kB[22m[1m[22m[2m │ gzip:   6.48 kB[22m[2m │ map:    68.61 kB[22m
[2mdist/public/[22m[2massets/[22m[36mdetail-B7c5p5_R.js                    [39m[1m[2m   26.21 kB[22m[1m[22m[2m │ gzip:   7.56 kB[22m[2m │ map:    86.39 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcomposer-Ce5my2WS.js                  [39m[1m[2m   26.53 kB[22m[1m[22m[2m │ gzip:   8.20 kB[22m[2m │ map:    97.12 kB[22m
[2mdist/public/[22m[2massets/[22m[36mdetail-mZoOe84Z.js                    [39m[1m[2m   26.88 kB[22m[1m[22m[2m │ gzip:   7.59 kB[22m[2m │ map:    84.11 kB[22m
[2mdist/public/[22m[2massets/[22m[36mdetail-B4QmwED3.js                    [39m[1m[2m   27.08 kB[22m[1m[22m[2m │ gzip:   7.29 kB[22m[2m │ map:    87.07 kB[22m
[2mdist/public/[22m[2massets/[22m[36mindex-CfznvkvX.js                     [39m[1m[2m   28.16 kB[22m[1m[22m[2m │ gzip:   8.39 kB[22m[2m │ map:    88.78 kB[22m
[2mdist/public/[22m[2massets/[22m[36mpurify.es-VaSPOPhr.js                 [39m[1m[2m   28.72 kB[22m[1m[22m[2m │ gzip:  10.77 kB[22m[2m │ map:   159.07 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcollection-Ckqgvy5P.js                [39m[1m[2m   33.58 kB[22m[1m[22m[2m │ gzip:   9.51 kB[22m[2m │ map:   109.12 kB[22m
[2mdist/public/[22m[2massets/[22m[36mcollection-DMVIj2A_.js                [39m[1m[2m   33.96 kB[22m[1m[22m[2m │ gzip:   9.89 kB[22m[2m │ map:   108.01 kB[22m
[2mdist/public/[22m[2massets/[22m[36mwhole-quilt-DmDt6kJu.js               [39m[1m[2m   44.74 kB[22m[1m[22m[2m │ gzip:  11.67 kB[22m[2m │ map:   151.75 kB[22m
[2mdist/public/[22m[2massets/[22m[36mgmail-Cvj516PH.js                     [39m[1m[2m   48.41 kB[22m[1m[22m[2m │ gzip:  13.73 kB[22m[2m │ map:   162.87 kB[22m
[2mdist/public/[22m[2massets/[22m[36mtypes-DO2lrS5d.js                     [39m[1m[2m   54.83 kB[22m[1m[22m[2m │ gzip:  12.84 kB[22m[2m │ map:   228.46 kB[22m
[2mdist/public/[22m[2massets/[22m[36mdesigner-Cmm4a4zV.js                  [39m[1m[2m   98.14 kB[22m[1m[22m[2m │ gzip:  27.27 kB[22m[2m │ map:   364.88 kB[22m
[2mdist/public/[22m[2massets/[22m[36mindex.es-BarpgOM1.js                  [39m[1m[2m  158.87 kB[22m[1m[22m[2m │ gzip:  53.07 kB[22m[2m │ map:   650.67 kB[22m
[2mdist/public/[22m[2massets/[22m[36mTripDetail-zC3uzIYB.js                [39m[1m[2m  171.28 kB[22m[1m[22m[2m │ gzip:  49.73 kB[22m[2m │ map:   651.97 kB[22m
[2mdist/public/[22m[2massets/[22m[36mhtml2canvas.esm-DXEQVQnt.js           [39m[1m[2m  201.04 kB[22m[1m[22m[2m │ gzip:  47.43 kB[22m[2m │ map:   602.76 kB[22m
[2mdist/public/[22m[2massets/[22m[36mindex-BxJjTjC5.js                     [39m[1m[2m  309.61 kB[22m[1m[22m[2m │ gzip:  93.79 kB[22m[2m │ map: 1,409.79 kB[22m
[2mdist/public/[22m[2massets/[22m[36mBarChart-DQ80ziq8.js                  [39m[1m[2m  343.89 kB[22m[1m[22m[2m │ gzip:  93.54 kB[22m[2m │ map: 1,503.88 kB[22m
[2mdist/public/[22m[2massets/[22m[36mpdf-export-PK508CU1.js                [39m[1m[2m  387.77 kB[22m[1m[22m[2m │ gzip: 127.10 kB[22m[2m │ map: 1,309.20 kB[22m
[2mdist/public/[22m[2massets/[22m[36mindex-CIjeZW9P.js                     [39m[1m[2m  416.49 kB[22m[1m[22m[2m │ gzip: 110.27 kB[22m[2m │ map: 2,058.37 kB[22m
[2mdist/public/[22m[2massets/[22m[36mindex-o9u8wlr5.js                     [39m[1m[33m  996.04 kB[39m[22m[2m │ gzip: 293.21 kB[22m[2m │ map: 4,881.07 kB[22m
[33m
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m
[32m✓ built in 14.69s[39m
```

Exit code: 0
