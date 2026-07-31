import type OpenAI from "openai";
import { z } from "zod/v4";
import { ELAINE_APP_OPERATION_CATALOG } from "./app-operation-catalog.generated";

export const DISCOVER_APP_OPERATIONS_TOOL_NAME = "discover_app_operations";
export const READ_APP_OPERATION_TOOL_NAME = "read_app_operation";
export const EXECUTE_APP_OPERATION_TOOL_NAME = "execute_app_operation";

const Scalar = z.union([z.string(), z.number(), z.boolean()]);
const QueryValue = z.union([Scalar, z.array(Scalar).max(100)]);
const OperationArguments = z.object({
  operationId: z.string().min(1).max(120),
  pathParams: z.record(z.string(), Scalar).default({}),
  query: z.record(z.string(), QueryValue).default({}),
  body: z.unknown().optional(),
});

const DiscoverArguments = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  domain: z.string().trim().min(1).max(100).optional(),
  access: z.enum(["read", "action"]).optional(),
  limit: z.number().int().min(1).max(12).default(8),
});

export const appOperationActionSchemas = [
  z.object({
    type: z.literal(EXECUTE_APP_OPERATION_TOOL_NAME),
    payload: OperationArguments,
  }),
] as const;

export type AppOperationActionType = typeof EXECUTE_APP_OPERATION_TOOL_NAME;
export type AppOperationPayload = z.infer<typeof OperationArguments>;

type CatalogEntry = (typeof ELAINE_APP_OPERATION_CATALOG)[number];
type FetchLike = typeof fetch;

export interface AppOperationExecutionContext {
  sessionCookie?: string;
  localPort?: number;
  fetchImpl?: FetchLike;
}

const catalogById = new Map<string, CatalogEntry>(
  ELAINE_APP_OPERATION_CATALOG.map((entry) => [entry.operationId, entry]),
);

const SENSITIVE_KEY_RE =
  /(?:authorization|cookie|password|secret|token|service.?role|connection.?string)/i;
const MAX_REQUEST_BYTES = 200_000;
const MAX_RESPONSE_BYTES = 512_000;

function redactResult(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => redactResult(item, depth + 1));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEY_RE.test(key))
      .slice(0, 300)
      .map(([key, child]) => [key, redactResult(child, depth + 1)]),
  );
}

function getOperation(
  operationId: string,
  expectedAccess: "read" | "action",
): CatalogEntry {
  const operation = catalogById.get(operationId);
  if (!operation || operation.access !== expectedAccess) {
    throw new Error(
      `Operation "${operationId}" is not an approved ${expectedAccess} capability.`,
    );
  }
  return operation;
}

function buildOperationPath(
  operation: CatalogEntry,
  pathParams: Record<string, string | number | boolean>,
): string {
  const required = [...operation.path.matchAll(/\{([^}]+)\}/g)].map(
    (match) => match[1]!,
  );
  const missing = required.filter((name) => pathParams[name] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Missing path parameter${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
    );
  }
  return operation.path.replace(/\{([^}]+)\}/g, (_, name: string) =>
    encodeURIComponent(String(pathParams[name])),
  );
}

function validateOperationContract(
  operation: CatalogEntry,
  payload: AppOperationPayload,
): void {
  const pathNames = new Set(
    [...operation.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!),
  );
  const queryParameters = (
    operation.parameters as readonly {
      name: string;
      in: "path" | "query";
      required: boolean;
    }[]
  ).filter((parameter) => parameter.in === "query");
  const queryNames = new Set(
    queryParameters.map((parameter) => parameter.name),
  );
  const unknownPathNames = Object.keys(payload.pathParams).filter(
    (name) => !pathNames.has(name),
  );
  const unknownQueryNames = Object.keys(payload.query).filter(
    (name) => !queryNames.has(name),
  );
  const missingQueryNames = queryParameters
    .filter(
      (parameter) =>
        parameter.required && payload.query[parameter.name] === undefined,
    )
    .map((parameter) => parameter.name);

  if (unknownPathNames.length > 0) {
    throw new Error(
      `Unknown path parameter${unknownPathNames.length > 1 ? "s" : ""}: ${unknownPathNames.join(", ")}`,
    );
  }
  if (unknownQueryNames.length > 0) {
    throw new Error(
      `Unknown query parameter${unknownQueryNames.length > 1 ? "s" : ""}: ${unknownQueryNames.join(", ")}`,
    );
  }
  if (missingQueryNames.length > 0) {
    throw new Error(
      `Missing query parameter${missingQueryNames.length > 1 ? "s" : ""}: ${missingQueryNames.join(", ")}`,
    );
  }

  const requestBody = operation.requestBody as {
    required: boolean;
  } | null;
  if (!requestBody && payload.body !== undefined) {
    throw new Error(
      `Operation "${operation.operationId}" does not accept a JSON body.`,
    );
  }
  if (requestBody?.required && payload.body === undefined) {
    throw new Error(
      `Operation "${operation.operationId}" requires a JSON body.`,
    );
  }
}

function appendQuery(
  url: URL,
  query: Record<
    string,
    string | number | boolean | Array<string | number | boolean>
  >,
): void {
  for (const [key, rawValue] of Object.entries(query)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) url.searchParams.append(key, String(value));
  }
}

