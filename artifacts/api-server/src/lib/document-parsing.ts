// Shared document text-extraction — turns an uploaded PDF, CSV, DOCX, or
// XLSX attachment into plain text the model can read, the same way an image
// attachment is read via vision. Mirrors the shape of
// lib/travel-document-extraction.ts (which stays focused on the AI-driven
// travel-document field extraction pipeline); this module is the generic
// "get readable text out of a file" counterpart used by Elaine's chat
// attachment upload route.
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import type { SupportedDocMimeType } from "@workspace/upload-validation";

// Matches the existing PDF truncation length used by the chat attachment
// route (elaine/index.ts) so all document types get consistent, bounded
// context — long documents are summarised by truncation, not an error.
const MAX_EXTRACTED_CHARS = 8000;
const MAX_XLSX_ROWS_PER_SHEET = 200;

function truncate(text: string): string {
  return text.slice(0, MAX_EXTRACTED_CHARS);
}

async function extractCsvText(buffer: Buffer): Promise<string> {
  const rows = parseCsv(buffer, {
    skip_empty_lines: true,
    relax_column_count: true,
  }) as string[][];
  return rows.map((row) => row.join(", ")).join("\n");
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

async function extractXlsxText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheetBlocks: string[] = [];
  workbook.eachSheet((sheet) => {
    const lines: string[] = [`Sheet: ${sheet.name}`];
    let rowCount = 0;
    sheet.eachRow((row) => {
      if (rowCount >= MAX_XLSX_ROWS_PER_SHEET) return;
      const cells = (row.values as unknown[]).slice(1).map((v) => {
        if (v === null || v === undefined) return "";
        if (typeof v === "object" && "text" in (v as Record<string, unknown>))
          return String((v as { text: unknown }).text);
        if (typeof v === "object" && "result" in (v as Record<string, unknown>))
          return String((v as { result: unknown }).result);
        return String(v);
      });
      lines.push(cells.join(", "));
      rowCount++;
    });
    sheetBlocks.push(lines.join("\n"));
  });
  return sheetBlocks.join("\n\n");
}

/**
 * Extract readable text from a supported document buffer. Returns
 * `undefined` for image MIME types (they're read via vision, not text
 * extraction) and on any parse failure — callers should treat extraction as
 * best-effort and never fail the upload itself if this throws or returns
 * undefined.
 */
export async function extractDocumentText(
  buffer: Buffer,
  mimeType: SupportedDocMimeType,
): Promise<string | undefined> {
  try {
    switch (mimeType) {
      case "application/pdf": {
        const parsed = await pdfParse(buffer);
        return truncate(parsed.text ?? "") || undefined;
      }
      case "text/csv":
        return truncate(await extractCsvText(buffer)) || undefined;
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return truncate(await extractDocxText(buffer)) || undefined;
      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        return truncate(await extractXlsxText(buffer)) || undefined;
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

/** Maps a document MIME type to the short type tag used across attachment types. */
export function docTypeTagForMime(
  mimeType: SupportedDocMimeType,
): "pdf" | "csv" | "docx" | "xlsx" | "image" {
  switch (mimeType) {
    case "application/pdf":
      return "pdf";
    case "text/csv":
      return "csv";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "xlsx";
    default:
      return "image";
  }
}
