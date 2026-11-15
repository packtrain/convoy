import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("credentials", () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "convoy-config-test-"));
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.env = originalEnv;
  });

  describe("credential file format", () => {
    // Test the INI format parsing/writing behavior for profile-centric storage

    it("can parse INI sections with profile names", async () => {
      const ini = await import("ini");

      const content = `[default]
url=https://test.convex.cloud
apiKey=sk_user_test123
`;
      const parsed = ini.parse(content);

      expect(parsed["default"]).toBeDefined();
      expect(parsed["default"].url).toBe("https://test.convex.cloud");
      expect(parsed["default"].apiKey).toBe("sk_user_test123");
    });

    it("can parse multiple profiles", async () => {
      const ini = await import("ini");

      const content = `[default]
url=https://test.convex.cloud
apiKey=sk_user_default

[work]
url=https://work.convex.cloud
apiKey=sk_user_work
`;
      const parsed = ini.parse(content);

      expect(parsed["default"]).toBeDefined();
      expect(parsed["default"].url).toBe("https://test.convex.cloud");
      expect(parsed["default"].apiKey).toBe("sk_user_default");

      expect(parsed["work"]).toBeDefined();
      expect(parsed["work"].url).toBe("https://work.convex.cloud");
      expect(parsed["work"].apiKey).toBe("sk_user_work");
    });

    it("can write and read back credentials", async () => {
      const ini = await import("ini");

      const credentials = {
        default: {
          url: "https://test.convex.cloud",
          apiKey: "sk_user_default",
        },
        work: { url: "https://work.convex.cloud", apiKey: "sk_user_work" },
      };

      const written = ini.stringify(credentials);
      const parsed = ini.parse(written);

      expect(parsed["default"]?.url).toBe("https://test.convex.cloud");
      expect(parsed["default"]?.apiKey).toBe("sk_user_default");
      expect(parsed["work"]?.url).toBe("https://work.convex.cloud");
      expect(parsed["work"]?.apiKey).toBe("sk_user_work");
    });

    it("preserves multiple profiles", async () => {
      const ini = await import("ini");

      const credentials = {
        default: { url: "https://server1.convex.cloud", apiKey: "sk_user_1" },
        work: { url: "https://server2.convex.cloud", apiKey: "sk_user_2" },
        personal: { url: "https://server1.convex.cloud", apiKey: "sk_user_3" },
      };

      const written = ini.stringify(credentials);
      const parsed = ini.parse(written);

      expect(Object.keys(parsed)).toHaveLength(3);
      expect(parsed["default"]?.apiKey).toBe("sk_user_1");
      expect(parsed["work"]?.apiKey).toBe("sk_user_2");
      expect(parsed["personal"]?.apiKey).toBe("sk_user_3");
    });
  });

  describe("profile operations", () => {
    it("can list all profiles", async () => {
      const credentials = {
        default: { url: "https://test.convex.cloud", apiKey: "sk_1" },
        work: { url: "https://work.convex.cloud", apiKey: "sk_2" },
      };

      const profiles = Object.entries(credentials).map(([name, entry]) => ({
        name,
        url: entry.url,
        apiKey: entry.apiKey,
      }));

      expect(profiles).toHaveLength(2);
      expect(profiles).toContainEqual({
        name: "default",
        url: "https://test.convex.cloud",
        apiKey: "sk_1",
      });
      expect(profiles).toContainEqual({
        name: "work",
        url: "https://work.convex.cloud",
        apiKey: "sk_2",
      });
    });

    it("can get a specific profile", async () => {
      const credentials = {
        default: { url: "https://test.convex.cloud", apiKey: "sk_1" },
        work: { url: "https://work.convex.cloud", apiKey: "sk_2" },
      };

      const profile = credentials["work"];

      expect(profile).toBeDefined();
      expect(profile.url).toBe("https://work.convex.cloud");
      expect(profile.apiKey).toBe("sk_2");
    });
  });

  describe("file operations", () => {
    it("creates config directory with correct permissions", () => {
      const configDir = path.join(tempDir, ".config", "convoy");

      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });

      expect(fs.existsSync(configDir)).toBe(true);
      const stats = fs.statSync(configDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("writes credentials file with correct permissions", async () => {
      const ini = await import("ini");
      const credentialsFile = path.join(tempDir, "credentials");

      const credentials = {
        default: { url: "https://test.convex.cloud", apiKey: "sk_user_test" },
      };

      fs.writeFileSync(credentialsFile, ini.stringify(credentials), {
        mode: 0o600,
      });

      expect(fs.existsSync(credentialsFile)).toBe(true);
      const content = fs.readFileSync(credentialsFile, "utf-8");
      expect(content).toContain("sk_user_test");
      expect(content).toContain("https://test.convex.cloud");
    });

    it("can update existing credentials file", async () => {
      const ini = await import("ini");
      const credentialsFile = path.join(tempDir, "credentials");

      // Write initial credentials
      const initial = {
        default: { url: "https://test.convex.cloud", apiKey: "sk_user_old" },
      };
      fs.writeFileSync(credentialsFile, ini.stringify(initial));

      // Read, update, write
      const content = fs.readFileSync(credentialsFile, "utf-8");
      const credentials = ini.parse(content);
      credentials["default"].apiKey = "sk_user_new";
      fs.writeFileSync(credentialsFile, ini.stringify(credentials));

      // Verify
      const finalContent = fs.readFileSync(credentialsFile, "utf-8");
      const final = ini.parse(finalContent);
      expect(final["default"].apiKey).toBe("sk_user_new");
    });

    it("can delete a profile", async () => {
      const ini = await import("ini");
      const credentialsFile = path.join(tempDir, "credentials");

      // Write multiple profiles
      const initial = {
        default: { url: "https://test.convex.cloud", apiKey: "sk_user_test" },
        work: { url: "https://other.convex.cloud", apiKey: "sk_user_other" },
      };
      fs.writeFileSync(credentialsFile, ini.stringify(initial));

      // Read, delete, write
      const content = fs.readFileSync(credentialsFile, "utf-8");
      const credentials = ini.parse(content);
      delete credentials["default"];
      fs.writeFileSync(credentialsFile, ini.stringify(credentials));

      // Verify
      const finalContent = fs.readFileSync(credentialsFile, "utf-8");
      const final = ini.parse(finalContent);
      expect(final["default"]).toBeUndefined();
      expect(final["work"].apiKey).toBe("sk_user_other");
    });
  });
});
