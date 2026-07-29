export type StartupComponentStatus = "pending" | "ok" | "failed";
export type StartupStatus = "starting" | "ready" | "failed";

export interface StartupState {
  status: StartupStatus;
  migration: StartupComponentStatus;
  buckets: StartupComponentStatus;
  errorCode?: string;
}

const state: StartupState = {
  status: "starting",
  migration: "pending",
  buckets: "pending",
};

export function markMigrationReady(): void {
  state.migration = "ok";
}

export function markBucketsReady(): void {
  state.buckets = "ok";
}

export function markStartupReady(): void {
  if (state.migration !== "ok" || state.buckets !== "ok") {
    throw new Error(
      "Cannot mark startup ready before all components are ready",
    );
  }
  state.status = "ready";
  delete state.errorCode;
}

export function markStartupFailed(
  component: "migration" | "buckets",
  errorCode: string,
): void {
  state[component] = "failed";
  state.status = "failed";
  state.errorCode = errorCode;
}

export function isStartupReady(): boolean {
  return state.status === "ready";
}

export function getStartupState(): Readonly<StartupState> {
  return { ...state };
}
