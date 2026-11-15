import { describe, expect, test } from "vitest";
import { errors } from "../errors";
import {
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_PATH_LENGTH,
  MAX_SKILL_SOURCE_REF_LENGTH,
  MAX_SKILL_SOURCE_URL_LENGTH,
  normalizeSkillCategory,
  normalizeSkillContent,
  normalizeSkillDescription,
  normalizeSkillFileContent,
  normalizeSkillName,
  normalizeSkillPath,
  normalizeSkillSource,
  ensureSkillReplacementFits,
  skillByteLength,
} from "./normalize";

describe("normalizeSkillName", () => {
  test("trims and lowercases", () => {
    expect(normalizeSkillName("  PDF-Tools ")).toBe("pdf-tools");
  });

  test("keeps a namespace prefix", () => {
    expect(normalizeSkillName(" MP:Grilling ")).toBe("mp:grilling");
  });

  test("rejects empty, too short, too long, and invalid characters", () => {
    expect(() => normalizeSkillName("   ")).toThrow(errors.SKILL_NAME_REQUIRED);
    expect(() => normalizeSkillName("a")).toThrow(errors.SKILL_NAME_LENGTH);
    expect(() => normalizeSkillName("a".repeat(65))).toThrow(errors.SKILL_NAME_LENGTH);
    expect(() => normalizeSkillName("pdf tools")).toThrow(errors.SKILL_NAME_FORMAT);
    expect(() => normalizeSkillName("pdf_tools")).toThrow(errors.SKILL_NAME_FORMAT);
  });

  test("rejects a colon that is not a single separator between two segments", () => {
    expect(() => normalizeSkillName(":grilling")).toThrow(errors.SKILL_NAME_FORMAT);
    expect(() => normalizeSkillName("grilling:")).toThrow(errors.SKILL_NAME_FORMAT);
    expect(() => normalizeSkillName("mp::grilling")).toThrow(errors.SKILL_NAME_FORMAT);
    expect(() => normalizeSkillName("mp:ek:grilling")).toThrow(errors.SKILL_NAME_FORMAT);
  });
});

describe("normalizeSkillDescription and normalizeSkillCategory", () => {
  test("drop blank values and trim the rest", () => {
    expect(normalizeSkillDescription("  Reads PDFs ")).toBe("Reads PDFs");
    expect(normalizeSkillDescription("   ")).toBeUndefined();
    expect(normalizeSkillDescription(null)).toBeUndefined();
    expect(normalizeSkillCategory(" Docs ")).toBe("Docs");
    expect(normalizeSkillCategory(undefined)).toBeUndefined();
  });

  test("enforce their length caps", () => {
    expect(() => normalizeSkillDescription("a".repeat(501))).toThrow(errors.SKILL_DESCRIPTION_LENGTH);
    expect(() => normalizeSkillCategory("a".repeat(81))).toThrow(errors.SKILL_CATEGORY_LENGTH);
  });
});

