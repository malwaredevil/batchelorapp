import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { parse } from "yaml";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SPEC_PATH = resolve(REPO_ROOT, "lib/api-spec/openapi.yaml");
const INVENTORY_PATH = resolve(
  REPO_ROOT,
  "artifacts/api-server/src/elaine/website-operation-inventory.json",
);
const REPORT_PATH = resolve(REPO_ROOT, "docs/elaine-capability-parity.md");

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

const DISPOSITIONS = [
  "direct",
  "covered_by_general_tool",
  "attachment_or_camera",
  "interactive_auth",
  "owner_or_admin",
  "background_system",
  "not_user_operation",
  "planned",
] as const;

type Disposition = (typeof DISPOSITIONS)[number];

type OpenApiOperation = {
  operationId: string;
  method: string;
  path: string;
  domain: string;
  summary: string;
};

type InventoryEntry = OpenApiOperation & {
  disposition: Disposition;
  mappedTools: string[];
  reason: string;
  followUpIssue?: number;
};

type OpenApiDocument = {
  paths?: Record<
    string,
    Record<
      string,
      {
        operationId?: string;
        summary?: string;
        tags?: string[];
      }
    >
  >;
};

const DIRECT_TOOL_MAP: Record<string, string[]> = {
  sendPhoneVerificationCode: ["send_phone_verification_code"],
  verifyPhoneCode: ["verify_phone_code"],
  sendTestSms: ["send_test_sms"],
  sendTestEmail: ["send_test_email"],
  listPottery: ["query_household_data", "search_household_data"],
  getPottery: ["show_pottery_item"],
  updatePottery: ["update_pottery_item"],
  deletePottery: ["delete_pottery_item"],
  deletePotteryImage: ["delete_pottery_photo"],
  bulkReanalyzePottery: ["bulk_reanalyze_pottery"],
  setPrimaryImage: ["promote_pottery_photo"],
  createPotteryCategory: ["create_pottery_category"],
  deletePotteryCategory: ["delete_pottery_category"],
  mergePotteryCategory: ["merge_pottery_categories"],
  listFabrics: ["query_household_data", "search_household_data"],
  getFabric: ["show_fabric_swatch"],
  updateFabric: ["update_fabric"],
  deleteFabric: ["delete_fabric"],
  bulkReanalyzeFabrics: ["bulk_reanalyze_quilting"],
  listPatterns: ["query_household_data", "search_household_data"],
  createPattern: ["create_pattern"],
  updatePattern: ["update_pattern"],
  deletePattern: ["delete_pattern"],
  listQuilts: ["query_household_data", "search_household_data"],
  deleteQuilt: ["delete_quilt"],
  listQuiltingCategories: ["query_household_data"],
  createQuiltingCategory: ["create_quilting_category"],
  renameQuiltingCategory: ["rename_quilting_category"],
  deleteQuiltingCategory: ["delete_quilting_category"],
  mergeQuiltingCategory: ["merge_quilting_categories"],
  listShoppingItems: ["query_household_data"],
  createShoppingItem: ["create_shopping_item"],
  updateShoppingItem: ["update_shopping_item"],
  deleteShoppingItem: ["delete_shopping_item"],
  createLayout: ["create_layout"],
  deleteLayout: ["delete_layout"],
  createBlock: ["create_block"],
  deleteBlock: ["delete_block"],
  labRemoveCreases: ["remove_fabric_creases"],
  listTrips: ["query_household_data", "search_household_data"],
  createTrip: ["create_trip"],
  getTrip: ["show_trip_card"],
  updateTrip: ["update_trip_details", "update_trip_status"],
  deleteTrip: ["cancel_trip"],
  generateItinerary: ["generate_itinerary"],
  listTripDocuments: ["search_trip_documents"],
  rescanTripDocument: ["rescan_document"],
  getGmailMessage: ["find_emails_about_topic", "get_email_detail"],
  exploreDestination: [
    "web_search",
    "get_weather_forecast",
    "find_nearby_places",
    "show_destination_card",
  ],
  getTravelsStats: ["query_household_data"],
  createPackingItem: ["add_packing_item"],
  deletePackingItem: ["remove_packing_item"],
  listWishlist: ["query_household_data"],
  createWishlistItem: ["add_wishlist"],
  updateWishlistItem: ["update_wishlist_item", "mark_wishlist_done"],
  deleteWishlistItem: ["remove_wishlist_item"],
  checkWishlistFlights: ["search_flights"],
  listOrnaments: ["query_household_data", "search_household_data"],
  getOrnament: ["show_ornament_item"],
  updateOrnament: ["update_ornament_item"],
  deleteOrnament: ["delete_ornament_item"],
  bulkReanalyzeOrnaments: ["bulk_reanalyze_ornaments"],
  setOrnamentPrimaryImage: ["promote_ornament_photo"],
  deleteOrnamentImage: ["delete_ornament_photo"],
  lookupOrnamentBarcode: ["lookup_product_barcode"],
  lookupBarcode: ["lookup_product_barcode"],
  lookupOrnamentEbayPrice: ["ebay_search"],
  createOrnamentCategory: ["create_ornament_category"],
  deleteOrnamentCategory: ["delete_ornament_category"],
  mergeOrnamentCategory: ["merge_ornament_categories"],
  listNotes: ["list_notes"],
  createNote: ["create_note"],
  updateNote: ["update_note"],
  deleteNote: ["delete_note"],
  getAppConfig: ["query_household_data"],
  getAppConfigByModule: ["query_household_data"],
  updateAppConfigValue: ["update_app_config"],
  getCounts: ["get_notification_counts"],
  list: ["list_notifications"],
  bulkUpdateState: ["bulk_update_notifications"],
  getNotificationsPreferences: ["get_notification_preferences"],
  updateNotificationsPreferences: ["update_notification_preferences"],
  updateState: ["update_notification_state"],
};

