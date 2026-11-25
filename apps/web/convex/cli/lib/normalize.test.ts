import { describe, expect, test } from "vitest";
import { isRepoKey, toRepoKey } from "./normalize";

describe("toRepoKey", () => {
  test.each([
    "git@github-personal:packtrain/convoy.git",
    "git@github.com:packtrain/convoy.git",
    "ssh://git@github.com/packtrain/convoy.git",
    "ssh://git@github.com:2222/packtrain/convoy.git",
    "https://github.com/packtrain/convoy",
    "https://github.com/PackTrain/Convoy.git/",
    "  https://github.com/packtrain/convoy/  ",
  ])("ignores the host and case of %s", (remote) => {
    expect(toRepoKey(remote)).toBe("packtrain/convoy");
  });

  test("keeps the last two segments of a GitLab subgroup path", () => {
    expect(toRepoKey("git@gitlab.com:acme/platform/api.git")).toBe("platform/api");
    expect(toRepoKey("https://gitlab.com/acme/platform/api")).toBe("platform/api");
  });

  test("gives Azure DevOps HTTPS and SSH remotes the same key", () => {
    expect(toRepoKey("https://dev.azure.com/acme/Shop/_git/api")).toBe("shop/api");
    expect(toRepoKey("git@ssh.dev.azure.com:v3/acme/Shop/api")).toBe("shop/api");
    expect(toRepoKey("https://acme.visualstudio.com/Shop/_git/api")).toBe("shop/api");
  });

  test("keeps a `_git` segment outside Azure DevOps", () => {
    expect(toRepoKey("https://github.com/acme/_git")).toBe("acme/_git");
    expect(toRepoKey("git@gitlab.com:acme/_git/api.git")).toBe("_git/api");
  });

  test.each(["/home/me/repos/convoy.git", "file:///home/me/repos/convoy", "C:/Users/me/convoy", "git@host:../convoy.git", "https://h/./convoy"])(
    "has no key for a local or dot-segment remote: %s",
    (remote) => {
      expect(toRepoKey(remote)).toBeNull();
    },
  );

  test.each([undefined, "", "https://github.com/", "https://github.com/convoy", "git@github.com:convoy.git", "https://github.com/o wner/repo", "git@host:owner/re%po"])(
    "has no key for %s",
    (remote) => {
      expect(toRepoKey(remote)).toBeNull();
    },
  );

  test("isRepoKey accepts only the stored form", () => {
    expect(isRepoKey("packtrain/convoy")).toBe(true);
    for (const value of ["PackTrain/convoy", "convoy", "a/b/c", "../convoy", "o wner/repo"]) expect(isRepoKey(value)).toBe(false);
  });
});
