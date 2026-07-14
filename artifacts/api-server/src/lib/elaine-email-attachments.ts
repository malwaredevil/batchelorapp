import { Resend } from "resend";
import { db, travelsTripDocuments } from "@workspace/db";
import { env } from "./env";
import { logger } from "./logger";
import { uploadDocument } from "./travels-storage";
import {
  extractFromImage,
  extractFromPdf,
  extractFromEmailText,
} from "./travel-document-extraction";
import { suggestTripId } from "./gmail-scan";
import {
  syncItineraryFromDocument,
  indexDocumentChunks,
} from "../routes/travels/documents";

// Handles attachments on a forwarded booking-confirmation email received via
// the Resend inbound webhook (routes/elaine-email.ts). Each attachment is
// uploaded to the shared `travels` storage bucket, AI-extracted the same way
// as a manual document upload, and either linked straight to a confidently
// matched trip or dropped into the unmatched-documents triage queue
// (status: "unmatched", tripId: null) for a household member to assign later
// from the Documents tab. See threat_model.md's Resend webhook boundary —
// this reuses the same identity-matched userId, no new trust boundary.

const SUPPORTED_MIME_PREFIXES = ["image/", "application/pdf"];

export interface EmailAttachmentOutcome {
  filename: string;
  outcome: "linked" | "unmatched" | "skipped" | "failed";
  tripTitle?: string;
}