const APPROVED_MAPPED_TOOLS = new Set(Object.values(DIRECT_TOOL_MAP).flat());

function loadOpenApiOperations(): OpenApiOperation[] {
  const spec = parse(readFileSync(SPEC_PATH, "utf8")) as OpenApiDocument;
  const operations: OpenApiOperation[] = [];
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase()) || !operation.operationId) {
        continue;
      }
      operations.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        domain: operation.tags?.[0] ?? "untagged",
        summary: operation.summary ?? operation.operationId,
      });
    }
  }
  return operations.sort((a, b) => a.operationId.localeCompare(b.operationId));
}

function initialDisposition(operation: OpenApiOperation): InventoryEntry {
  const mappedTools = DIRECT_TOOL_MAP[operation.operationId];
  if (mappedTools) {
    return {
      ...operation,
      disposition: "direct",
      mappedTools,
      reason:
        "Elaine has registered tools that reuse or mirror this website operation.",
    };
  }

  const searchableRead =
    operation.method === "GET" &&
    ["pottery", "quilting", "ornaments", "travels"].includes(operation.domain);
  if (searchableRead) {
    return {
      ...operation,
      disposition: "covered_by_general_tool",
      mappedTools: ["search_household_data", "query_household_data"],
      reason:
        "Elaine can answer common questions through household search/summary, but this specialized endpoint is not yet a dedicated tool.",
      followUpIssue: 360,
    };
  }

  if (
    /(?:upload|^add.*Image|PhotoLookup|extract.*Photo|PreviewPng|Attachment|^get.*Image|^create(?:Pottery|Fabric|Ornament|Quilt)$)/i.test(
      operation.operationId,
    )
  ) {
    return {
      ...operation,
      disposition: "attachment_or_camera",
      mappedTools: [],
      reason:
        "This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it.",
      followUpIssue: 360,
    };
  }

  if (
    /(login|logout|password|AuthProvider|CurrentUser|pushSubscribe|pushUnsubscribe)/i.test(
      operation.operationId,
    )
  ) {
    return {
      ...operation,
      disposition: "interactive_auth",
      mappedTools: [],
      reason:
        "This operation changes authentication, credentials, browser push permission, or provider consent and must remain an explicit interactive user flow.",
    };
  }

  if (
    ["jobs", "operations", "ingestion", "config"].includes(operation.domain) ||
    /(Job|Operation|Budget|WeatherConfig)/.test(operation.operationId)
  ) {
    return {
      ...operation,
      disposition: "owner_or_admin",
      mappedTools: [],
      reason:
        "This is an owner/operator control. Elaine only exposes the explicitly allowlisted app-config action today.",
      followUpIssue: 360,
    };
  }

  if (operation.operationId === "healthCheck") {
    return {
      ...operation,
      disposition: "not_user_operation",
      mappedTools: [],
      reason:
        "Health checks are deployment infrastructure, not a household website action.",
    };
  }

  if (operation.domain === "messenger") {
    return {
      ...operation,
      disposition: "planned",
      mappedTools: [],
      reason:
        "Elaine has no Messenger executor yet. This needs a shared conversation/message service plus explicit recipient and destructive-message confirmation rules.",
      followUpIssue: 360,
    };
  }

  if (/(?:Reservation|Monitoring|ChangeEvent)/.test(operation.operationId)) {
    return {
      ...operation,
      disposition: "planned",
      mappedTools: [],
      reason:
        "Travel reservation monitoring is a multi-step workflow with provider checks and change decisions; its route logic must be extracted into an auditable shared service before Elaine can execute it.",
      followUpIssue: 360,
    };
  }

  if (/(?:Packing|packing)/.test(operation.operationId)) {
    return {
      ...operation,
      disposition: "planned",
      mappedTools: [],
      reason:
        "Elaine supports add/remove packing items today, but this specialized list, bulk, reorder, or template operation still needs the packing route's validation extracted into a shared service.",
      followUpIssue: 360,
    };
  }

  if (
    /(?:PatternAnalysis|IdentityResearch|Identifier|PatternRequirements|PatternVariant)/.test(
      operation.operationId,
    )
  ) {
    return {
      ...operation,
      disposition: "planned",
      mappedTools: [],
      reason:
        "This quilting research/analysis workflow requires selecting a staged result and applying it safely; Elaine needs a typed workflow tool with explicit preview and confirmation.",
      followUpIssue: 360,
    };
  }

  if (
    /(?:Image|PrimaryImage)/.test(operation.operationId) &&
    ["DELETE", "PATCH", "POST"].includes(operation.method)
  ) {
    return {
      ...operation,
      disposition: "planned",
      mappedTools: [],
      reason:
        "This image mutation is not covered by the collection's current Elaine photo tools. It needs the route's ownership, primary-image, storage, and cache-invalidation rules exposed through a shared service.",
      followUpIssue: 360,
    };
  }

  return {
    ...operation,
    disposition: "planned",
    mappedTools: [],
    reason:
      "No safe, registered Elaine tool currently exposes this website operation.",
    followUpIssue: 360,
  };
}

