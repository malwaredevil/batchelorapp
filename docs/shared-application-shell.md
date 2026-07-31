# Shared Application Shell

Batchelor App has three separately built React SPAs, but they present one
authenticated household application. Global application chrome therefore lives
in `@workspace/app-shell`; it must not be copied into an artifact.

## Ownership boundary

`ApplicationHeader` owns behavior that must be identical everywhere:

- app switching;
- theme control;
- Gmail and calendar shortcuts;
- Messenger access;
- authenticated identity and avatar;
- Account settings;
- owner-gated Owner Panel access;
- query-aware sign out.

`ThemePreferenceSync` applies the authenticated account's stored theme in each
SPA. Each SPA must mount it once inside its authoritative `AuthProvider` and
`ThemeProvider`.

## Composition contract

Artifacts provide only specialized content through typed props:

- `currentAppId` identifies the active app;
- `navigation` supplies app-owned routes;
- `primaryAction` supplies a Hub search or similar app action;
- `notificationAction` supplies an optional shared/global indicator;
- `mobileNavigationAction` opens an app-owned mobile drawer;
- `progressIndicator` reports app-owned background work.

The shell must not acquire domain-name conditionals. If Pottery or Elaine needs
specialized navigation, that artifact composes the specialized node into a slot.
If an action should exist everywhere, it belongs in `ApplicationHeader` or
`AccountMenu`.

## Artifact adapters

- Hub composes its global-search trigger.
- Modules composes grouped domain navigation, the notification bell, mobile
  navigation, and background-task progress.
- Elaine composes its wordmark and Chat/Memory/Tasks/Settings navigation.

These adapters may transform route registries into React nodes, but they may not
render another global `<header>` or independently implement account, owner,
theme, communication, or sign-out behavior.

## Navigation boundaries

Routes crossing SPA bundles use full browser navigation. Routes inside the
current Wouter SPA may use client-side navigation. Owner Panel receives the
current path as a validated `from` parameter so its Back action returns to the
originating app.

## Regression guard

`pnpm --filter @workspace/scripts run check-app-shell` verifies that all three
SPA adapters compose `ApplicationHeader`, that every SPA has exactly one
authoritative auth provider and theme sync, and that global account-menu text
does not drift back into artifact code. Page-local headers, printable headers,
dialog headers, and domain-specific toolbars remain allowed.
