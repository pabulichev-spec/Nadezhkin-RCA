import { describe, expect, it } from "vitest";
import { toAsciiStorageKey } from "../server/storage";

describe("storage object keys", () => {
  it("encodes Cyrillic and punctuation while keeping path separators", () => {
    const key = toAsciiStorageKey("pumprca/workspace/Пропуск т-у/торцевое уплотнение №1.jpg");
    expect(decodeURIComponent(key)).toBe("pumprca/workspace/Пропуск т-у/торцевое уплотнение №1.jpg");
    expect(key).not.toMatch(/[^\x00-\x7F]/);
    expect(key.split("/")).toHaveLength(4);
  });

  it("does not allow an absolute key to escape the storage namespace", () => {
    expect(toAsciiStorageKey("///pumprca//case/file.jpg")).toBe("pumprca/case/file.jpg");
  });
});
