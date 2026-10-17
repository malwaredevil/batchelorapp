import OpenAI from "openai";
import { Sentry } from "./sentry";

/**
 * Optional enrichment callers must catch lookup failures and preserve saved
 * data. OpenAI's instrumentation captures errors before that catch runs, so
 * classify only its timeout event as a handled warning, not an app crash.
 * Keep the event (and normal request timing), rather than suppressing failures.
 */
export function classifyOptionalLookupTimeout(
  event: Sentry.Event,
  hint: Sentry.EventHint,
): Sentry.Event {
  const exceptions = event.exception?.values;
  if (
    !(hint.originalException instanceof OpenAI.APIConnectionTimeoutError) ||
    !exceptions?.length ||
    !exceptions.every((value) => value.mechanism?.type === "auto.ai.openai")
  ) {
    return event;
  }
  return {
    ...event,
    level: "warning",
    exception: {
      ...event.exception,
      values: exceptions.map((value) => ({
        ...value,
        mechanism: { ...value.mechanism!, handled: true },
      })),
    },
  };
}

export function withOptionalAILookup<T>(lookup: () => Promise<T>): Promise<T> {
  return Sentry.withScope((scope) => {
    scope.setTag("ai.lookup.optional", "true");
    scope.addEventProcessor(classifyOptionalLookupTimeout);
    return lookup();
  });
}
