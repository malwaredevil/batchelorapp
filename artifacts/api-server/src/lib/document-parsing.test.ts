import { describe, expect, it, vi } from "vitest";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import { extractDocumentText } from "./document-parsing";

vi.mock("pdf-parse", () => ({ default: vi.fn() }));

const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("Word extraction with Mammoth's CLI-only dependency removed", () => {
  it("extracts Unicode, formatted runs, paragraphs and table cells", async () => {
    const buffer = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "Résumé — ", bold: true }),
                  new TextRun({ text: "tea & lunchbox", italics: true }),
                ],
              }),
              new Paragraph("第二段"),
              new Table({
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({ children: [new Paragraph("Cell text")] }),
                    ],
                  }),
                ],
              }),
            ],
          },
        ],
      }),
    );
    const text = await extractDocumentText(buffer, DOCX);
    expect(text).toContain("Résumé — tea & lunchbox");
    expect(text).toContain("第二段");
    expect(text).toContain("Cell text");
  });

  it("keeps the existing bounded context for long Word uploads", async () => {
    const buffer = await Packer.toBuffer(
      new Document({
        sections: [{ children: [new Paragraph("x".repeat(9000))] }],
      }),
    );
    expect(await extractDocumentText(buffer, DOCX)).toBe("x".repeat(8000));
  });

  it("keeps malformed uploads best-effort rather than throwing", async () => {
    expect(
      await extractDocumentText(Buffer.from("not a ZIP"), DOCX),
    ).toBeUndefined();
  });
});
