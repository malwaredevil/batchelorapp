import { useRef, useEffect, useCallback, type ReactNode } from "react";

type GuardFn = (to: string) => void;

// Module-level singleton — no React context, no ref-in-context, nothing
// that can silently disconnect across renders or HMR cycles.
let _guard: GuardFn | null = null;

// Kept for API compatibility; App.tsx wraps with this but it's now a no-op shell.
export function NavGuardProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/**
 * Use in AppShell. Returns a stable navigate function that invokes the
 * active guard (if any) instead of navigating directly.
 */
export function useGuardedNavigate(
  navigate: (to: string) => void,
): (to: string) => void {
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Stable callback — reads _guard at call-time, always sees the latest value.
  return useCallback((to: string) => {
    if (_guard) {
      _guard(to);
    } else {
      navigateRef.current(to);
    }
  }, []);
}

/**
 * Call in a designer page. While the page is mounted, all guarded navigation
 * in AppShell will call `fn` instead of navigating. Clears automatically on
 * unmount. `fn` is kept fresh via a ref so stale closures are never an issue.
 */
export function useRegisterNavGuard(fn: GuardFn | null): void {
  const fnRef = useRef(fn);
  fnRef.current = fn; // updated on every render — always the latest closure

  useEffect(() => {
    _guard = fn ? (to: string) => fnRef.current?.(to) : null;
    return () => {
      _guard = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
