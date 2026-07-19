import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  real,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { appUsers } from "./users";

// ---------------------------------------------------------------------------
// Controlled value sets (used in routes for validation — not FK constraints)
// ---------------------------------------------------------------------------

export const KNOWLEDGE_ENTITY_TYPES = [
  "person",
  "place",
  "organization",
  "product",
  "event",
] as const;
export type KnowledgeEntityType = (typeof KNOWLEDGE_ENTITY_TYPES)[number];

export const KNOWLEDGE_LIFECYCLE_STATES = [
  "active",
  "merged",
  "archived",
] as const;
export type KnowledgeLifecycleState =
  (typeof KNOWLEDGE_LIFECYCLE_STATES)[number];

export const KNOWLEDGE_ALIAS_TYPES = [
  "alternate_name",
  "former_name",
  "abbreviation",
  "transliteration",
  "nickname",
  "model_derived",
  "source_specific",
] as const;
export type KnowledgeAliasType = (typeof KNOWLEDGE_ALIAS_TYPES)[number];

export const KNOWLEDGE_EXTERNAL_ID_NAMESPACES = [
  "upc",
  "hallmark_product_number",
  "iata_airport",
  "google_place_id",
  "domain",
  "manufacturer_sku",
  "other",
] as const;
export type KnowledgeExternalIdNamespace =
  (typeof KNOWLEDGE_EXTERNAL_ID_NAMESPACES)[number];

export const KNOWLEDGE_DOMAIN_TYPES = [
  "pottery_item",
  "ornament_item",
  "quilting_fabric",
  "quilting_pattern",
  "quilting_quilt",
  "travels_trip",
  "travels_wishlist",
] as const;
export type KnowledgeDomainType = (typeof KNOWLEDGE_DOMAIN_TYPES)[number];

export const KNOWLEDGE_RELATIONSHIP_ROLES = [
  "represents",
  "maker",
  "manufacturer",
  "destination",
  "provider",
  "designer",
  "traveler",
  "source",
  "venue",
] as const;
export type KnowledgeRelationshipRole =
  (typeof KNOWLEDGE_RELATIONSHIP_ROLES)[number];

export const KNOWLEDGE_PREDICATES = [
  "prefers",
  "manufactures",
  "located_in",
  "occurs_at",
  "member_of",
  "part_of",
  "created_by",
  "associated_with",
] as const;
export type KnowledgePredicate = (typeof KNOWLEDGE_PREDICATES)[number];

// ---------------------------------------------------------------------------
// knowledge_entities
// ---------------------------------------------------------------------------

export const knowledgeEntities = pgTable("knowledge_entities", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  displayName: text("display_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  summary: text("summary"),
  lifecycleState: text("lifecycle_state").notNull().default("active"),
  confidence: real("confidence").notNull().default(1.0),
  canonical: boolean("canonical").notNull().default(false),
  mergedIntoId: integer("merged_into_id"),
  createdByUserId: integer("created_by_user_id").references(() => appUsers.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

// ---------------------------------------------------------------------------
// knowledge_entity_aliases
// ---------------------------------------------------------------------------

export const knowledgeEntityAliases = pgTable(
  "knowledge_entity_aliases",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => knowledgeEntities.id, { onDelete: "cascade" }),
    aliasText: text("alias_text").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    aliasType: text("alias_type").notNull().default("alternate_name"),
    locale: text("locale"),
    source: text("source"),
    confirmed: boolean("confirmed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique().on(t.entityId, t.normalizedAlias)],
).enableRLS();

// ---------------------------------------------------------------------------
// knowledge_external_identifiers
// ---------------------------------------------------------------------------

export const knowledgeExternalIdentifiers = pgTable(
  "knowledge_external_identifiers",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => knowledgeEntities.id, { onDelete: "cascade" }),
    namespace: text("namespace").notNull(),
    identifier: text("identifier").notNull(),
    normalizedIdentifier: text("normalized_identifier").notNull(),
    scope: text("scope"),
    provenance: text("provenance"),
    confirmed: boolean("confirmed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique().on(t.namespace, t.normalizedIdentifier, t.scope)],
).enableRLS();

// ---------------------------------------------------------------------------
// knowledge_domain_links
// ---------------------------------------------------------------------------

export const knowledgeDomainLinks = pgTable(
  "knowledge_domain_links",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => knowledgeEntities.id, { onDelete: "cascade" }),
    domainType: text("domain_type").notNull(),
    recordId: integer("record_id").notNull(),
    relationshipRole: text("relationship_role").notNull().default("represents"),
    provenance: text("provenance"),
    confidence: real("confidence").notNull().default(1.0),
    state: text("state").notNull().default("active"),
    decidedByUserId: integer("decided_by_user_id").references(
      () => appUsers.id,
      { onDelete: "set null" },
    ),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique().on(t.entityId, t.domainType, t.recordId, t.relationshipRole),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// knowledge_relationships
// ---------------------------------------------------------------------------

export const knowledgeRelationships = pgTable("knowledge_relationships", {
  id: serial("id").primaryKey(),
  subjectEntityId: integer("subject_entity_id")
    .notNull()
    .references(() => knowledgeEntities.id, { onDelete: "cascade" }),
  predicate: text("predicate").notNull(),
  objectEntityId: integer("object_entity_id")
    .notNull()
    .references(() => knowledgeEntities.id, { onDelete: "cascade" }),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  attributes: jsonb("attributes")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  provenance: text("provenance"),
  confidence: real("confidence").notNull().default(1.0),
  state: text("state").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type KnowledgeEntityRow = typeof knowledgeEntities.$inferSelect;
export type InsertKnowledgeEntity = typeof knowledgeEntities.$inferInsert;
export type KnowledgeEntityAliasRow =
  typeof knowledgeEntityAliases.$inferSelect;
export type InsertKnowledgeEntityAlias =
  typeof knowledgeEntityAliases.$inferInsert;
export type KnowledgeExternalIdentifierRow =
  typeof knowledgeExternalIdentifiers.$inferSelect;
export type InsertKnowledgeExternalIdentifier =
  typeof knowledgeExternalIdentifiers.$inferInsert;
export type KnowledgeDomainLinkRow = typeof knowledgeDomainLinks.$inferSelect;
export type InsertKnowledgeDomainLink =
  typeof knowledgeDomainLinks.$inferInsert;
export type KnowledgeRelationshipRow =
  typeof knowledgeRelationships.$inferSelect;
export type InsertKnowledgeRelationship =
  typeof knowledgeRelationships.$inferInsert;
