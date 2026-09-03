/**
 * Regression coverage for literal gallery search indexes.
 *
 * The route tests intentionally mock the database, so they cannot tell us if
 * the substring predicates have usable indexes. Keep this inventory alongside
 * the search adapter contract: if a searchable field is added without a
 * matching partial pg_trgm index in schema-statements.ts, this suite fails.
 *
 * PostgreSQL may still choose a sequential scan for very small tables or
 * patterns shorter than three characters. The invariant here is that every
 * searchable expression has the index support needed at collection scale.
 */

import { describe, expect, it } from "vitest";
import { STATEMENTS } from "../../../../lib/db/src/schema-statements";

type SearchIndex = {
  table: string;
  name: string;
  expression: string;
};

const SEARCH_INDEXES: SearchIndex[] = [
  { table: "magnets_items", name: "name", expression: "name" },
  { table: "magnets_items", name: "notes", expression: "notes" },
  { table: "magnets_items", name: "description", expression: "description" },

  { table: "ornaments_items", name: "name", expression: "name" },
  {
    table: "ornaments_items",
    name: "series",
    expression: "series_or_collection",
  },
  { table: "ornaments_items", name: "brand", expression: "brand" },
  { table: "ornaments_items", name: "notes", expression: "notes" },
  { table: "ornaments_items", name: "description", expression: "description" },
  {
    table: "ornaments_items",
    name: "ai_description",
    expression: "ai_description",
  },

  { table: "pottery_items", name: "name", expression: "name" },
  {
    table: "pottery_items",
    name: "pattern_description",
    expression: "pattern_description",
  },
  { table: "pottery_items", name: "style", expression: "style" },
  { table: "pottery_items", name: "shape", expression: "shape" },
  { table: "pottery_items", name: "maker", expression: "maker" },
  {
    table: "pottery_items",
    name: "maker_info",
    expression: "maker_info",
  },
  { table: "pottery_items", name: "notes", expression: "notes" },
  {
    table: "pottery_items",
    name: "ai_description",
    expression: "ai_description",
  },
  {
    table: "pottery_items",
    name: "motifs",
    expression: "collection_search_text(motifs)",
  },

  {
    table: "quilting_finished_quilts",
    name: "name",
    expression: "name",
  },
  {
    table: "quilting_finished_quilts",
    name: "recipient",
    expression: "recipient",
  },
  {
    table: "quilting_finished_quilts",
    name: "notes",
    expression: "notes",
  },

  { table: "quilting_patterns", name: "name", expression: "name" },
  { table: "quilting_patterns", name: "designer", expression: "designer" },
  {
    table: "quilting_patterns",
    name: "block_size",
    expression: "block_size",
  },
  {
    table: "quilting_patterns",
    name: "difficulty",
    expression: "difficulty",
  },
  {
    table: "quilting_patterns",
    name: "source_type",
    expression: "source_type",
  },
  {
    table: "quilting_patterns",
    name: "source_reference",
    expression: "source_reference",
  },
  { table: "quilting_patterns", name: "notes", expression: "notes" },
  {
    table: "quilting_patterns",
    name: "publication_name",
    expression: "publication_name",
  },

  { table: "quilting_fabrics", name: "name", expression: "name" },
  {
    table: "quilting_fabrics",
    name: "line_name",
    expression: "line_name",
  },
  { table: "quilting_fabrics", name: "designer", expression: "designer" },
  {
    table: "quilting_fabrics",
    name: "manufacturer",
    expression: "manufacturer",
  },
  { table: "quilting_fabrics", name: "colorway", expression: "colorway" },
  {
    table: "quilting_fabrics",
    name: "print_type",
    expression: "print_type",
  },
  {
    table: "quilting_fabrics",
    name: "fiber_content",
    expression: "fiber_content",
  },
  { table: "quilting_fabrics", name: "sku", expression: "sku" },
  { table: "quilting_fabrics", name: "notes", expression: "notes" },
  {
    table: "quilting_fabrics",
    name: "ai_description",
    expression: "ai_description",
  },
  {
    table: "quilting_fabrics",
    name: "motifs",
    expression: "collection_search_text(motifs)",
  },
  {
    table: "quilting_fabrics",
    name: "style_descriptors",
    expression: "collection_search_text(style_descriptors)",
  },
];

function indexName({ table, name }: SearchIndex): string {
  return `${table}_${name}_trgm_idx`;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

describe("collection literal-search indexes", () => {
  it("enables pg_trgm before collection indexes are applied", () => {
    expect(
      STATEMENTS.some((statement) =>
        /^create extension if not exists pg_trgm$/i.test(statement.trim()),
      ),
    ).toBe(true);
  });

  it("uses an immutable wrapper for indexed array search expressions", () => {
    const functionStatement = STATEMENTS.find((statement) =>
      /create or replace function collection_search_text/i.test(statement),
    );

    expect(
      functionStatement,
      "Missing collection_search_text() DDL",
    ).toBeDefined();
    const normalized = normalizeSql(functionStatement ?? "");
    expect(normalized).toContain("returns text");
    expect(normalized).toContain("immutable");
    expect(normalized).toContain("array_to_string(text_values, ' ')");
  });

  it.each(SEARCH_INDEXES)(
    "defines a partial GIN trigram index for $table.$name",
    (expected) => {
      const name = indexName(expected);
      const statement = STATEMENTS.find((candidate) =>
        candidate.toLowerCase().includes(`create index if not exists ${name}`),
      );

      expect(statement, `Missing DDL for ${name}`).toBeDefined();
      const normalized = normalizeSql(statement ?? "");
      expect(normalized).toContain(
        `on ${expected.table} using gin (${expected.expression.toLowerCase()} gin_trgm_ops)`,
      );
      expect(normalized).toContain("where deleted_at is null");
    },
  );

  it("creates each collection table before its search indexes", () => {
    for (const { table } of SEARCH_INDEXES) {
      const tableStatementIndex = STATEMENTS.findIndex((statement) =>
        statement.toLowerCase().includes(`create table if not exists ${table}`),
      );
      const firstIndexStatementIndex = STATEMENTS.findIndex((statement) =>
        statement
          .toLowerCase()
          .includes(`create index if not exists ${table}_`),
      );

      expect(
        tableStatementIndex,
        `Missing table DDL for ${table}`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        firstIndexStatementIndex,
        `Missing search index DDL for ${table}`,
      ).toBeGreaterThan(tableStatementIndex);
    }
  });

  it("keeps the inventory free of duplicate index names", () => {
    const names = SEARCH_INDEXES.map(indexName);
    expect(new Set(names).size).toBe(names.length);
  });
});
