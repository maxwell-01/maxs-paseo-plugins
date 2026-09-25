import { z } from "zod";

export const MAX_NOTES_BYTES = 100_000;

// Windows drops a trailing dot from a folder name, so "repo." and "repo" would share a folder there.
const PATH_SAFE_KEY_SEGMENT = /^(?!\.+$)[a-z0-9_.-]*[a-z0-9_-]$/;

export const repoKeySchema = z.string().refine((key) => {
  const segments = key.split("/");
  return segments.length >= 3 && segments.every((segment) => PATH_SAFE_KEY_SEGMENT.test(segment));
}, "not a lower-case <host>/<owner>/<repo> key");
