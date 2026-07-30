import { desc, eq } from "drizzle-orm";
import { db, officeNotes, appUsers } from "@workspace/db";

export type OfficeNoteInput = {
  title: string;
  body: string;
  backgroundColor?: string | null;
};

export type OfficeNotePatch = {
  title?: string;
  body?: string;
  backgroundColor?: string | null;
};

export async function getOfficeNote(id: number) {
  const [row] = await db
    .select({
      id: officeNotes.id,
      title: officeNotes.title,
      body: officeNotes.body,
      backgroundColor: officeNotes.backgroundColor,
      createdByUserId: officeNotes.createdByUserId,
      createdByName: appUsers.displayName,
      createdByEmail: appUsers.email,
      createdAt: officeNotes.createdAt,
      updatedAt: officeNotes.updatedAt,
    })
    .from(officeNotes)
    .leftJoin(appUsers, eq(appUsers.id, officeNotes.createdByUserId))
    .where(eq(officeNotes.id, id));
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    backgroundColor: row.backgroundColor,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName ?? row.createdByEmail ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listOfficeNotes() {
  const rows = await db
    .select({
      id: officeNotes.id,
      title: officeNotes.title,
      body: officeNotes.body,
      backgroundColor: officeNotes.backgroundColor,
      createdByUserId: officeNotes.createdByUserId,
      createdByName: appUsers.displayName,
      createdByEmail: appUsers.email,
      createdAt: officeNotes.createdAt,
      updatedAt: officeNotes.updatedAt,
    })
    .from(officeNotes)
    .leftJoin(appUsers, eq(appUsers.id, officeNotes.createdByUserId))
    .orderBy(desc(officeNotes.updatedAt));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    backgroundColor: row.backgroundColor,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName ?? row.createdByEmail ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function createOfficeNote(input: OfficeNoteInput, userId: number) {
  const [row] = await db
    .insert(officeNotes)
    .values({
      title: input.title,
      body: input.body,
      backgroundColor: input.backgroundColor ?? null,
      createdByUserId: userId,
    })
    .returning({ id: officeNotes.id });
  return getOfficeNote(row.id);
}

export async function updateOfficeNote(id: number, patch: OfficeNotePatch) {
  const [updated] = await db
    .update(officeNotes)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.backgroundColor !== undefined
        ? { backgroundColor: patch.backgroundColor }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(officeNotes.id, id))
    .returning({ id: officeNotes.id });
  return updated ? getOfficeNote(id) : null;
}

export async function deleteOfficeNote(id: number): Promise<boolean> {
  const [row] = await db
    .delete(officeNotes)
    .where(eq(officeNotes.id, id))
    .returning({ id: officeNotes.id });
  return Boolean(row);
}
