/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SkillSourceLink, parseSkillSourceUrl, skillSourceFromFields, skillSourceHref } from "./skill-source";

const source = {
  repoUrl: "https://github.com/anthropics/skills",
  ref: "main",
  commitSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f0abcdef12",
  subpath: "document-skills/pdf",
};

describe("skillSourceHref", () => {
  test("pins a github link to the copied commit, subpath included", () => {
    expect(skillSourceHref(source)).toBe(
      "https://github.com/anthropics/skills/tree/0f1e2d3c4b5a69788796a5b4c3d2e1f0abcdef12/document-skills/pdf"
    );
    expect(skillSourceHref({ repoUrl: "https://github.com/anthropics/skills.git", commitSha: "abcdef1" })).toBe(
      "https://github.com/anthropics/skills/tree/abcdef1"
    );
  });

  test("falls back to the ref, then to the repository, when there is no commit", () => {
    expect(skillSourceHref({ repoUrl: source.repoUrl, ref: "main", subpath: "document-skills/pdf" })).toBe(
      "https://github.com/anthropics/skills/tree/main/document-skills/pdf"
    );
    expect(skillSourceHref({ repoUrl: source.repoUrl })).toBe("https://github.com/anthropics/skills");
  });

  test("opens any other https host as stored, since only github's tree layout is known", () => {
    expect(skillSourceHref({ ...source, repoUrl: "https://gitlab.com/group/repo" })).toBe("https://gitlab.com/group/repo");
  });

  test("a source with no repository has nothing to open", () => {
    expect(skillSourceHref({ commitSha: source.commitSha, ref: "main" })).toBeNull();
    expect(skillSourceHref({})).toBeNull();
  });

  test("refuses anything that is not http(s), so a stored string cannot become a script href", () => {
    expect(skillSourceHref({ ...source, repoUrl: "git@github.com:anthropics/skills.git" })).toBeNull();
    expect(skillSourceHref({ ...source, repoUrl: "javascript:alert(1)" })).toBeNull();
    expect(skillSourceHref({ ...source, repoUrl: "not a url" })).toBeNull();
  });
});

describe("parseSkillSourceUrl", () => {
  test("splits the URL github's own UI hands you", () => {
    expect(parseSkillSourceUrl("https://github.com/dmmulroy/anti-slop/tree/main/skills/install-anti-slop")).toEqual({
      repoUrl: "https://github.com/dmmulroy/anti-slop",
      ref: "main",
      subpath: "skills/install-anti-slop",
    });
  });

  test("a commit-pinned URL fills the commit, not the ref", () => {
    expect(parseSkillSourceUrl(`https://github.com/anthropics/skills/tree/${source.commitSha}/document-skills/pdf`)).toEqual({
      repoUrl: "https://github.com/anthropics/skills",
      commitSha: source.commitSha,
      subpath: "document-skills/pdf",
    });
  });

  test("a file URL drops the entry point, since a skill is its directory", () => {
    expect(parseSkillSourceUrl("https://github.com/dmmulroy/anti-slop/blob/main/skills/install-anti-slop/SKILL.md")).toEqual({
      repoUrl: "https://github.com/dmmulroy/anti-slop",
      ref: "main",
      subpath: "skills/install-anti-slop",
    });
  });

  test("a plain repository URL fills only the repository, leaving the rest as typed", () => {
    expect(parseSkillSourceUrl("https://github.com/dmmulroy/anti-slop.git")).toEqual({ repoUrl: "https://github.com/dmmulroy/anti-slop" });
  });

  test("anything it cannot split is not its business", () => {
    expect(parseSkillSourceUrl("https://gitlab.com/group/repo/-/tree/main/skills/pdf")).toBeNull();
    expect(parseSkillSourceUrl("git@github.com:dmmulroy/anti-slop.git")).toBeNull();
    expect(parseSkillSourceUrl("skills/install-anti-slop")).toBeNull();
    expect(parseSkillSourceUrl("")).toBeNull();
  });
});

describe("skillSourceFromFields", () => {
  test("builds the stored shape, dropping blank extras", () => {
    expect(
      skillSourceFromFields({ repoUrl: " https://github.com/anthropics/skills ", commitSha: " 0f1e2d3 ", ref: "", subpath: "  " })
    ).toEqual({ repoUrl: "https://github.com/anthropics/skills", commitSha: "0f1e2d3" });
    expect(skillSourceFromFields(source)).toEqual(source);
  });

  test("every field stands on its own, and an empty section clears the source", () => {
    expect(skillSourceFromFields({ repoUrl: source.repoUrl })).toEqual({ repoUrl: source.repoUrl });
    expect(skillSourceFromFields({ commitSha: "0f1e2d3" })).toEqual({ commitSha: "0f1e2d3" });
    expect(skillSourceFromFields({ ref: "main" })).toEqual({ ref: "main" });
    expect(skillSourceFromFields({ repoUrl: "", commitSha: "", ref: "", subpath: "" })).toBeNull();
    expect(skillSourceFromFields(undefined)).toBeNull();
  });
});

describe("SkillSourceLink", () => {
  afterEach(cleanup);

  test("the row link opens the pinned source in a new tab", () => {
    render(<SkillSourceLink source={source} />);

    const link = screen.getByRole("link", { name: "Open source repository" });
    expect(link.getAttribute("href")).toBe(skillSourceHref(source));
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  test("a source with no linkable URL renders no link at all", () => {
    const view = render(<SkillSourceLink source={{ ...source, repoUrl: "git@github.com:anthropics/skills.git" }} />);

    expect(view.container.innerHTML).toBe("");
  });
});
