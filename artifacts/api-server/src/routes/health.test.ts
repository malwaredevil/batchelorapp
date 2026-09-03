import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbExecuteMock,
  getBootstrapStatusMock,
  isStartupReadyMock,
  getStartupStateMock,
} = vi.hoisted(() => ({
  dbExecuteMock: vi.fn(),
  getBootstrapStatusMock: vi.fn(),
  isStartupReadyMock: vi.fn(),
  getStartupStateMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: dbExecuteMock,
  },
}));

vi.mock("../lib/app-config", () => ({
  getBootstrapStatus: getBootstrapStatusMock,
}));

vi.mock("../lib/startup-state", () => ({
  getStartupState: getStartupStateMock,
  isStartupReady: isStartupReadyMock,
}));

import healthRouter from "./health";

const app = express();
app.use("/api", healthRouter);

describe("deployment health endpoints", () => {
  beforeEach(() => {
    dbExecuteMock.mockReset();
    dbExecuteMock.mockResolvedValue({});
    getBootstrapStatusMock.mockReturnValue("success");
    getStartupStateMock.mockReturnValue({
      status: "starting",
      migration: "pending",
      buckets: "pending",
    });
    isStartupReadyMock.mockReturnValue(true);
  });

  it("serves the API artifact root as a healthy readiness endpoint", async () => {
    const root = await request(app).get("/api");
    const healthz = await request(app).get("/api/healthz");

    expect(root.status).toBe(200);
    expect(root.body).toEqual(healthz.body);
    expect(root.body.status).toBe("ok");
    expect(dbExecuteMock).toHaveBeenCalledTimes(2);
  });

  it("returns 503 with startup details before initialization completes", async () => {
    isStartupReadyMock.mockReturnValue(false);

    const response = await request(app).get("/api");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: "error",
      reason: "startup_incomplete",
      startup: {
        status: "starting",
        migration: "pending",
        buckets: "pending",
      },
    });
    expect(dbExecuteMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the readiness database check fails", async () => {
    dbExecuteMock.mockRejectedValue(new Error("database unavailable"));

    const response = await request(app).get("/api");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: "error",
      reason: "database_unavailable",
    });
  });

  it("keeps the deployment startup health path pointed at the explicit readiness endpoint", () => {
    const artifactToml = readFileSync(
      resolve(process.cwd(), ".replit-artifact/artifact.toml"),
      "utf8",
    );

    expect(artifactToml).toContain('path = "/api/healthz"');
  });
});
