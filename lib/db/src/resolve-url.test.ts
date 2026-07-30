/**
 * Unit tests for resolveDatabaseUrl() — the connection-pool fix that switches
 * all Supabase connections from session mode (port 5432) to transaction mode
 * (port 6543).
 *
 * WHY THIS MATTERS
 * ----------------
 * Supabase's session-mode pooler holds a real server connection open for the
 * full lifetime of each pg.Pool slot.  With only 15 session-mode connections
 * available the pool was exhausted under normal household browsing, producing
 * the EMAXCONNSESSION errors tracked in Sentry as NODE-EXPRESS-3 and
 * NODE-EXPRESS-K.
 *
 * Transaction mode (port 6543) releases the Supabase connection as soon as
 * each query or transaction completes, so idle slots in our local pool cost
 * nothing on the Supabase side.  This test suite ensures that no future
 * change to resolveDatabaseUrl() accidentally reverts to session mode.
 *
 * LIMIT REMINDER
 * --------------
 * Supabase caps session-mode connections at 15.  Even a small number of
 * concurrent long-running queries can exhaust that cap.  Always use port 6543
 * (transaction mode) for the application pool and never override
 * SUPABASE_POOLER_PORT to 5432 in production.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveDatabaseUrl } from "./resolve-url";

// ── Helpers ──────────────────────────────────────────────────────────────────

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void,
): void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("resolveDatabaseUrl — direct host rewriting", () => {
  it("rewrites a direct Supabase host to the pooler with transaction-mode port 6543", () => {
    withEnv(
      {
        DATABASE_URL:
          "postgresql://postgres:password@db.abcdefghijkl.supabase.co:5432/postgres",
        SUPABASE_POOLER_HOST: undefined,
        SUPABASE_POOLER_REGION: undefined,
        SUPABASE_POOLER_PORT: undefined,
      },
      () => {
        const url = new URL(resolveDatabaseUrl());
        expect(url.hostname).toMatch(/pooler\.supabase\.com$/);
        expect(url.port).toBe("6543");
        expect(url.username).toBe("postgres.abcdefghijkl");
      },
    );
  });

  it("preserves the password through the rewrite", () => {
    withEnv(
      {
        DATABASE_URL:
          "postgresql://postgres:s3cr3t!@db.abcdefghijkl.supabase.co:5432/postgres",
        SUPABASE_POOLER_HOST: undefined,
        SUPABASE_POOLER_REGION: undefined,
        SUPABASE_POOLER_PORT: undefined,
      },
      () => {
        const url = new URL(resolveDatabaseUrl());
        expect(decodeURIComponent(url.password)).toBe("s3cr3t!");
      },
    );
  });

  it("extracts the project ref from the direct host and embeds it in the username", () => {
    withEnv(
      {
        DATABASE_URL:
          "postgresql://postgres:pw@db.myprojectref.supabase.co:5432/postgres",
        SUPABASE_POOLER_HOST: undefined,
        SUPABASE_POOLER_REGION: undefined,
        SUPABASE_POOLER_PORT: undefined,
      },
      () => {
        const url = new URL(resolveDatabaseUrl());
        expect(url.username).toBe("postgres.myprojectref");
      },
    );
  });

  it("respects SUPABASE_POOLER_HOST override", () => {
    withEnv(
      {
        DATABASE_URL:
          "postgresql://postgres:pw@db.abcdefghijkl.supabase.co:5432/postgres",
        SUPABASE_POOLER_HOST: "custom-pooler.example.com",
        SUPABASE_POOLER_REGION: undefined,
        SUPABASE_POOLER_PORT: undefined,
      },
      () => {
        const url = new URL(resolveDatabaseUrl());
        expect(url.hostname).toBe("custom-pooler.example.com");
        expect(url.port).toBe("6543");
      },
    );
  });
});

describe("resolveDatabaseUrl — already-pooler URL enforcement", () => {
  it("keeps port 6543 when the URL already targets the pooler with transaction mode", () => {
    withEnv(
      {
        DATABASE_URL:
          "postgresql://postgres.abcdef:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
        SUPABASE_POOLER_HOST: undefined,
        SUPABASE_POOLER_REGION: undefined,
        SUPABASE_POOLER_PORT: undefined,
      },
      () => {
        const url = new URL(resolveDatabaseUrl());
        expect(url.port).toBe("6543");
      },
    );
  });

  it("upgrades port 5432 → 6543 when an already-pooler URL accidentally uses session mode", () => {
    // This is the scenario that caused NODE-EXPRESS-3 / NODE-EXPRESS-K:
    // DATABASE_URL pointed at the pooler host but on the session-mode port.
    // resolveDatabaseUrl() must enforce port 6543 regardless.
    withEnv(
      {
        DATABASE_URL:
          "postgresql://postgres.abcdef:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
        SUPABASE_POOLER_HOST: undefined,
        SUPABASE_POOLER_REGION: undefined,
        SUPABASE_POOLER_PORT: undefined,
      },
      () => {
        const url = new URL(resolveDatabaseUrl());
        // Must be transaction mode — NOT session mode (5432)
        expect(url.port).toBe("6543");
        expect(url.port).not.toBe("5432");
      },
    );
  });

  it("upgrades an implicit port-80/443 pooler URL to 6543 (empty port edge case)", () => {
    withEnv(
      {
        DATABASE_URL:
          "postgresql://postgres.abcdef:pw@aws-0-eu-west-1.pooler.supabase.com/postgres",
        SUPABASE_POOLER_HOST: undefined,
        SUPABASE_POOLER_REGION: undefined,
        SUPABASE_POOLER_PORT: undefined,
      },
      () => {
        const url = new URL(resolveDatabaseUrl());
        expect(url.port).toBe("6543");
      },
    );
  });
});

describe("resolveDatabaseUrl — non-Supabase URLs", () => {
  it("passes through a non-Supabase Postgres URL unchanged", () => {
    const raw = "postgresql://user:pw@my-own-db.example.com:5432/mydb";
    withEnv({ DATABASE_URL: raw }, () => {
      const result = resolveDatabaseUrl();
      const url = new URL(result);
      expect(url.hostname).toBe("my-own-db.example.com");
      expect(url.port).toBe("5432");
    });
  });

  it("rejects an un-parseable URL with an actionable error", () => {
    withEnv({ DATABASE_URL: "not-a-url" }, () => {
      expect(() => resolveDatabaseUrl()).toThrow(
        /Cannot parse database URL.*percent-encoded/,
      );
    });
  });

  it("throws when DATABASE_URL is missing", () => {
    withEnv({ DATABASE_URL: undefined }, () => {
      expect(() => resolveDatabaseUrl()).toThrow(/DATABASE_URL must be set/);
    });
  });
});
