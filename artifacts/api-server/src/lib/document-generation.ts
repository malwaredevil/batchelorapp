// Shared document generation — turns a structured spec produced by Elaine's
// `generate_document` tool into a real downloadable file buffer for PDF,
// DOCX, CSV, or XLSX. Kept deliberately declarative (headings/paragraphs/
// bullets/tables) rather than exposing per-library formatting primitives, so
// the model has a small, predictable surface to fill in regardless of format.
import PDFDocument from "pdfkit";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";
import ExcelJS from "exceljs";
import { stringify as stringifyCsv } from "csv-stringify/sync";

export interface DocumentTableSpec {
  headers: string[];
  rows: (string | number)[][];
}

export interface DocumentSectionSpec {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
  table?: DocumentTableSpec;
}

export interface StructuredDocumentSpec {
  title?: string;
  sections: DocumentSectionSpec[];
}

export interface TabularDocumentSpec {
  sheetName?: string;
  table: DocumentTableSpec;
}

const MAX_TABLE_ROWS = 2000;

function clampTable(table: DocumentTableSpec): DocumentTableSpec {
  return {
    headers: table.headers,
    rows: table.rows.slice(0, MAX_TABLE_ROWS),
  };
}

// ---------------------------------------------------------------------------
// PDF (pdfkit) — chosen over pdfmake because it ships no external font/VFS
// files to bundle (pdfmake's default fonts require a separate asset step
// that's brittle in this container), and its imperative drawing API is a
// natural fit for the small fixed set of blocks we render (heading,
// paragraph, bullet list, simple table).
// ---------------------------------------------------------------------------
export async function generatePdf(
  spec: StructuredDocumentSpec,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 54, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    if (spec.title) {
      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .text(spec.title, { align: "left" });
      doc.moveDown(0.75);
    }

    for (const section of spec.sections) {
      if (section.heading) {
        doc.fontSize(14).font("Helvetica-Bold").text(section.heading);
        doc.moveDown(0.35);
      }
      if (section.paragraphs) {
        doc.fontSize(11).font("Helvetica");
        for (const para of section.paragraphs) {
          doc.text(para, { align: "left" });
          doc.moveDown(0.35);
        }
      }
      if (section.bullets && section.bullets.length > 0) {
        doc.fontSize(11).font("Helvetica");
        for (const bullet of section.bullets) {
          doc.text(`•  ${bullet}`, { indent: 12 });
        }
        doc.moveDown(0.35);
      }
      if (section.table) {
        const table = clampTable(section.table);
        const colWidth = (doc.page.width - 108) / table.headers.length;
        doc.fontSize(10).font("Helvetica-Bold");
        const startX = doc.x;
        let y = doc.y;
        table.headers.forEach((header, i) => {
          doc.text(header, startX + i * colWidth, y, { width: colWidth });
        });
        y = doc.y + 4;
        doc
          .moveTo(startX, y)
          .lineTo(startX + colWidth * table.headers.length, y)
          .stroke();
        y += 6;
        doc.font("Helvetica").fontSize(10);
        for (const row of table.rows) {
          const rowStartY = y;
          let maxHeight = 0;
          row.forEach((cell, i) => {
            const height = doc.heightOfString(String(cell), {
              width: colWidth,
            });
            maxHeight = Math.max(maxHeight, height);
            doc.text(String(cell), startX + i * colWidth, rowStartY, {
              width: colWidth,
            });
          });
          y = rowStartY + maxHeight + 6;
          if (y > doc.page.height - 72) {
            doc.addPage();
            y = doc.y;
          }
        }
        doc.y = y;
        doc.moveDown(0.5);
      }
    }

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// DOCX (docx package)
// ---------------------------------------------------------------------------
export async function generateDocx(
  spec: StructuredDocumentSpec,
): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  if (spec.title) {
    children.push(
      new Paragraph({ text: spec.title, heading: HeadingLevel.TITLE }),
    );
  }

  for (const section of spec.sections) {
    if (section.heading) {
      children.push(
        new Paragraph({
          text: section.heading,
          heading: HeadingLevel.HEADING_1,
        }),
      );
    }
    for (const para of section.paragraphs ?? []) {
      children.push(new Paragraph({ children: [new TextRun(para)] }));
    }
    for (const bullet of section.bullets ?? []) {
      children.push(new Paragraph({ text: bullet, bullet: { level: 0 } }));
    }
    if (section.table) {
      const table = clampTable(section.table);
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: table.headers.map(
                (header) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: header, bold: true })],
                      }),
                    ],
                  }),
              ),
            }),
            ...table.rows.map(
              (row) =>
                new TableRow({
                  children: row.map(
                    (cell) =>
                      new TableCell({
                        children: [new Paragraph(String(cell))],
                      }),
                  ),
                }),
            ),
          ],
        }),
      );
      // Blank spacer paragraph after a table — docx renders tables back-to-back otherwise.
      children.push(new Paragraph({ text: "" }));
    }
  }

  const document = new Document({
    sections: [{ children }],
  });
  return Packer.toBuffer(document);
}