function loadInventory(): InventoryEntry[] {
  return JSON.parse(readFileSync(INVENTORY_PATH, "utf8")) as InventoryEntry[];
}

async function renderReport(entries: InventoryEntry[]): Promise<string> {
  const counts = Object.fromEntries(
    DISPOSITIONS.map((disposition) => [
      disposition,
      entries.filter((entry) => entry.disposition === disposition).length,
    ]),
  ) as Record<Disposition, number>;
  const domains = [...new Set(entries.map((entry) => entry.domain))].sort();
  const rows = domains
    .map((domain) => {
      const domainEntries = entries.filter((entry) => entry.domain === domain);
      const direct = domainEntries.filter(
        (entry) =>
          entry.disposition === "direct" ||
          entry.disposition === "covered_by_general_tool",
      ).length;
      const planned = domainEntries.filter(
        (entry) => entry.disposition === "planned",
      ).length;
      return `| ${domain} | ${domainEntries.length} | ${direct} | ${planned} |`;
    })
    .join("\n");

  const plannedRows = entries
    .filter(
      (entry) =>
        entry.disposition === "planned" ||
        entry.disposition === "attachment_or_camera",
    )
    .map(
      (entry) =>
        `| \`${entry.operationId}\` | ${entry.method} \`${entry.path}\` | ${entry.domain} | ${entry.disposition} | ${entry.reason} |`,
    )
    .join("\n");

  const report = `# Elaine website capability parity

Generated from the committed OpenAPI specification and the reviewed operation inventory. Do not edit this report by hand; run \`pnpm --filter @workspace/scripts run elaine:capability-report\`.

## Summary

- Website operations inventoried: ${entries.length}
- Direct Elaine mappings: ${counts.direct}
- Covered by general read tools: ${counts.covered_by_general_tool}
- Attachment/camera prerequisites: ${counts.attachment_or_camera}
- Interactive authentication: ${counts.interactive_auth}
- Owner/admin operations: ${counts.owner_or_admin}
- Background/system operations: ${counts.background_system}
- Non-user operations: ${counts.not_user_operation}
- Planned capability gaps: ${counts.planned}

## Coverage by domain

| Domain | Website operations | Direct/general coverage | Planned gaps |
| --- | ---: | ---: | ---: |
${rows}

## Open gaps

Every gap has a precise disposition and reason in \`website-operation-inventory.json\`. Feasible user-facing gaps remain tracked by GitHub issue #360; authentication and binary/camera prerequisites are intentionally explicit rather than silently pretending the operation is supported.

| Operation | Endpoint | Domain | Disposition | Reason |
| --- | --- | --- | --- | --- |
${plannedRows || "| _None_ |  |  |  |  |"}
`;
  return format(report, { parser: "markdown" });
}

