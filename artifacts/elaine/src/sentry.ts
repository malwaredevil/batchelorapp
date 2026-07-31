import { initBrowserMonitoring } from "@workspace/web-core/sentry";

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const release = import.meta.env.VITE_APP_VERSION as string | undefined;

initBrowserMonitoring({
  dsn,
  release,
  enabled: import.meta.env.PROD,
});