// ---------------------------------------------------------------------------
// CSV (csv-stringify)
// ---------------------------------------------------------------------------
export function generateCsv(spec: TabularDocumentSpec): Buffer {
  const table = clampTable(spec.table);
  const csv = stringifyCsv([table.headers, ...table.rows]);
  return Buffer.from(csv, "utf-8");
}

// ---------------------------------------------------------------------------
// XLSX (exceljs)
// ---------------------------------------------------------------------------
export async function generateXlsx(spec: TabularDocumentSpec): Promise<Buffer> {
  const table = clampTable(spec.table);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(spec.sheetName?.slice(0, 31) || "Sheet1");
  sheet.addRow(table.headers);
  sheet.getRow(1).font = { bold: true };
  for (const row of table.rows) {
    sheet.addRow(row);
  }
  sheet.columns.forEach((col) => {
    let maxLen = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      maxLen = Math.max(maxLen, String(cell.value ?? "").length + 2);
    });
    col.width = Math.min(maxLen, 40);
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export interface GenerateDocumentPayload {
  format: "pdf" | "docx" | "xlsx" | "csv";
  title?: string;
  sections?: DocumentSectionSpec[];
  table?: DocumentTableSpec;
  sheetName?: string;
}

/**
 * Validate + dispatch a `generate_document` tool payload to the right
 * generator. Throws a short, user-facing-safe message when the model omitted
 * the field a format requires (e.g. `table` for a csv) so the caller's
 * catch block can surface it as the tool result without a stack trace.
 */
export async function buildDocumentBuffer(
  payload: GenerateDocumentPayload,
): Promise<Buffer> {
  const { format, title, sections, table, sheetName } = payload;
  if (format === "pdf" || format === "docx") {
    if (!sections || sections.length === 0) {
      throw new Error(
        `${format} generation requires \`sections\` — none were provided`,
      );
    }
    const spec: StructuredDocumentSpec = { title, sections };
    return format === "pdf" ? generatePdf(spec) : generateDocx(spec);
  }

  if (!table) {
    throw new Error(
      `${format} generation requires \`table\` — none was provided`,
    );
  }
  const spec: TabularDocumentSpec = { table, sheetName };
  return format === "csv" ? generateCsv(spec) : generateXlsx(spec);
}

export const DOCUMENT_MIME_BY_FORMAT: Record<
  "pdf" | "docx" | "csv" | "xlsx",
  string
> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const DOCUMENT_EXTENSION_BY_FORMAT: Record<
  "pdf" | "docx" | "csv" | "xlsx",
  string
> = {
  pdf: "pdf",
  docx: "docx",
  csv: "csv",
  xlsx: "xlsx",
};
