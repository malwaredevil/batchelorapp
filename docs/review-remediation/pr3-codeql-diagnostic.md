# PR 3 CodeQL diagnostic

Exact check-run metadata and annotations captured from GitHub.

## Check summary

- name: CodeQL
- status: completed
- conclusion: failure
- details: https://github.com/malwaredevil/batchelorapp/runs/90549060948
- title: 15 new alerts including 15 high severity security vulnerabilities
- summary: ### New alerts in code changed by this pull request  Security Alerts:  * 15 high   See annotations below for details.  [View all branch alerts](/malwaredevil/batchelorapp/security/code-scanning?query=pr%3A348+tool%3ACodeQL+is%3Aopen).

## Annotations

- level=failure path=artifacts/api-server/src/lib/category-router-factory.ts lines=230-230 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
- level=failure path=artifacts/api-server/src/routes/config.ts lines=23-23 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
- level=failure path=artifacts/api-server/src/routes/hub.ts lines=613-613 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
- level=failure path=artifacts/api-server/src/routes/hub.ts lines=646-646 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
- level=failure path=artifacts/api-server/src/routes/messenger/index.ts lines=12-12 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
- level=failure path=artifacts/api-server/src/routes/notifications.ts lines=18-18 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
- level=failure path=artifacts/api-server/src/routes/ornaments/hallmark-events.ts lines=23-23 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
- level=failure path=artifacts/api-server/src/routes/pottery/watchlist.ts lines=26-26 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
- level=failure path=artifacts/api-server/src/routes/quilting/analyses.ts lines=35-35 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
- level=failure path=artifacts/api-server/src/routes/quilting/fabric-identity.ts lines=28-28 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
- level=failure path=artifacts/api-server/src/routes/quilting/lab.ts lines=30-30 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
- level=failure path=artifacts/api-server/src/routes/travels/changes.ts lines=16-16 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
- level=failure path=artifacts/api-server/src/routes/travels/document-evidence.ts lines=17-17 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
- level=failure path=artifacts/api-server/src/routes/travels/monitoring-preferences.ts lines=8-8 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
- level=failure path=artifacts/api-server/src/routes/travels/reservations.ts lines=23-23 title=Missing rate limiting message=This route handler performs [authorization](1), but is not rate-limited. details=
