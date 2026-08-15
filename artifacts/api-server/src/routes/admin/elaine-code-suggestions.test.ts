import { describe, it, expect, vi, beforeEach } from "vitest";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { ZodError } from "zod/v4";

// ── Infrastructure mocks ────────────────────────────────────────────────────

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../middleware/rateLimit", () => ({
  adminLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ── Auth mocks ───────────────────────────────────────────────────────────────

let currentUserId = 1;
let currentIsOwner = true;

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: { session?: { userId?: number } },
    _res: unknown,
    next: () => void,
  ) => {
    req.session = { userId: currentUserId };
    next();
  },
}));

vi.mock("../../middleware/owner", () => ({
  requireOwner: (
    _req: unknown,
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!currentIsOwner) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  },
}));

vi.mock("../../lib/auth-context", () => ({
  getAuthenticatedUserId: (req: { session?: { userId?: number } }) => {
    const id = req.session?.userId;
    if (!id) throw new Error("not authenticated");
    return id;
  },
}));

// ── elaine-code-diagnosis mock ───────────────────────────────────────────────

const {
  mockList,
  mockDecide,
  mockWritePlanFile,
  mockLinkTask,
  mockCreateTask,
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockDecide: vi.fn(),
  mockWritePlanFile: vi.fn(),
  mockLinkTask: vi.fn(),
  mockCreateTask: vi.fn(),
}));

vi.mock("../../lib/elaine-code-diagnosis", () => ({
  listElaineCodeSuggestions: mockList,
  decideElaineCodeSuggestion: mockDecide,
  writeSuggestionPlanFile: mockWritePlanFile,
  linkTaskToSuggestion: mockLinkTask,
  createTaskFromSuggestion: mockCreateTask,
}));

// ── Router import (must come after all vi.mock calls) ───────────────────────

import elaineCodeSuggestionsRouter from "./elaine-code-suggestions";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/admin/elaine-code-suggestions", elaineCodeSuggestionsRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "Invalid request." });
      return;
    }
    res.status(500).json({ error: "Internal error" });
  });
  return app;
}

const baseSuggestion = {
  id: 1,
  patternKey: "self_heal:claimed_check_without_tool_call",
  lessonId: 42,
  occurrenceCount: 5,
  observedPattern: "Elaine claimed a check without a tool call, 5 times.",
  filesReviewed: [
    { path: "artifacts/api-server/src/elaine/runtime/self-heal-policy.ts" },
  ],
  hypothesis: "The regex only matches present tense phrasing.",
  status: "pending",
  createdAt: new Date().toISOString(),
  decidedAt: null,
  linkedTaskRef: null,
};

const baseTask = {
  id: 7,
  title: "Fix: self_heal:claimed_check_without_tool_call",
  description: "Pattern recurred 5× — …",
  status: "open",
  createdFromSuggestionId: 1,
  createdByUserId: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  currentUserId = 1;
  currentIsOwner = true;
  mockWritePlanFile.mockReturnValue(".local/tasks/elaine-cs-1-self-heal.md");
});

// ── GET ──────────────────────────────────────────────────────────────────────

