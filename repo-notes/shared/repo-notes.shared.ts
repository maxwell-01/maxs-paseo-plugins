import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const MAX_NOTES_BYTES = 100_000;

// Windows drops a trailing dot from a folder name, so "repo." and "repo" would share a folder there.
const PATH_SAFE_KEY_SEGMENT = /^(?!\.+$)[a-z0-9_.-]*[a-z0-9_-]$/;

export const repoKeySchema = z.string().refine((key) => {
  const segments = key.split("/");
  return segments.length >= 3 && segments.every((segment) => PATH_SAFE_KEY_SEGMENT.test(segment));
}, "not a lower-case <host>/<owner>/<repo> key");

const notesContentSchema = z
  .string()
  .refine((content) => new TextEncoder().encode(content).length <= MAX_NOTES_BYTES, `notes are limited to ${MAX_NOTES_BYTES} bytes`);
const modifiedAtSchema = z.number().int().nonnegative();
const MAX_CLOCK_AHEAD_MS = 5 * 60_000;
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const listRepoNotes = defineRpc({
  name: "repo-notes.list",
  input: z.object({}),
  output: z.object({ notes: z.array(z.object({ key: repoKeySchema, hash: hashSchema, modifiedAt: modifiedAtSchema })) }),
});

export type NotesVersion = z.output<typeof listRepoNotes.output>["notes"][number];

export const readRepoNotes = defineRpc({
  name: "repo-notes.read",
  input: z.object({ key: repoKeySchema }),
  output: z.object({ notes: z.object({ content: notesContentSchema, hash: hashSchema, modifiedAt: modifiedAtSchema }).nullable() }),
});

export const writeRepoNotes = defineRpc({
  name: "repo-notes.write",
  input: z.object({
    key: repoKeySchema,
    content: notesContentSchema,
    modifiedAt: modifiedAtSchema.refine((time) => time <= Date.now() + MAX_CLOCK_AHEAD_MS, "change time is in the future"),
    // The hash the sync listed for this daemon, or null if it had no notes; a write is refused if the file has changed since.
    expectedHash: hashSchema.nullable(),
  }),
  output: z.object({ written: z.boolean() }),
});
