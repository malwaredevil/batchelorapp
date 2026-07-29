# PR 2 validation

Generated after the transactional Slack test repair.

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
artifacts/api-server typecheck: Done
scripts typecheck: Done
artifacts/web typecheck: Done
artifacts/modules typecheck: Done
```

Exit code: 0

## API tests
```text

> @workspace/api-server@0.0.0 test /home/runner/work/batchelorapp/batchelorapp/artifacts/api-server
> vitest run


[1m[46m RUN [49m[22m [36mv3.2.6 [39m[90m/home/runner/work/batchelorapp/batchelorapp/artifacts/api-server[39m

 [32m✓[39m src/lib/app-config-bootstrap.test.ts [2m([22m[2m23 tests[22m[2m)[22m[33m 1031[2mms[22m[39m
   [33m[2m✓[22m[39m rowNeedsLabelSync() — drift predicate[2m > [22mreturns true when the row's label differs from the default [33m 944[2mms[22m[39m
 [32m✓[39m src/lib/app-config-drift.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 269[2mms[22m[39m
 [32m✓[39m src/routes/config.test.ts [2m([22m[2m45 tests[22m[2m)[22m[33m 1225[2mms[22m[39m
   [33m[2m✓[22m[39m bootstrapDefaults — step coverage and error classification[2m > [22mcalls db.delete, db.insert, and db.update during bootstrap [33m 871[2mms[22m[39m
 [32m✓[39m src/routes/agentphone.test.ts [2m([22m[2m29 tests[22m[2m)[22m[33m 920[2mms[22m[39m
[90mstdout[2m | src/routes/upload-rejection.test.ts[2m > [22m[2mTravels POST /api/travels/trips/:id/documents — upload rejection[2m > [22m[2maccepts a valid PDF and returns 201
[22m[39mWarning: Indexing all PDF objects

 [32m✓[39m src/routes/upload-rejection.test.ts [2m([22m[2m32 tests[22m[2m | [22m[33m4 skipped[39m[2m)[22m[33m 1578[2mms[22m[39m
 [32m✓[39m src/routes/supplemental-upload-rejection.test.ts [2m([22m[2m31 tests[22m[2m)[22m[33m 1477[2mms[22m[39m
 [32m✓[39m src/middleware/uploadSizeGuard.test.ts [2m([22m[2m16 tests[22m[2m | [22m[33m1 skipped[39m[2m)[22m[32m 240[2mms[22m[39m
 [32m✓[39m src/routes/travels/gmail.test.ts [2m([22m[2m35 tests[22m[2m)[22m[33m 1140[2mms[22m[39m
 [32m✓[39m src/routes/elaine-email.test.ts [2m([22m[2m20 tests[22m[2m)[22m[33m 969[2mms[22m[39m
[90mstderr[2m | src/lib/storage-reconcile.test.ts
[22m[39mUsing an object as a third argument is deprecated. Vitest 4 will throw an error if the third argument is not a timeout number. Please use the second argument for options. See more at https://vitest.dev/guide/migration

 [32m✓[39m src/lib/storage-reconcile.test.ts [2m([22m[2m25 tests[22m[2m)[22m[32m 21[2mms[22m[39m
 [32m✓[39m src/lib/reminder-scheduler.test.ts [2m([22m[2m38 tests[22m[2m)[22m[32m 45[2mms[22m[39m
 [32m✓[39m src/routes/slack.test.ts [2m([22m[2m12 tests[22m[2m)[22m[33m 582[2mms[22m[39m
   [33m[2m✓[22m[39m Slack webhook — job-queue path (#308)[2m > [22menqueues a slack.turn job for a valid inbound DM and returns 200 [33m 511[2mms[22m[39m
 [32m✓[39m src/routes/travels/documents.test.ts [2m([22m[2m20 tests[22m[2m)[22m[33m 969[2mms[22m[39m
 [32m✓[39m src/routes/auth.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 1443[2mms[22m[39m
 [32m✓[39m src/elaine/update-app-config-action.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 1700[2mms[22m[39m
 [32m✓[39m src/routes/messenger/link-preview.test.ts [2m([22m[2m9 tests[22m[2m)[22m[33m 904[2mms[22m[39m
 [32m✓[39m src/lib/jobs/worker.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 61[2mms[22m[39m
 [32m✓[39m src/routes/pool-concurrency.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 1693[2mms[22m[39m
 [32m✓[39m src/routes/travels/settings.test.ts [2m([22m[2m22 tests[22m[2m)[22m[33m 1053[2mms[22m[39m
[09:46:43.367] [31mERROR[39m (2981): [36msettings: test reminder email failed[39m
    [35muserId[39m: 42
    err: {
      "type": "Error",
      "message": "Resend API error",
      "stack":
          Error: Resend API error
              at /home/runner/work/batchelorapp/batchelorapp/artifacts/api-server/src/routes/travels/settings.test.ts:366:7
              at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:155:11
              at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:752:26
              at file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1897:20
              at new Promise (<anonymous>)
              at runWithTimeout (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1863:10)
              at runTest (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1574:12)
              at processTicksAndRejections (node:internal/process/task_queues:104:5)
              at runSuite (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1729:8)
              at runSuite (file:///home/runner/work/batchelorapp/batchelorapp/node_modules/.pnpm/@vitest+runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js:1729:8)
    }
 [32m✓[39m src/routes/admin/storage-reconcile.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 59[2mms[22m[39m
 [32m✓[39m src/routes/slack-reliability.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 4[2mms[22m[39m
 [32m✓[39m src/middleware/webhookLimiter.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 673[2mms[22m[39m
   [33m[2m✓[22m[39m webhookLimiter — namespace / key prefix[2m > [22mPostgresRateLimitStore constructor is called with 'webhook' in production config [33m 618[2mms[22m[39m
 [32m✓[39m src/lib/jobs/registry.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 4[2mms[22m[39m
 [32m✓[39m src/lib/operations.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 3[2mms[22m[39m
 [32m✓[39m src/middleware/app-upload-guard.test.ts [2m([22m[2m3 tests[22m[2m)[22m[33m 4056[2mms[22m[39m

[2m Test Files [22m [1m[32m25 passed[39m[22m[90m (25)[39m
[2m      Tests [22m [1m[32m414 passed[39m[22m[2m | [22m[33m5 skipped[39m[90m (419)[39m
[2m   Start at [22m 09:46:33
[2m   Duration [22m 13.60s[2m (transform 2.35s, setup 0ms, collect 6.58s, tests 22.12s, environment 6ms, prepare 2.02s)[22m

```

Exit code: 0
