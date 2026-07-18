/**
 * Ingestion framework types (#230).
 *
 * Defines the shared contract between the adapter layer (Apify, REST, webhook)
 * and the ingestion coordinator that creates runs + candidates in the DB.
 */

export interface IngestionItem {
  sourceKey: string;
  normalizedData: Record<string, unknown>;
  confidenceScore?: number;
  targetType?: string;
  targetId?: number;
}

export interface IngestionAdapterConfig {
  [key: string]: unknown;
}

export interface IngestionContext {
  sourceId: number;
  runId: number;
  module: string;
  feature?: string;
  userId?: number;
}

export interface IngestionAdapter {
  readonly adapterType: string;
  fetchItems(
    config: IngestionAdapterConfig,
    context: IngestionContext,
  ): AsyncGenerator<IngestionItem> | Promise<IngestionItem[]>;
}

export type IngestionRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type IngestionCandidateStatus =
  | "pending"
  | "matched"
  | "merged"
  | "rejected";

export type IngestionAdapterType = "apify" | "rest" | "webhook" | "manual";
