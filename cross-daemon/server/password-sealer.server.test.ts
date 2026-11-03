import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPasswordSealer } from "./password-sealer.server";

describe("password sealer", () => {
  it("opens what it sealed, and the sealed form does not contain the password", () => {
    const sealer = createPasswordSealer(randomBytes(32));
    const sealed = sealer.seal("fake-mac-password");
    expect(JSON.stringify(sealed)).not.toContain("fake-mac-password");
    expect(sealer.open(sealed)).toBe("fake-mac-password");
  });

  it("cannot open a password sealed under another daemon key", () => {
    const sealed = createPasswordSealer(randomBytes(32)).seal("fake-mac-password");
    expect(createPasswordSealer(randomBytes(32)).open(sealed)).toBeNull();
  });
});
