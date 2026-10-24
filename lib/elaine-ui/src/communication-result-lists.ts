type Recipient = {
  name: string;
  channel: string | null;
  ok: boolean;
  error: string | null;
  status?: string;
  receiptStatus?: string;
  receiptId?: string;
};

type Receipt = { receiptId: string; channel: string; status: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Scheduling and immediate delivery have different server response shapes. */
export function communicationResultLists(inner: Record<string, unknown>): {
  recipients?: Recipient[];
  receipts?: Receipt[];
} {
  const receipts = Array.isArray(inner.receipts)
    ? inner.receipts.flatMap((value): Receipt[] => {
        const row = record(value);
        const receiptId = row?.receiptId ?? row?.id;
        return typeof receiptId === "string" &&
          typeof row?.channel === "string" &&
          typeof row.status === "string"
          ? [{ receiptId, channel: row.channel, status: row.status }]
          : [];
      })
    : undefined;
  const rawRecipients = Array.isArray(inner.recipients)
    ? inner.recipients
    : undefined;
  const recipients = rawRecipients
    ? rawRecipients.flatMap((value): Recipient[] => {
        if (typeof value === "string" && inner.scheduled === true) {
          // A saved schedule is not evidence of provider acceptance/delivery.
          // Only associate an unnamed receipt with a single recipient.
          const receipt =
            rawRecipients.length === 1 && receipts?.length === 1
              ? receipts[0]
              : undefined;
          return [
            {
              name: value,
              channel:
                receipt?.channel ??
                (typeof inner.channel === "string" ? inner.channel : null),
              ok: true,
              error: null,
              status: "scheduled",
              receiptStatus: receipt?.status ?? "scheduled",
              receiptId: receipt?.receiptId,
            },
          ];
        }
        const row = record(value);
        if (typeof row?.name !== "string" || typeof row.ok !== "boolean") {
          return [];
        }
        return [
          {
            name: row.name,
            channel: typeof row.channel === "string" ? row.channel : null,
            ok: row.ok,
            error: typeof row.error === "string" ? row.error : null,
            status: typeof row.status === "string" ? row.status : undefined,
            receiptStatus:
              typeof row.receiptStatus === "string"
                ? row.receiptStatus
                : undefined,
            receiptId:
              typeof row.receiptId === "string" ? row.receiptId : undefined,
          },
        ];
      })
    : undefined;
  return { recipients, receipts };
}