function validate(
  operations: OpenApiOperation[],
  inventory: InventoryEntry[],
): string[] {
  const errors: string[] = [];
  const operationById = new Map(
    operations.map((operation) => [operation.operationId, operation]),
  );
  const inventoryById = new Map<string, InventoryEntry>();

  for (const entry of inventory) {
    if (inventoryById.has(entry.operationId)) {
      errors.push(`Duplicate inventory operationId: ${entry.operationId}`);
    }
    inventoryById.set(entry.operationId, entry);
    if (!DISPOSITIONS.includes(entry.disposition)) {
      errors.push(
        `Invalid disposition for ${entry.operationId}: ${entry.disposition}`,
      );
    }
    if (!entry.reason.trim()) {
      errors.push(`Missing reason for ${entry.operationId}`);
    }
    if (
      (entry.disposition === "direct" ||
        entry.disposition === "covered_by_general_tool") &&
      entry.mappedTools.length === 0
    ) {
      errors.push(`${entry.operationId} claims coverage without a mapped tool`);
    }
    for (const tool of entry.mappedTools) {
      if (!APPROVED_MAPPED_TOOLS.has(tool)) {
        errors.push(
          `${entry.operationId} maps to unapproved or misspelled tool: ${tool}`,
        );
      }
    }
  }

  for (const operation of operations) {
    const entry = inventoryById.get(operation.operationId);
    if (!entry) {
      errors.push(
        `New OpenAPI operation lacks reviewed Elaine disposition: ${operation.operationId}`,
      );
      continue;
    }
    for (const key of ["method", "path", "domain", "summary"] as const) {
      if (entry[key] !== operation[key]) {
        errors.push(
          `${operation.operationId} ${key} drifted: inventory="${entry[key]}" spec="${operation[key]}"`,
        );
      }
    }
  }

  for (const entry of inventory) {
    if (!operationById.has(entry.operationId)) {
      errors.push(
        `Inventory contains removed OpenAPI operation: ${entry.operationId}`,
      );
    }
  }
  return errors;
}

const operations = loadOpenApiOperations();
const command = process.argv[2] ?? "--check";

if (command === "--bootstrap") {
  const entries = operations.map(initialDisposition);
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(INVENTORY_PATH, `${JSON.stringify(entries, null, 2)}\n`);
  writeFileSync(REPORT_PATH, await renderReport(entries));
  console.log(`Wrote ${entries.length} reviewed operation inventory entries.`);
  process.exit(0);
}

const inventory = loadInventory();
const errors = validate(operations, inventory);
const report = await renderReport(inventory);

if (command === "--write-report") {
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, report);
  console.log(
    `Updated Elaine parity report for ${inventory.length} operations.`,
  );
  process.exit(0);
}

if (command !== "--check") {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

if (errors.length > 0) {
  console.error(
    `Elaine capability parity failed:\n- ${errors.join("\n- ")}\nUpdate website-operation-inventory.json with an explicit mapping or reason.`,
  );
  process.exit(1);
}

const committedReport = readFileSync(REPORT_PATH, "utf8");
if (committedReport !== report) {
  console.error(
    "Elaine capability report is stale. Run: pnpm --filter @workspace/scripts run elaine:capability-report",
  );
  process.exit(1);
}

console.log(
  `Elaine capability parity passed for ${inventory.length} website operations.`,
);
