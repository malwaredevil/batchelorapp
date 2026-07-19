/**
 * Household knowledge graph routes (#239) — authenticated, household-shared.
 *
 * Entities, aliases, external identifiers, domain links, and relationships are
 * all fully household-shared: any authenticated member may read, create, edit,
 * or delete any record. There is no per-user ownership boundary here.
 *
 * Entity resolution is the primary intelligence feature: given a candidate
 * name/identifier, it returns the best-matching existing entity (or null) via
 * a staged cascade:
 *   1. Exact external identifier match (namespace + normalized value)
 *   2. Exact confirmed alias match (within entity type if provided)
 *   3. Normalized name exact match (within entity type if provided)
 *   4. Normalized name prefix/contains match (best-confidence wins)
 */

import { Router } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use("/knowledge", requireAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALLOWED_ENTITY_TYPES = new Set([
  "person",
  "place",
  "organization",
  "product",
  "event",
]);

const ALLOWED_LIFECYCLE_STATES = new Set(["active", "merged", "archived"]);

const ALLOWED_ALIAS_TYPES = new Set([
  "alternate_name",
  "former_name",
  "abbreviation",
  "transliteration",
  "nickname",
  "model_derived",
  "source_specific",
]);

const ALLOWED_NAMESPACES = new Set([
  "upc",
  "hallmark_product_number",
  "iata_airport",
  "google_place_id",
  "domain",
  "manufacturer_sku",
  "other",
]);

const ALLOWED_DOMAIN_TYPES = new Set([
  "pottery_item",
  "ornament_item",
  "quilting_fabric",
  "quilting_pattern",
  "quilting_quilt",
  "travels_trip",
  "travels_wishlist",
]);

const ALLOWED_RELATIONSHIP_ROLES = new Set([
  "represents",
  "maker",
  "manufacturer",
  "destination",
  "provider",
  "designer",
  "traveler",
  "source",
  "venue",
]);

const ALLOWED_PREDICATES = new Set([
  "prefers",
  "manufactures",
  "located_in",
  "occurs_at",
  "member_of",
  "part_of",
  "created_by",
  "associated_with",
]);

// ---------------------------------------------------------------------------
// GET /knowledge/entities
// ---------------------------------------------------------------------------

const EntityQuery = z.object({
  entityType: z.string().optional(),
  lifecycleState: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get("/knowledge/entities", async (req, res) => {
  const query = EntityQuery.parse(req.query);

  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];
  let idx = 1;

  if (query.entityType) {
    conditions.push(`entity_type = $${idx++}`);
    params.push(query.entityType);
  }
  if (query.lifecycleState) {
    conditions.push(`lifecycle_state = $${idx++}`);
    params.push(query.lifecycleState);
  } else {
    conditions.push(`lifecycle_state != 'archived'`);
  }
  if (query.search) {
    conditions.push(
      `(normalized_name ILIKE $${idx} OR display_name ILIKE $${idx})`,
    );
    params.push(`%${query.search}%`);
    idx++;
  }

  const where = conditions.join(" AND ");
  const { rows: entities } = await pool.query(
    `SELECT id, entity_type, display_name, normalized_name, summary,
            lifecycle_state, confidence, canonical, created_by_user_id,
            created_at, updated_at
     FROM knowledge_entities
     WHERE ${where}
     ORDER BY confidence DESC, display_name ASC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, query.limit, query.offset],
  );

  const { rows: total } = await pool.query(
    `SELECT COUNT(*) AS count FROM knowledge_entities WHERE ${where}`,
    params,
  );

  res.json({ entities, total: Number(total[0]?.count ?? 0) });
});

// ---------------------------------------------------------------------------
// POST /knowledge/entities
// ---------------------------------------------------------------------------

const CreateEntityBody = z.object({
  entityType: z.string(),
  displayName: z.string().min(1).max(500),
  summary: z.string().max(2000).optional(),
  confidence: z.number().min(0).max(1).default(1.0),
  canonical: z.boolean().default(false),
});

router.post("/knowledge/entities", async (req, res) => {
  const userId = req.session?.userId as number;
  const body = CreateEntityBody.parse(req.body);

  if (!ALLOWED_ENTITY_TYPES.has(body.entityType)) {
    res.status(400).json({ error: `Unknown entity_type: ${body.entityType}` });
    return;
  }

  const normalizedName = normalize(body.displayName);

  const { rows } = await pool.query(
    `INSERT INTO knowledge_entities
       (entity_type, display_name, normalized_name, summary, confidence,
        canonical, created_by_user_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     RETURNING *`,
    [
      body.entityType,
      body.displayName,
      normalizedName,
      body.summary ?? null,
      body.confidence,
      body.canonical,
      userId,
    ],
  );

  res.status(201).json(rows[0]);
});

// ---------------------------------------------------------------------------
// GET /knowledge/entities/:id
// ---------------------------------------------------------------------------

router.get("/knowledge/entities/:id", async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { rows: entity } = await pool.query(
    `SELECT * FROM knowledge_entities WHERE id = $1`,
    [id],
  );
  if (!entity.length) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [aliases, externalIds, links, relationships] = await Promise.all([
    pool.query(
      `SELECT * FROM knowledge_entity_aliases WHERE entity_id = $1 ORDER BY confirmed DESC, alias_text ASC`,
      [id],
    ),
    pool.query(
      `SELECT * FROM knowledge_external_identifiers WHERE entity_id = $1 ORDER BY namespace, identifier`,
      [id],
    ),
    pool.query(
      `SELECT * FROM knowledge_domain_links WHERE entity_id = $1 AND state = 'active' ORDER BY domain_type, record_id`,
      [id],
    ),
    pool.query(
      `SELECT r.*, s.display_name AS subject_name, o.display_name AS object_name
       FROM knowledge_relationships r
       JOIN knowledge_entities s ON s.id = r.subject_entity_id
       JOIN knowledge_entities o ON o.id = r.object_entity_id
       WHERE (r.subject_entity_id = $1 OR r.object_entity_id = $1)
         AND r.state = 'active'
       ORDER BY r.predicate, r.created_at`,
      [id],
    ),
  ]);

  res.json({
    ...entity[0],
    aliases: aliases.rows,
    externalIdentifiers: externalIds.rows,
    domainLinks: links.rows,
    relationships: relationships.rows,
  });
});

// ---------------------------------------------------------------------------
// PATCH /knowledge/entities/:id
// ---------------------------------------------------------------------------

const PatchEntityBody = z.object({
  displayName: z.string().min(1).max(500).optional(),
  summary: z.string().max(2000).nullable().optional(),
  lifecycleState: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  canonical: z.boolean().optional(),
  mergedIntoId: z.number().int().positive().nullable().optional(),
});

router.patch("/knowledge/entities/:id", async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = PatchEntityBody.parse(req.body);
  if (
    body.lifecycleState !== undefined &&
    !ALLOWED_LIFECYCLE_STATES.has(body.lifecycleState)
  ) {
    res
      .status(400)
      .json({ error: `Unknown lifecycle_state: ${body.lifecycleState}` });
    return;
  }

  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [];
  let idx = 1;

  if (body.displayName !== undefined) {
    sets.push(`display_name = $${idx++}`, `normalized_name = $${idx++}`);
    params.push(body.displayName, normalize(body.displayName));
  }
  if (body.summary !== undefined) {
    sets.push(`summary = $${idx++}`);
    params.push(body.summary);
  }
  if (body.lifecycleState !== undefined) {
    sets.push(`lifecycle_state = $${idx++}`);
    params.push(body.lifecycleState);
  }
  if (body.confidence !== undefined) {
    sets.push(`confidence = $${idx++}`);
    params.push(body.confidence);
  }
  if (body.canonical !== undefined) {
    sets.push(`canonical = $${idx++}`);
    params.push(body.canonical);
  }
  if (body.mergedIntoId !== undefined) {
    sets.push(`merged_into_id = $${idx++}`);
    params.push(body.mergedIntoId);
  }

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE knowledge_entities SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params,
  );

  if (!rows.length) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(rows[0]);
});

// ---------------------------------------------------------------------------
// DELETE /knowledge/entities/:id  (soft archive)
// ---------------------------------------------------------------------------

router.delete("/knowledge/entities/:id", async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { rowCount } = await pool.query(
    `UPDATE knowledge_entities SET lifecycle_state = 'archived', updated_at = now() WHERE id = $1`,
    [id],
  );
  if (!rowCount) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// POST /knowledge/entities/resolve — entity resolution (staged cascade)
// ---------------------------------------------------------------------------

const ResolveBody = z.object({
  displayName: z.string().min(1).max(500),
  entityType: z.string().optional(),
  namespace: z.string().optional(),
  identifier: z.string().optional(),
});

router.post("/knowledge/entities/resolve", async (req, res) => {
  const body = ResolveBody.parse(req.body);
  const normalizedName = normalize(body.displayName);

  // Stage 1: Exact external identifier match
  if (body.namespace && body.identifier) {
    const normalizedId = normalize(body.identifier);
    const { rows } = await pool.query(
      `SELECT e.* FROM knowledge_entities e
       JOIN knowledge_external_identifiers x ON x.entity_id = e.id
       WHERE x.namespace = $1 AND x.normalized_identifier = $2
         AND e.lifecycle_state = 'active'
       ORDER BY e.confidence DESC LIMIT 1`,
      [body.namespace, normalizedId],
    );
    if (rows.length) {
      res.json({ entity: rows[0], matchStage: "external_identifier" });
      return;
    }
  }

  // Stage 2: Exact confirmed alias match
  const aliasParams: unknown[] = [normalizedName];
  let aliasFilter = "";
  if (body.entityType) {
    aliasFilter = " AND e.entity_type = $2";
    aliasParams.push(body.entityType);
  }
  const { rows: aliasRows } = await pool.query(
    `SELECT e.* FROM knowledge_entities e
     JOIN knowledge_entity_aliases a ON a.entity_id = e.id
     WHERE a.normalized_alias = $1 AND a.confirmed = true
       AND e.lifecycle_state = 'active'${aliasFilter}
     ORDER BY e.confidence DESC LIMIT 1`,
    aliasParams,
  );
  if (aliasRows.length) {
    res.json({ entity: aliasRows[0], matchStage: "confirmed_alias" });
    return;
  }

  // Stage 3: Normalized name exact match
  const nameParams: unknown[] = [normalizedName];
  let nameFilter = "";
  if (body.entityType) {
    nameFilter = " AND entity_type = $2";
    nameParams.push(body.entityType);
  }
  const { rows: nameRows } = await pool.query(
    `SELECT * FROM knowledge_entities
     WHERE normalized_name = $1 AND lifecycle_state = 'active'${nameFilter}
     ORDER BY confidence DESC, canonical DESC LIMIT 1`,
    nameParams,
  );
  if (nameRows.length) {
    res.json({ entity: nameRows[0], matchStage: "normalized_name" });
    return;
  }

  // Stage 4: Prefix/contains match (best confidence wins)
  const fuzzyParams: unknown[] = [`%${normalizedName}%`];
  let fuzzyFilter = "";
  if (body.entityType) {
    fuzzyFilter = " AND entity_type = $2";
    fuzzyParams.push(body.entityType);
  }
  const { rows: fuzzyRows } = await pool.query(
    `SELECT * FROM knowledge_entities
     WHERE normalized_name LIKE $1 AND lifecycle_state = 'active'${fuzzyFilter}
     ORDER BY confidence DESC, canonical DESC LIMIT 1`,
    fuzzyParams,
  );
  if (fuzzyRows.length) {
    res.json({ entity: fuzzyRows[0], matchStage: "fuzzy_name" });
    return;
  }

  res.json({ entity: null, matchStage: null });
});

// ---------------------------------------------------------------------------
// POST /knowledge/entities/:id/aliases
// ---------------------------------------------------------------------------

const AddAliasBody = z.object({
  aliasText: z.string().min(1).max(500),
  aliasType: z.string().default("alternate_name"),
  locale: z.string().max(20).optional(),
  source: z.string().max(200).optional(),
  confirmed: z.boolean().default(false),
});

router.post("/knowledge/entities/:id/aliases", async (req, res) => {
  const entityId = parseInt(req.params["id"] as string, 10);
  if (!Number.isFinite(entityId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = AddAliasBody.parse(req.body);
  if (!ALLOWED_ALIAS_TYPES.has(body.aliasType)) {
    res.status(400).json({ error: `Unknown alias_type: ${body.aliasType}` });
    return;
  }

  const { rows } = await pool.query(
    `INSERT INTO knowledge_entity_aliases
       (entity_id, alias_text, normalized_alias, alias_type, locale, source, confirmed)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (entity_id, normalized_alias) DO UPDATE
       SET alias_type = EXCLUDED.alias_type,
           confirmed = EXCLUDED.confirmed OR knowledge_entity_aliases.confirmed
     RETURNING *`,
    [
      entityId,
      body.aliasText,
      normalize(body.aliasText),
      body.aliasType,
      body.locale ?? null,
      body.source ?? null,
      body.confirmed,
    ],
  );
  res.status(201).json(rows[0]);
});

// ---------------------------------------------------------------------------
// DELETE /knowledge/entities/:id/aliases/:aliasId
// ---------------------------------------------------------------------------

router.delete("/knowledge/entities/:id/aliases/:aliasId", async (req, res) => {
  const entityId = parseInt(req.params["id"] as string, 10);
  const aliasId = parseInt(req.params["aliasId"] as string, 10);
  if (!Number.isFinite(entityId) || !Number.isFinite(aliasId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { rowCount } = await pool.query(
    `DELETE FROM knowledge_entity_aliases WHERE id = $1 AND entity_id = $2`,
    [aliasId, entityId],
  );
  if (!rowCount) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// POST /knowledge/entities/:id/identifiers
// ---------------------------------------------------------------------------

const AddIdentifierBody = z.object({
  namespace: z.string(),
  identifier: z.string().min(1).max(500),
  scope: z.string().max(100).optional(),
  provenance: z.string().max(500).optional(),
  confirmed: z.boolean().default(false),
});

router.post("/knowledge/entities/:id/identifiers", async (req, res) => {
  const entityId = parseInt(req.params["id"] as string, 10);
  if (!Number.isFinite(entityId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = AddIdentifierBody.parse(req.body);
  if (!ALLOWED_NAMESPACES.has(body.namespace)) {
    res.status(400).json({ error: `Unknown namespace: ${body.namespace}` });
    return;
  }

  const { rows } = await pool.query(
    `INSERT INTO knowledge_external_identifiers
       (entity_id, namespace, identifier, normalized_identifier, scope, provenance, confirmed)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (namespace, normalized_identifier, scope) DO UPDATE
       SET entity_id = EXCLUDED.entity_id,
           confirmed = EXCLUDED.confirmed OR knowledge_external_identifiers.confirmed
     RETURNING *`,
    [
      entityId,
      body.namespace,
      body.identifier,
      normalize(body.identifier),
      body.scope ?? null,
      body.provenance ?? null,
      body.confirmed,
    ],
  );
  res.status(201).json(rows[0]);
});

// ---------------------------------------------------------------------------
// DELETE /knowledge/entities/:id/identifiers/:identifierId
// ---------------------------------------------------------------------------

router.delete(
  "/knowledge/entities/:id/identifiers/:identifierId",
  async (req, res) => {
    const entityId = parseInt(req.params["id"] as string, 10);
    const identifierId = parseInt(req.params["identifierId"] as string, 10);
    if (!Number.isFinite(entityId) || !Number.isFinite(identifierId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { rowCount } = await pool.query(
      `DELETE FROM knowledge_external_identifiers WHERE id = $1 AND entity_id = $2`,
      [identifierId, entityId],
    );
    if (!rowCount) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).send();
  },
);

// ---------------------------------------------------------------------------
// POST /knowledge/entities/:id/links
// ---------------------------------------------------------------------------

const AddLinkBody = z.object({
  domainType: z.string(),
  recordId: z.number().int().positive(),
  relationshipRole: z.string().default("represents"),
  provenance: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1).default(1.0),
});

router.post("/knowledge/entities/:id/links", async (req, res) => {
  const entityId = parseInt(req.params["id"] as string, 10);
  if (!Number.isFinite(entityId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = AddLinkBody.parse(req.body);
  if (!ALLOWED_DOMAIN_TYPES.has(body.domainType)) {
    res.status(400).json({ error: `Unknown domain_type: ${body.domainType}` });
    return;
  }
  if (!ALLOWED_RELATIONSHIP_ROLES.has(body.relationshipRole)) {
    res
      .status(400)
      .json({ error: `Unknown relationship_role: ${body.relationshipRole}` });
    return;
  }

  const userId = req.session?.userId as number;
  const { rows } = await pool.query(
    `INSERT INTO knowledge_domain_links
       (entity_id, domain_type, record_id, relationship_role, provenance,
        confidence, state, decided_by_user_id, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, now())
     ON CONFLICT (entity_id, domain_type, record_id, relationship_role) DO UPDATE
       SET state = 'active', confidence = EXCLUDED.confidence,
           decided_by_user_id = EXCLUDED.decided_by_user_id, decided_at = now()
     RETURNING *`,
    [
      entityId,
      body.domainType,
      body.recordId,
      body.relationshipRole,
      body.provenance ?? null,
      body.confidence,
      userId,
    ],
  );
  res.status(201).json(rows[0]);
});

// ---------------------------------------------------------------------------
// DELETE /knowledge/entities/:id/links/:linkId
// ---------------------------------------------------------------------------

router.delete("/knowledge/entities/:id/links/:linkId", async (req, res) => {
  const entityId = parseInt(req.params["id"] as string, 10);
  const linkId = parseInt(req.params["linkId"] as string, 10);
  if (!Number.isFinite(entityId) || !Number.isFinite(linkId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { rowCount } = await pool.query(
    `UPDATE knowledge_domain_links SET state = 'inactive'
     WHERE id = $1 AND entity_id = $2`,
    [linkId, entityId],
  );
  if (!rowCount) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// POST /knowledge/relationships
// ---------------------------------------------------------------------------

const CreateRelationshipBody = z.object({
  subjectEntityId: z.number().int().positive(),
  predicate: z.string(),
  objectEntityId: z.number().int().positive(),
  effectiveFrom: z.string().datetime().optional(),
  effectiveUntil: z.string().datetime().optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  provenance: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1).default(1.0),
});

router.post("/knowledge/relationships", async (req, res) => {
  const body = CreateRelationshipBody.parse(req.body);
  if (!ALLOWED_PREDICATES.has(body.predicate)) {
    res.status(400).json({ error: `Unknown predicate: ${body.predicate}` });
    return;
  }
  if (body.subjectEntityId === body.objectEntityId) {
    res.status(400).json({ error: "Subject and object must differ" });
    return;
  }

  const { rows } = await pool.query(
    `INSERT INTO knowledge_relationships
       (subject_entity_id, predicate, object_entity_id, effective_from,
        effective_until, attributes, provenance, confidence, state, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'active', now())
     RETURNING *`,
    [
      body.subjectEntityId,
      body.predicate,
      body.objectEntityId,
      body.effectiveFrom ?? null,
      body.effectiveUntil ?? null,
      JSON.stringify(body.attributes),
      body.provenance ?? null,
      body.confidence,
    ],
  );
  res.status(201).json(rows[0]);
});

// ---------------------------------------------------------------------------
// PATCH /knowledge/relationships/:id
// ---------------------------------------------------------------------------

const PatchRelationshipBody = z.object({
  predicate: z.string().optional(),
  effectiveFrom: z.string().datetime().nullable().optional(),
  effectiveUntil: z.string().datetime().nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  provenance: z.string().max(500).nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  state: z.string().optional(),
});

router.patch("/knowledge/relationships/:id", async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = PatchRelationshipBody.parse(req.body);
  if (body.predicate !== undefined && !ALLOWED_PREDICATES.has(body.predicate)) {
    res.status(400).json({ error: `Unknown predicate: ${body.predicate}` });
    return;
  }

  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [];
  let idx = 1;

  if (body.predicate !== undefined) {
    sets.push(`predicate = $${idx++}`);
    params.push(body.predicate);
  }
  if (body.effectiveFrom !== undefined) {
    sets.push(`effective_from = $${idx++}`);
    params.push(body.effectiveFrom);
  }
  if (body.effectiveUntil !== undefined) {
    sets.push(`effective_until = $${idx++}`);
    params.push(body.effectiveUntil);
  }
  if (body.attributes !== undefined) {
    sets.push(`attributes = $${idx++}::jsonb`);
    params.push(JSON.stringify(body.attributes));
  }
  if (body.provenance !== undefined) {
    sets.push(`provenance = $${idx++}`);
    params.push(body.provenance);
  }
  if (body.confidence !== undefined) {
    sets.push(`confidence = $${idx++}`);
    params.push(body.confidence);
  }
  if (body.state !== undefined) {
    sets.push(`state = $${idx++}`);
    params.push(body.state);
  }

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE knowledge_relationships SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params,
  );
  if (!rows.length) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(rows[0]);
});

// ---------------------------------------------------------------------------
// DELETE /knowledge/relationships/:id
// ---------------------------------------------------------------------------

router.delete("/knowledge/relationships/:id", async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { rowCount } = await pool.query(
    `UPDATE knowledge_relationships SET state = 'inactive', updated_at = now() WHERE id = $1`,
    [id],
  );
  if (!rowCount) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

export default router;
