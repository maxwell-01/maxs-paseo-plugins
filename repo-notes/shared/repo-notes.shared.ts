import { z } from "zod";

const PATH_SAFE_KEY_SEGMENT = /^(?!\.{1,2}$)[\w.-]+$/;

export const repoKeySchema = z.string().refine((key) => {
  const segments = key.split("/");
  return segments.length >= 3 && segments.every((segment) => PATH_SAFE_KEY_SEGMENT.test(segment));
}, "not a <host>/<owner>/<repo> key");
