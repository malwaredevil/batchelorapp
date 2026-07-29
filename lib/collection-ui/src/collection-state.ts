import { useCallback, useState } from "react";

export function readValidatedPageSize(
  storageKey: string,
  options: readonly number[],
  fallback: number,
): number {
  if (typeof window === "undefined") return fallback;
  const parsed = Number(window.localStorage.getItem(storageKey));
  return Number.isFinite(parsed) && options.includes(parsed)
    ? parsed
    : fallback;
}

export function useValidatedCollectionPageSize(
  storageKey: string,
  options: readonly number[],
  fallback: number,
): readonly [number, (next: number) => void] {
  const [value, setValue] = useState(() =>
    readValidatedPageSize(storageKey, options, fallback),
  );
  const update = useCallback(
    (next: number) => {
      const safe = options.includes(next) ? next : fallback;
      setValue(safe);
      window.localStorage.setItem(storageKey, String(safe));
    },
    [fallback, options, storageKey],
  );
  return [value, update] as const;
}
