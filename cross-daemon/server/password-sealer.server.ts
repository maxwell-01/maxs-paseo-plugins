import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { z } from "zod";

export const sealedPasswordSchema = z.object({ iv: z.string().min(1), tag: z.string().min(1), data: z.string().min(1) });
export type SealedPassword = z.infer<typeof sealedPasswordSchema>;

export interface PasswordSealer {
  seal(password: string): SealedPassword;
  // Null when the password was sealed under another daemon key, for example after Paseo made a new
  // one, or is damaged. Either way the remedy is to enter it again.
  open(sealed: SealedPassword): string | null;
}

const CIPHER = "aes-256-gcm";
const KEY_PURPOSE = "paseo-cross-daemon passwords v1";

export function createPasswordSealer(daemonSecretKey: Uint8Array): PasswordSealer {
  const key = Buffer.from(hkdfSync("sha256", daemonSecretKey, new Uint8Array(0), KEY_PURPOSE, 32));
  return {
    seal(password) {
      const iv = randomBytes(12);
      const cipher = createCipheriv(CIPHER, key, iv);
      const data = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
      return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
    },
    // Node names no error code for a failed check, so every decipher failure counts as unreadable.
    open({ iv, tag, data }) {
      try {
        const decipher = createDecipheriv(CIPHER, key, Buffer.from(iv, "base64"));
        decipher.setAuthTag(Buffer.from(tag, "base64"));
        return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
      } catch {
        return null;
      }
    },
  };
}
