import { describe, expect, it } from "vitest";
import { isSafeLocalId, isSafeSlug } from "./validation.js";

describe("filesystem identifier validation", () => {
  it.each(["release-plan", "mémoire-2", "বাংলা", "11111111-1111-4111-8111-111111111111"])(
    "accepts safe slug %s",
    (value) => expect(isSafeSlug(value)).toBe(true),
  );

  it.each(["", ".", "..", "../escape", "nested/path", "name.md", "null\0byte"])(
    "rejects unsafe slug %s",
    (value) => expect(isSafeSlug(value)).toBe(false),
  );

  it.each(["s1", "legacy_session", "11111111-1111-4111-8111-111111111111"])(
    "accepts safe local id %s",
    (value) => expect(isSafeLocalId(value)).toBe(true),
  );

  it.each(["", "../escape", "nested/path", "id.jsonl", "space id"])(
    "rejects unsafe local id %s",
    (value) => expect(isSafeLocalId(value)).toBe(false),
  );
});