export async function executeAppOperation(
  rawPayload: unknown,
  expectedAccess: "read" | "action",
  context: AppOperationExecutionContext,
): Promise<{ status: number; body: unknown }> {
  const payload = OperationArguments.parse(rawPayload);
  const operation = getOperation(payload.operationId, expectedAccess);
  validateOperationContract(operation, payload);
  if (!context.sessionCookie || !context.localPort) {
    return {
      status: 401,
      body: {
        error:
          "This app operation requires Elaine's authenticated web session.",
      },
    };
  }

  const path = buildOperationPath(operation, payload.pathParams);
  const url = new URL(`/api${path}`, `http://127.0.0.1:${context.localPort}`);
  appendQuery(url, payload.query);

  let requestBody: string | undefined;
  if (payload.body !== undefined) {
    requestBody = JSON.stringify(payload.body);
    if (Buffer.byteLength(requestBody, "utf8") > MAX_REQUEST_BYTES) {
      return {
        status: 413,
        body: { error: "Operation body exceeds Elaine's safe size limit." },
      };
    }
  }

  const response = await (context.fetchImpl ?? fetch)(url, {
    method: operation.method,
    redirect: "manual",
    headers: {
      Accept: "application/json, text/plain;q=0.5",
      Cookie: context.sessionCookie,
      "X-Elaine-App-Operation": operation.operationId,
      ...(requestBody === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(requestBody === undefined ? {} : { body: requestBody }),
    signal: AbortSignal.timeout(90_000),
  });

  if (response.status >= 300 && response.status < 400) {
    return {
      status: 502,
      body: { error: "The app operation returned an unexpected redirect." },
    };
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    return {
      status: 502,
      body: { error: "The app operation response exceeded the safe limit." },
    };
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    contentType &&
    !contentType.includes("application/json") &&
    !contentType.includes("text/")
  ) {
    return {
      status: 415,
      body: {
        error:
          "This operation returned binary content, which Elaine deliberately does not ingest through the JSON bridge.",
      },
    };
  }

  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    return {
      status: 502,
      body: { error: "The app operation response exceeded the safe limit." },
    };
  }
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, MAX_RESPONSE_BYTES);
    }
  }
  return { status: response.status, body: redactResult(body) };
}

export function discoverAppOperations(rawArgs: unknown): string {
  const args = DiscoverArguments.parse(rawArgs);
  const terms = (args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const domain = args.domain?.toLowerCase();
  const ranked = ELAINE_APP_OPERATION_CATALOG.map((operation) => {
    const haystack =
      `${operation.operationId} ${operation.domain} ${operation.summary}`.toLowerCase();
    const score = terms.reduce(
      (total, term) => total + (haystack.includes(term) ? 1 : 0),
      0,
    );
    return { operation, score };
  })
    .filter(
      ({ operation, score }) =>
        (!domain || operation.domain.toLowerCase() === domain) &&
        (!args.access || operation.access === args.access) &&
        (terms.length === 0 || score > 0),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.operation.operationId.localeCompare(b.operation.operationId),
    )
    .slice(0, args.limit)
    .map(({ operation }) => operation);

  return JSON.stringify({
    operations: ranked,
    instruction:
      "Use the exact operationId and required path/query/body fields. Prefer an existing dedicated Elaine tool when one is available; this catalog contains only operations assigned to the universal bridge.",
  });
}

export async function buildAppOperationActionLabel(action: {
  payload: unknown;
}): Promise<string> {
  const payload = OperationArguments.parse(action.payload);
  const operation = getOperation(payload.operationId, "action");
  return `${operation.summary} (${operation.operationId})`;
}

export async function executeAppOperationAction(
  payload: AppOperationPayload,
  _userId: number,
  context?: AppOperationExecutionContext,
): Promise<{ status: number; body: unknown }> {
  return executeAppOperation(payload, "action", context ?? {});
}

const APP_OPERATION_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: DISCOVER_APP_OPERATIONS_TOOL_NAME,
      description:
        "Find Batchelor App operations that do not already have a richer dedicated Elaine tool. Use this when the user asks to read or change something in the app and no dedicated tool fits. Search first; never guess an operationId or its fields.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Plain-language capability or operation name, such as reservation monitoring, quilt update, messenger reaction, or watchlist scan.",
          },
          domain: { type: "string" },
          access: { type: "string", enum: ["read", "action"] },
          limit: { type: "integer", minimum: 1, maximum: 12 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: READ_APP_OPERATION_TOOL_NAME,
      description:
        "Run one authenticated, read-only Batchelor App operation returned by discover_app_operations. Use the exact operationId and schema. Never invent record ids.",
      parameters: {
        type: "object",
        properties: {
          operationId: { type: "string" },
          pathParams: { type: "object", additionalProperties: true },
          query: { type: "object", additionalProperties: true },
        },
        required: ["operationId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: EXECUTE_APP_OPERATION_TOOL_NAME,
      description:
        "Propose one authenticated Batchelor App mutation returned by discover_app_operations. It will use the normal confirmation policy and the existing API's validation/business rules. Use exact fields and never guess ids.",
      parameters: {
        type: "object",
        properties: {
          operationId: { type: "string" },
          pathParams: { type: "object", additionalProperties: true },
          query: { type: "object", additionalProperties: true },
          body: {
            description:
              "JSON request body matching the schema returned by discover_app_operations.",
          },
        },
        required: ["operationId"],
      },
    },
  },
];

export const appOperationReadTools = APP_OPERATION_TOOLS.slice(0, 2);
export const appOperationActionTools = APP_OPERATION_TOOLS.slice(2);
