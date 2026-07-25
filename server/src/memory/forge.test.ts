import { describe, it, expect } from "vitest";
import { slugify, parseNote, serializeNote, extractWikiLinks } from "./forge.js";

describe("slugify (must match Moldavite)", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Alex Rivera")).toBe("alex-rivera");
  });
  it("keeps accents (NFC)", () => {
    expect(slugify("Café")).toBe("café");
  });
  it("drops punctuation but not hyphens", () => {
    expect(slugify("Odin's Brain!")).toBe("odins-brain");
  });
  it("strips a .md extension", () => {
    expect(slugify("meeting.md")).toBe("meeting");
  });
  it("collapses whitespace runs to one hyphen (matches Moldavite \\s+)", () => {
    expect(slugify("a  b")).toBe("a-b");
  });
  it("does not collapse or trim literal hyphens (matches Moldavite)", () => {
    expect(slugify("a--b")).toBe("a--b");
    expect(slugify("-hi-")).toBe("-hi-");
  });
  it("empty becomes untitled", () => {
    expect(slugify("   ")).toBe("untitled");
  });
});

describe("parseNote / serializeNote", () => {
  it("parses frontmatter and body", () => {
    const raw = "---\ntype: person\npinned: true\ntags: [odin-memory, x]\n---\n\n# Hi\nbody\n";
    const { frontmatter, body } = parseNote(raw);
    expect(frontmatter.type).toBe("person");
    expect(frontmatter.pinned).toBe(true);
    expect(frontmatter.tags).toEqual(["odin-memory", "x"]);
    expect(body.trim()).toBe("# Hi\nbody");
  });
  it("returns empty frontmatter when absent", () => {
    const { frontmatter, body } = parseNote("just a body\n");
    expect(frontmatter).toEqual({});
    expect(body.trim()).toBe("just a body");
  });
  it("round-trips through serialize", () => {
    const fm = { type: "fact", pinned: false, tags: ["odin-memory"] };
    const out = serializeNote(fm, "# T\nbody");
    const back = parseNote(out);
    expect(back.frontmatter.type).toBe("fact");
    expect(back.frontmatter.pinned).toBe(false);
    expect(back.frontmatter.tags).toEqual(["odin-memory"]);
  });
  it("writes no frontmatter block when empty", () => {
    expect(serializeNote({}, "body")).toBe("body\n");
  });
});

describe("extractWikiLinks", () => {
  it("returns deduped slugs, honoring display|target", () => {
    expect(extractWikiLinks("see [[Alex Rivera]] and [[label|Odin]] and [[Odin]]"))
      .toEqual(["alex-rivera", "odin"]);
  });
});
