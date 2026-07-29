from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, expected: int | None = None) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if expected is not None and count != expected:
        raise SystemExit(f"expected {expected} occurrences in {path}, found {count}: {old[:100]!r}")
    if count == 0:
        raise SystemExit(f"pattern not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new))

# ---------------------------------------------------------------------------
# C-01: purge safety for polymorphic quilting images and storage failures.
# ---------------------------------------------------------------------------
purge = "artifacts/api-server/src/lib/purge-deleted.ts"
replace_once(
    purge,
    'import { and, isNotNull, lt, inArray } from "drizzle-orm";',
    'import { and, eq, isNotNull, lt, inArray } from "drizzle-orm";',
)
replace_once(
    purge,
    '''  if (error) {\n    logger.warn(\n      { bucket, paths: valid, error },\n      "Storage removal partial failure",\n    );\n  }\n}\n''',
    '''  if (error) {\n    logger.warn(\n      { bucket, paths: valid, error },\n      "Storage removal failed; retaining database rows for retry",\n    );\n    throw new Error(\n      `Storage removal failed for ${bucket}: ${error.message ?? String(error)}`,\n    );\n  }\n}\n\ntype QuiltingEntityType = "fabric" | "pattern" | "quilt";\n\n/**\n * Polymorphic quilting images are identified by BOTH entity type and entity ID.\n * Never query or delete these rows using entityId alone because independent\n * sequences allow the same numeric ID to exist for a fabric, pattern, and quilt.\n */\nfunction quiltingImagesWhere(\n  entityType: QuiltingEntityType,\n  entityIds: number[],\n) {\n  return and(\n    eq(quiltingImages.entityType, entityType),\n    inArray(quiltingImages.entityId, entityIds),\n  );\n}\n''',
)

p = Path(purge)
text = p.read_text()
needle = ".where(inArray(quiltingImages.entityId, ids));"
if text.count(needle) != 4:
    raise SystemExit(f"expected four unscoped quilting image filters, found {text.count(needle)}")
text = text.replace(needle, '.where(quiltingImagesWhere("fabric", ids));', 2)
text = text.replace(needle, '.where(quiltingImagesWhere("quilt", ids));', 2)
p.write_text(text)

replace_once(
    purge,
    '''      await removeStoragePaths(\n        "quilting",\n        rows.map((r) => r.imagePath),\n      );\n      await db.delete(quiltPatterns).where(inArray(quiltPatterns.id, ids));\n''',
    '''      const suppImages = await db\n        .select({ storagePath: quiltingImages.storagePath })\n        .from(quiltingImages)\n        .where(quiltingImagesWhere("pattern", ids));\n      await removeStoragePaths("quilting", [\n        ...rows.map((r) => r.imagePath),\n        ...suppImages.map((i) => i.storagePath),\n      ]);\n      await db\n        .delete(quiltingImages)\n        .where(quiltingImagesWhere("pattern", ids));\n      await db.delete(quiltPatterns).where(inArray(quiltPatterns.id, ids));\n''',
)

# ---------------------------------------------------------------------------
# H-04: visibility predicates are mandatory in semantic search.
# ---------------------------------------------------------------------------
search = "artifacts/api-server/src/lib/collection-search.ts"
replace_once(search, "  extraWhere?: SQL;", "  visibilityWhere: SQL;")
replace_once(search, "  extraWhere,", "  visibilityWhere,")
replace_all(
    search,
    '${extraWhere ? sql`and ${extraWhere}` : sql``}',
    'and ${visibilityWhere}',
    expected=2,
)
replace_once(
    search,
    '''  const documents = await fetchDocuments(candidateIds);\n  const byId = new Map(documents.map((doc) => [doc.id, doc]));\n  const rerankDocs = candidateIds.map((id) => ({\n    id,\n    text: byId.get(id)?.text ?? "Unknown collection item",\n  }));\n''',
    '''  const documents = await fetchDocuments(candidateIds);\n  const byId = new Map(documents.map((doc) => [doc.id, doc]));\n  // A row can be deleted between candidate selection and hydration. Only pass\n  // documents that are still visible to the reranker and final result set.\n  const visibleCandidateIds = candidateIds.filter((id) => byId.has(id));\n  const rerankDocs = visibleCandidateIds.map((id) => ({\n    id,\n    text: byId.get(id)!.text,\n  }));\n  if (rerankDocs.length === 0) return [];\n''',
)

pottery = "artifacts/api-server/src/routes/pottery/pottery.ts"
replace_once(
    pottery,
    '''        visualEmbeddingCol: "visual_embedding",\n        db,\n''',
    '''        visualEmbeddingCol: "visual_embedding",\n        visibilityWhere: isNull(potteryItems.deletedAt),\n        db,\n''',
)
replace_once(
    pottery,
    ".where(inArray(potteryItems.id, ids));",
    ".where(and(inArray(potteryItems.id, ids), isNull(potteryItems.deletedAt)));",
)
replace_once(
    pottery,
    ".where(inArray(potteryItems.id, pageIds));",
    ".where(and(inArray(potteryItems.id, pageIds), isNull(potteryItems.deletedAt)));",
)

orn = "artifacts/api-server/src/routes/ornaments/ornaments.ts"
replace_once(
    orn,
    '''      const extraWhere =\n        extraConditions.length > 0\n          ? and(...(extraConditions as [SQL, ...SQL[]]))\n          : undefined;\n''',
    '''      extraConditions.push(isNull(ornamentsItems.deletedAt));\n      const visibilityWhere = and(\n        ...(extraConditions as [SQL, ...SQL[]]),\n      )!;\n''',
)
replace_once(orn, "        extraWhere,", "        visibilityWhere,")
replace_once(
    orn,
    ".where(inArray(ornamentsItems.id, ids));",
    ".where(and(inArray(ornamentsItems.id, ids), isNull(ornamentsItems.deletedAt)));",
)
replace_once(
    orn,
    ".where(inArray(ornamentsItems.id, pageIds));",
    ".where(and(inArray(ornamentsItems.id, pageIds), isNull(ornamentsItems.deletedAt)));",
)

fabrics = "artifacts/api-server/src/routes/quilting/fabrics.ts"
replace_once(
    fabrics,
    '''        visualEmbeddingCol: "visual_embedding",\n        db,\n''',
    '''        visualEmbeddingCol: "visual_embedding",\n        visibilityWhere: isNull(fabrics.deletedAt),\n        db,\n''',
)
replace_once(
    fabrics,
    ".where(inArray(fabrics.id, ids));",
    ".where(and(inArray(fabrics.id, ids), isNull(fabrics.deletedAt)));",
)
replace_once(
    fabrics,
    ".where(inArray(fabrics.id, pageIds));",
    ".where(and(inArray(fabrics.id, pageIds), isNull(fabrics.deletedAt)));",
)
replace_all(
    fabrics,
    "where embedding is not null and id != ${id}",
    "where embedding is not null and deleted_at is null and id != ${id}",
    expected=1,
)
replace_all(
    fabrics,
    "where visual_embedding is not null and id != ${id}",
    "where visual_embedding is not null and deleted_at is null and id != ${id}",
    expected=1,
)

pot_compare = "artifacts/api-server/src/routes/pottery/compare.ts"
replace_once(
    pot_compare,
    'import { asc, getTableColumns, inArray, sql } from "drizzle-orm";',
    'import { and, asc, getTableColumns, inArray, isNull, sql } from "drizzle-orm";',
)
replace_all(
    pot_compare,
    "where embedding is not null",
    "where embedding is not null and deleted_at is null",
    expected=1,
)
replace_all(
    pot_compare,
    "where visual_embedding is not null",
    "where visual_embedding is not null and deleted_at is null",
    expected=1,
)
replace_all(
    pot_compare,
    "where zone_embedding is not null",
    "where zone_embedding is not null and deleted_at is null",
    expected=1,
)
replace_once(
    pot_compare,
    '''      .where(\n        inArray(\n          potteryItems.id,\n          mergedRanking.map((r) => r.id),\n        ),\n      );\n''',
    '''      .where(\n        and(\n          inArray(\n            potteryItems.id,\n            mergedRanking.map((r) => r.id),\n          ),\n          isNull(potteryItems.deletedAt),\n        ),\n      );\n''',
)

quilt_compare = "artifacts/api-server/src/routes/quilting/compare.ts"
qc = Path(quilt_compare).read_text()
qc_new, count = re.subn(
    r"where (embedding|visual_embedding) is not null(?! and deleted_at is null)",
    r"where \1 is not null and deleted_at is null",
    qc,
)
if count == 0:
    raise SystemExit("no quilting compare vector predicates were updated")
Path(quilt_compare).write_text(qc_new)

Path("artifacts/api-server/src/lib/purge-deleted.test.ts").write_text('''import { describe, expect, it } from "vitest";\nimport { readFileSync } from "node:fs";\nimport { fileURLToPath } from "node:url";\n\nconst source = readFileSync(\n  fileURLToPath(new URL("./purge-deleted.ts", import.meta.url)),\n  "utf8",\n);\n\ndescribe("permanent purge safety invariants", () => {\n  it("never filters polymorphic quilting images by entityId alone", () => {\n    expect(source).not.toContain(\n      ".where(inArray(quiltingImages.entityId, ids))",\n    );\n    expect(source).toContain('quiltingImagesWhere("fabric", ids)');\n    expect(source).toContain('quiltingImagesWhere("pattern", ids)');\n    expect(source).toContain('quiltingImagesWhere("quilt", ids)');\n  });\n\n  it("preserves database references when storage deletion fails", () => {\n    expect(source).toContain(\n      "Storage removal failed; retaining database rows for retry",\n    );\n    expect(source).toMatch(/if \(error\)[\\s\\S]*throw new Error/);\n  });\n});\n''')

Path("artifacts/api-server/src/lib/collection-search-visibility.test.ts").write_text('''import { describe, expect, it } from "vitest";\nimport { readFileSync } from "node:fs";\nimport { fileURLToPath } from "node:url";\n\nconst source = readFileSync(\n  fileURLToPath(new URL("./collection-search.ts", import.meta.url)),\n  "utf8",\n);\n\ndescribe("collection search visibility contract", () => {\n  it("requires a visibility predicate for every semantic search", () => {\n    expect(source).toContain("visibilityWhere: SQL");\n    expect(source).not.toContain("extraWhere?: SQL");\n    expect(source.match(/and \\${visibilityWhere}/g)).toHaveLength(2);\n  });\n\n  it("drops candidates that disappear before document hydration", () => {\n    expect(source).toContain(\n      "const visibleCandidateIds = candidateIds.filter((id) => byId.has(id))",\n    );\n  });\n});\n''')