describe("normalizeSkillSource", () => {
  const source = { repoUrl: "https://github.com/anthropics/skills", commitSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f0abcdef12" };

  test("trims, lowercases the commit, and drops blank extras", () => {
    expect(
      normalizeSkillSource({
        repoUrl: " https://github.com/anthropics/skills ",
        commitSha: " 0F1E2D3C4B5A69788796A5B4C3D2E1F0ABCDEF12 ",
        ref: " main ",
        subpath: " document-skills/pdf ",
      })
    ).toEqual({ ...source, ref: "main", subpath: "document-skills/pdf" });
    expect(normalizeSkillSource({ ...source, ref: "  ", subpath: "" })).toEqual(source);
    expect(normalizeSkillSource(null)).toBeUndefined();
    expect(normalizeSkillSource(undefined)).toBeUndefined();
  });

  test("keeps whatever was recorded, one field or four", () => {
    expect(normalizeSkillSource({ repoUrl: source.repoUrl })).toEqual({ repoUrl: source.repoUrl });
    expect(normalizeSkillSource({ commitSha: source.commitSha })).toEqual({ commitSha: source.commitSha });
    expect(normalizeSkillSource({ ref: "main" })).toEqual({ ref: "main" });
    expect(normalizeSkillSource({ subpath: "document-skills/pdf" })).toEqual({ subpath: "document-skills/pdf" });
    // Nothing recorded is no provenance, not an empty object on the row.
    expect(normalizeSkillSource({ repoUrl: "  ", commitSha: "", ref: " ", subpath: "" })).toBeUndefined();
    expect(normalizeSkillSource({})).toBeUndefined();
  });

  test("still holds each recorded field to its own format", () => {
    expect(() => normalizeSkillSource({ ...source, repoUrl: "a".repeat(MAX_SKILL_SOURCE_URL_LENGTH + 1) })).toThrow(
      errors.SKILL_SOURCE_REPO_URL_INVALID
    );
    expect(() => normalizeSkillSource({ ...source, repoUrl: "https://example.com/repo\nmalicious" })).toThrow(
      errors.SKILL_SOURCE_REPO_URL_INVALID
    );
    expect(() => normalizeSkillSource({ ...source, commitSha: "main" })).toThrow(errors.SKILL_SOURCE_COMMIT_FORMAT);
    expect(() => normalizeSkillSource({ ...source, commitSha: "0f1e2d" })).toThrow(errors.SKILL_SOURCE_COMMIT_FORMAT);
    expect(() => normalizeSkillSource({ ...source, ref: "a".repeat(MAX_SKILL_SOURCE_REF_LENGTH + 1) })).toThrow(
      errors.SKILL_SOURCE_REF_INVALID
    );
  });

  test("holds the subpath to the file-path rules, since V2 joins it onto a real write", () => {
    expect(() => normalizeSkillSource({ ...source, subpath: "../../etc" })).toThrow(errors.SKILL_PATH_FORMAT);
    expect(() => normalizeSkillSource({ ...source, subpath: "/etc/passwd" })).toThrow(errors.SKILL_PATH_FORMAT);
  });
});

describe("normalizeSkillPath", () => {
  test("accepts relative POSIX paths", () => {
    expect(normalizeSkillPath(" references/fields.md ")).toBe("references/fields.md");
    expect(normalizeSkillPath("SKILL.md")).toBe("SKILL.md");
  });

  test("rejects traversal, absolute, backslash, and empty segments", () => {
    expect(() => normalizeSkillPath("   ")).toThrow(errors.SKILL_PATH_REQUIRED);
    expect(() => normalizeSkillPath("../secrets.md")).toThrow(errors.SKILL_PATH_FORMAT);
    expect(() => normalizeSkillPath("references/../../secrets.md")).toThrow(errors.SKILL_PATH_FORMAT);
    expect(() => normalizeSkillPath("/etc/passwd")).toThrow(errors.SKILL_PATH_FORMAT);
    expect(() => normalizeSkillPath("references\\fields.md")).toThrow(errors.SKILL_PATH_FORMAT);
    expect(() => normalizeSkillPath("references//fields.md")).toThrow(errors.SKILL_PATH_FORMAT);
    expect(() => normalizeSkillPath("./fields.md")).toThrow(errors.SKILL_PATH_FORMAT);
    expect(() => normalizeSkillPath(".../fields.md")).toThrow(errors.SKILL_PATH_FORMAT);
  });

  test("rejects control characters, the classic truncation bypass", () => {
    expect(() => normalizeSkillPath("fields.md\u0000.png")).toThrow(errors.SKILL_PATH_FORMAT);
    expect(() => normalizeSkillPath("refs\u001f/fields.md")).toThrow(errors.SKILL_PATH_FORMAT);
  });

  test("rejects paths over the length cap", () => {
    expect(() => normalizeSkillPath("a".repeat(MAX_SKILL_PATH_LENGTH + 1))).toThrow(errors.SKILL_PATH_LENGTH);
  });
});

describe("skill content", () => {
  test("SKILL.md content is required but stored verbatim", () => {
    expect(normalizeSkillContent("  # body  \n")).toBe("  # body  \n");
    expect(() => normalizeSkillContent("   ")).toThrow(errors.SKILL_CONTENT_REQUIRED);
  });

  test("other files keep their content verbatim, including a blank file", () => {
    expect(normalizeSkillFileContent("line\n\n")).toBe("line\n\n");
    expect(normalizeSkillFileContent("")).toBe("");
  });

  test("per-file byte cap counts bytes, not characters", () => {
    expect(skillByteLength("é")).toBe(2);
    expect(() => normalizeSkillFileContent("é".repeat(MAX_SKILL_FILE_BYTES / 2 + 1))).toThrow(errors.SKILL_FILE_BYTES);
  });
});

describe("ensureSkillReplacementFits", () => {
  test("projects the replaced size instead of building it, so a breach is a cap error", () => {
    // 100k one-byte matches with a 1 KB replacement asks for ~100 MB: the point
    // of projecting is that the string is never materialized to find that out.
    const content = "x".repeat(100_000);
    expect(() => ensureSkillReplacementFits(content, "x", "y".repeat(1_024), 100_000)).toThrow(errors.SKILL_FILE_BYTES);
  });

  test("accepts a replacement that stays inside the per-file cap, shrinking included", () => {
    const content = "pdftk ".repeat(1_000);
    expect(() => ensureSkillReplacementFits(content, "pdftk", "qpdf", 1_000)).not.toThrow();
    expect(() => ensureSkillReplacementFits("a".repeat(MAX_SKILL_FILE_BYTES), "a", "", 1)).not.toThrow();
  });

  test("counts bytes, not characters", () => {
    // A file already at the cap: swapping one ASCII byte for a two-byte character
    // adds one byte, which is one too many.
    const atCap = "a".repeat(MAX_SKILL_FILE_BYTES);
    expect(() => ensureSkillReplacementFits(atCap, "a", "é", 1)).toThrow(errors.SKILL_FILE_BYTES);
    expect(() => ensureSkillReplacementFits(atCap, "aa", "é", 1)).not.toThrow();
  });
});