describe("GET /admin/elaine-code-suggestions", () => {
  it("returns pending suggestions when status=pending", async () => {
    mockList.mockResolvedValueOnce([baseSuggestion]);
    const res = await request(buildApp()).get(
      "/admin/elaine-code-suggestions?status=pending",
    );
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toHaveLength(1);
    expect(mockList).toHaveBeenCalledWith("pending");
  });

  it("returns all suggestions when no status filter is given", async () => {
    mockList.mockResolvedValueOnce([baseSuggestion]);
    const res = await request(buildApp()).get("/admin/elaine-code-suggestions");
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith(undefined);
  });

  it("returns 403 for a non-owner", async () => {
    currentIsOwner = false;
    const res = await request(buildApp()).get("/admin/elaine-code-suggestions");
    expect(res.status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("rejects an invalid status filter", async () => {
    const res = await request(buildApp()).get(
      "/admin/elaine-code-suggestions?status=bogus",
    );
    expect(res.status).toBe(400);
  });
});

// ── POST /:id/create-task ────────────────────────────────────────────────────

describe("POST /admin/elaine-code-suggestions/:id/create-task", () => {
  it("accepts the suggestion and creates a task in one click", async () => {
    const acceptedSuggestion = {
      ...baseSuggestion,
      status: "accepted",
      linkedTaskRef: "#7",
    };
    mockCreateTask.mockResolvedValueOnce({
      suggestion: acceptedSuggestion,
      task: baseTask,
    });

    const res = await request(buildApp()).post(
      "/admin/elaine-code-suggestions/1/create-task",
    );

    expect(res.status).toBe(200);
    // Suggestion immediately has the auto-generated ref
    expect(res.body.suggestion.linkedTaskRef).toBe("#7");
    expect(res.body.suggestion.status).toBe("accepted");
    // Task details are returned alongside
    expect(res.body.task.id).toBe(7);
    expect(res.body.task.title).toBe(baseTask.title);
    // planFilePath is included
    expect(res.body.planFilePath).toBe(".local/tasks/elaine-cs-1-self-heal.md");
    expect(mockCreateTask).toHaveBeenCalledWith({
      suggestionId: 1,
      userId: currentUserId,
    });
    expect(mockWritePlanFile).toHaveBeenCalledWith(acceptedSuggestion);
  });

  it("returns 404 when the suggestion does not exist or is already decided", async () => {
    mockCreateTask.mockResolvedValueOnce(null);
    const res = await request(buildApp()).post(
      "/admin/elaine-code-suggestions/999/create-task",
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await request(buildApp()).post(
      "/admin/elaine-code-suggestions/abc/create-task",
    );
    expect(res.status).toBe(400);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner", async () => {
    currentIsOwner = false;
    const res = await request(buildApp()).post(
      "/admin/elaine-code-suggestions/1/create-task",
    );
    expect(res.status).toBe(403);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it("includes planFilePath: null when writeSuggestionPlanFile returns null", async () => {
    mockWritePlanFile.mockReturnValue(null);
    mockCreateTask.mockResolvedValueOnce({
      suggestion: {
        ...baseSuggestion,
        status: "accepted",
        linkedTaskRef: "#7",
      },
      task: baseTask,
    });
    const res = await request(buildApp()).post(
      "/admin/elaine-code-suggestions/1/create-task",
    );
    expect(res.status).toBe(200);
    expect(res.body.planFilePath).toBeNull();
  });
});

// ── POST /:id/decision ───────────────────────────────────────────────────────

describe("POST /admin/elaine-code-suggestions/:id/decision", () => {
  it("accepts a pending suggestion and writes a plan file", async () => {
    const accepted = { ...baseSuggestion, status: "accepted" };
    mockDecide.mockResolvedValueOnce(accepted);
    const res = await request(buildApp())
      .post("/admin/elaine-code-suggestions/1/decision")
      .send({ decision: "accepted" });
    expect(res.status).toBe(200);
    expect(res.body.suggestion.status).toBe("accepted");
    expect(res.body.planFilePath).toBe(".local/tasks/elaine-cs-1-self-heal.md");
    expect(mockDecide).toHaveBeenCalledWith({
      id: 1,
      decision: "accepted",
      decidedByUserId: currentUserId,
    });
    expect(mockWritePlanFile).toHaveBeenCalledWith(accepted);
  });

  it("dismisses a pending suggestion without writing a plan file", async () => {
    mockDecide.mockResolvedValueOnce({
      ...baseSuggestion,
      status: "dismissed",
    });
    const res = await request(buildApp())
      .post("/admin/elaine-code-suggestions/1/decision")
      .send({ decision: "dismissed" });
    expect(res.status).toBe(200);
    expect(res.body.suggestion.status).toBe("dismissed");
    expect(res.body.planFilePath).toBeNull();
    expect(mockWritePlanFile).not.toHaveBeenCalled();
  });

  it("returns 404 when the suggestion does not exist or is already decided", async () => {
    mockDecide.mockResolvedValueOnce(null);
    const res = await request(buildApp())
      .post("/admin/elaine-code-suggestions/999/decision")
      .send({ decision: "accepted" });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await request(buildApp())
      .post("/admin/elaine-code-suggestions/abc/decision")
      .send({ decision: "accepted" });
    expect(res.status).toBe(400);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid decision value", async () => {
    const res = await request(buildApp())
      .post("/admin/elaine-code-suggestions/1/decision")
      .send({ decision: "maybe" });
    expect(res.status).toBe(400);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner", async () => {
    currentIsOwner = false;
    const res = await request(buildApp())
      .post("/admin/elaine-code-suggestions/1/decision")
      .send({ decision: "accepted" });
    expect(res.status).toBe(403);
  });
});

// ── PATCH /:id/linked-task ───────────────────────────────────────────────────

describe("PATCH /admin/elaine-code-suggestions/:id/linked-task", () => {
  it("stores the task ref on an accepted suggestion", async () => {
    const linked = {
      ...baseSuggestion,
      status: "accepted",
      linkedTaskRef: "#921",
    };
    mockLinkTask.mockResolvedValueOnce(linked);
    const res = await request(buildApp())
      .patch("/admin/elaine-code-suggestions/1/linked-task")
      .send({ linkedTaskRef: "#921" });
    expect(res.status).toBe(200);
    expect(res.body.suggestion.linkedTaskRef).toBe("#921");
    expect(mockLinkTask).toHaveBeenCalledWith(1, "#921");
  });

  it("accepts a bare number task ref", async () => {
    mockLinkTask.mockResolvedValueOnce({
      ...baseSuggestion,
      status: "accepted",
      linkedTaskRef: "921",
    });
    const res = await request(buildApp())
      .patch("/admin/elaine-code-suggestions/1/linked-task")
      .send({ linkedTaskRef: "921" });
    expect(res.status).toBe(200);
    expect(mockLinkTask).toHaveBeenCalledWith(1, "921");
  });

  it("returns 404 when the suggestion is pending or does not exist", async () => {
    mockLinkTask.mockResolvedValueOnce(null);
    const res = await request(buildApp())
      .patch("/admin/elaine-code-suggestions/1/linked-task")
      .send({ linkedTaskRef: "#921" });
    expect(res.status).toBe(404);
  });

  it("returns 400 for an empty task ref", async () => {
    const res = await request(buildApp())
      .patch("/admin/elaine-code-suggestions/1/linked-task")
      .send({ linkedTaskRef: "   " });
    expect(res.status).toBe(400);
    expect(mockLinkTask).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing linkedTaskRef field", async () => {
    const res = await request(buildApp())
      .patch("/admin/elaine-code-suggestions/1/linked-task")
      .send({});
    expect(res.status).toBe(400);
    expect(mockLinkTask).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await request(buildApp())
      .patch("/admin/elaine-code-suggestions/abc/linked-task")
      .send({ linkedTaskRef: "#921" });
    expect(res.status).toBe(400);
    expect(mockLinkTask).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner", async () => {
    currentIsOwner = false;
    const res = await request(buildApp())
      .patch("/admin/elaine-code-suggestions/1/linked-task")
      .send({ linkedTaskRef: "#921" });
    expect(res.status).toBe(403);
    expect(mockLinkTask).not.toHaveBeenCalled();
  });
});