function isSupportedMimeType(mimeType: string): boolean {
  return SUPPORTED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

export async function processEmailAttachments(params: {
  emailId: string;
  userId: number;
  fromEmail: string;
  subject: string;
}): Promise<EmailAttachmentOutcome[]> {
  if (!env.resendApiKey) return [];
  const resend = new Resend(env.resendApiKey);

  let attachments: Array<{
    id: string;
    filename?: string;
    content_type: string;
    download_url: string;
  }> = [];
  try {
    const { data, error } = await resend.emails.receiving.attachments.list({
      emailId: params.emailId,
    });
    if (error) {
      logger.warn(
        { error, emailId: params.emailId },
        "elaine-email-attachments: failed to list attachments",
      );
      return [];
    }
    attachments = data?.data ?? [];
  } catch (err) {
    logger.warn(
      { err, emailId: params.emailId },
      "elaine-email-attachments: error listing attachments",
    );
    return [];
  }

  if (attachments.length === 0) return [];

  const outcomes: EmailAttachmentOutcome[] = [];

  for (const attachment of attachments) {
    const filename = attachment.filename || "attachment";
    if (!isSupportedMimeType(attachment.content_type)) {
      outcomes.push({ filename, outcome: "skipped" });
      continue;
    }

    try {
      const fileResp = await fetch(attachment.download_url);
      if (!fileResp.ok) {
        outcomes.push({ filename, outcome: "failed" });
        continue;
      }
      const buffer = Buffer.from(await fileResp.arrayBuffer());
      const isPdf = attachment.content_type === "application/pdf";

      const storagePath = await uploadDocument(
        buffer,
        attachment.content_type,
        filename,
      );

      let extractedData: Record<string, unknown> = {};
      let rawText: string | null = null;
      try {
        if (isPdf) {
          try {
            const pdfParse = await import("pdf-parse");
            const parsed = await pdfParse.default(buffer);
            rawText = parsed.text.slice(0, 20000) || null;
          } catch {
            // non-fatal
          }
          extractedData = await extractFromPdf(buffer);
        } else {
          extractedData = await extractFromImage(
            buffer,
            attachment.content_type,
          );
          const parts = Object.entries(extractedData)
            .filter(([, v]) => v != null && v !== "")
            .map(([k, v]) => `${k}: ${String(v)}`);
          if (parts.length > 0) rawText = parts.join("\n");
        }
      } catch (err) {
        logger.warn(
          { err, filename },
          "elaine-email-attachments: extraction failed, storing without data",
        );
      }

      const suggestedTripId = await suggestTripId(extractedData);

      const [doc] = await db
        .insert(travelsTripDocuments)
        .values({
          tripId: suggestedTripId,
          userId: params.userId,
          storagePath,
          title: (extractedData.title as string | undefined) ?? null,
          documentType:
            (extractedData.documentType as string | undefined) ?? null,
          originalFilename: filename,
          extractedData,
          rawText,
          status: suggestedTripId ? "linked" : "unmatched",
          source: "email_forward",
          sourceEmailFrom: params.fromEmail,
          sourceEmailSubject: params.subject,
          sourceReceivedAt: new Date(),
        })
        .returning();

      if (doc && suggestedTripId) {
        try {
          await syncItineraryFromDocument(
            suggestedTripId,
            doc.id,
            extractedData,
          );
        } catch (err) {
          logger.warn(
            { err, docId: doc.id },
            "elaine-email-attachments: itinerary sync failed",
          );
        }
      }
      if (doc && rawText) {
        indexDocumentChunks(doc.id, rawText).catch(() => {});
      }

      let tripTitle: string | undefined;
      if (suggestedTripId) {
        tripTitle =
          (extractedData.providerName as string | undefined) ?? undefined;
      }

      outcomes.push({
        filename,
        outcome: suggestedTripId ? "linked" : "unmatched",
        tripTitle,
      });
    } catch (err) {
      logger.error(
        { err, filename },
        "elaine-email-attachments: failed to process attachment",
      );
      outcomes.push({ filename, outcome: "failed" });
    }
  }

  return outcomes;
}

// Sanitise an email subject into a safe filename stem (no path separators,
// control chars, or runs of whitespace that look odd in storage).
function subjectToFilename(subject: string): string {
  return (
    subject
      .replace(/[/\\:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "email"
  );
}

/**
 * Processes the plain-text body of a forwarded email as a travel document.
 * Runs extractFromEmailText to decide whether the body contains a genuine
 * booking confirmation; if so, uploads the body as a .txt file to Supabase
 * Storage, creates a travelsTripDocuments row, and syncs the itinerary — the
 * same pipeline as processEmailAttachments but sourced from body text rather
 * than a file attachment.
 *
 * Returns an outcome object on success (linked | unmatched | skipped), or
 * null if the email body doesn't look like a booking confirmation at all.
 */
export async function processEmailBodyAsDocument(params: {
  emailId: string;
  userId: number;
  fromEmail: string;
  subject: string;
  bodyText: string;
}): Promise<EmailAttachmentOutcome | null> {
  const trimmed = params.bodyText.trim();
  if (!trimmed) return null;

  let extractedData: Record<string, unknown> & { isTravelRelated: boolean };
  try {
    extractedData = await extractFromEmailText(
      params.subject,
      params.fromEmail,
      trimmed.slice(0, 6000),
    );
  } catch (err) {
    logger.warn(
      { err, emailId: params.emailId },
      "elaine-email-body: extraction failed",
    );
    return null;
  }

  if (!extractedData.isTravelRelated) {
    logger.info(
      { emailId: params.emailId },
      "elaine-email-body: not a travel booking, skipping document creation",
    );
    return null;
  }

  const filename = `${subjectToFilename(params.subject)}.txt`;

  let storagePath: string;
  try {
    const bodyBuffer = Buffer.from(trimmed, "utf8");
    storagePath = await uploadDocument(bodyBuffer, "text/plain", filename);
  } catch (err) {
    logger.warn(
      { err, emailId: params.emailId },
      "elaine-email-body: storage upload failed",
    );
    return null;
  }

  const suggestedTripId = await suggestTripId(extractedData);

  const [doc] = await db
    .insert(travelsTripDocuments)
    .values({
      tripId: suggestedTripId,
      userId: params.userId,
      storagePath,
      title: (extractedData.title as string | undefined) ?? null,
      documentType: (extractedData.documentType as string | undefined) ?? null,
      originalFilename: filename,
      extractedData,
      rawText: trimmed.slice(0, 20000),
      status: suggestedTripId ? "linked" : "unmatched",
      source: "email_forward",
      sourceEmailFrom: params.fromEmail,
      sourceEmailSubject: params.subject,
      sourceReceivedAt: new Date(),
    })
    .returning();

  if (doc && suggestedTripId) {
    try {
      await syncItineraryFromDocument(suggestedTripId, doc.id, extractedData);
    } catch (err) {
      logger.warn(
        { err, docId: doc.id },
        "elaine-email-body: itinerary sync failed",
      );
    }
  }

  if (doc) {
    const rawText = trimmed.slice(0, 20000);
    indexDocumentChunks(doc.id, rawText).catch(() => {});
  }

  return {
    filename,
    outcome: suggestedTripId ? "linked" : "unmatched",
    tripTitle: suggestedTripId
      ? ((extractedData.providerName as string | undefined) ?? undefined)
      : undefined,
  };
}
