import { describe, expect, test, vi } from "vitest";
import { join } from "./join";

type Membership = { organizationId: string; role: string };
type Org = { _id: string; name: string };

const orgs: Record<string, Org> = {
  org1: { _id: "org1", name: "Acme" },
  org2: { _id: "org2", name: "Globex" },
};

function loadOrgs(ids: string[]): Promise<(Org | null)[]> {
  return Promise.resolve(ids.map((id) => orgs[id] ?? null));
}

describe("join", () => {
  describe("select (inner join)", () => {
    test("projects each row with its related doc", async () => {
      const memberships: Membership[] = [
        { organizationId: "org1", role: "owner" },
        { organizationId: "org2", role: "member" },
      ];

      const result = await join(memberships)
        .on((m) => m.organizationId)
        .with(loadOrgs)
        .select((membership, org) => ({ ...org, role: membership.role }));

      expect(result).toEqual([
        { _id: "org1", name: "Acme", role: "owner" },
        { _id: "org2", name: "Globex", role: "member" },
      ]);
    });

    test("drops rows whose related doc is missing", async () => {
      const memberships: Membership[] = [
        { organizationId: "org1", role: "owner" },
        { organizationId: "missing", role: "member" },
      ];

      const result = await join(memberships)
        .on((m) => m.organizationId)
        .with(loadOrgs)
        .select((membership, org) => ({ name: org.name, role: membership.role }));

      expect(result).toEqual([{ name: "Acme", role: "owner" }]);
    });

    test("preserves the order of the input rows", async () => {
      const memberships: Membership[] = [
        { organizationId: "org2", role: "member" },
        { organizationId: "org1", role: "owner" },
      ];

      const result = await join(memberships)
        .on((m) => m.organizationId)
        .with(loadOrgs)
        .select((_, org) => org.name);

      expect(result).toEqual(["Globex", "Acme"]);
    });

    test("supports async projections", async () => {
      const memberships: Membership[] = [{ organizationId: "org1", role: "owner" }];

      const result = await join(memberships)
        .on((m) => m.organizationId)
        .with(loadOrgs)
        .select(async (_, org) => org.name.toUpperCase());

      expect(result).toEqual(["ACME"]);
    });
  });

  describe("selectAll (left join)", () => {
    test("keeps rows with a missing related doc, passing null", async () => {
      const memberships: Membership[] = [
        { organizationId: "org1", role: "owner" },
        { organizationId: "missing", role: "member" },
      ];

      const result = await join(memberships)
        .on((m) => m.organizationId)
        .with(loadOrgs)
        .selectAll((membership, org) => ({ role: membership.role, name: org?.name ?? null }));

      expect(result).toEqual([
        { role: "owner", name: "Acme" },
        { role: "member", name: null },
      ]);
    });
  });

  describe("loader contract", () => {
    test("calls the loader once with deduped keys in first-seen order", async () => {
      const loader = vi.fn(loadOrgs);
      const memberships: Membership[] = [
        { organizationId: "org2", role: "member" },
        { organizationId: "org1", role: "owner" },
        { organizationId: "org2", role: "viewer" },
      ];

      const result = await join(memberships)
        .on((m) => m.organizationId)
        .with(loader)
        .select((membership, org) => ({ name: org.name, role: membership.role }));

      expect(loader).toHaveBeenCalledTimes(1);
      expect(loader).toHaveBeenCalledWith(["org2", "org1"]);
      expect(result).toEqual([
        { name: "Globex", role: "member" },
        { name: "Acme", role: "owner" },
        { name: "Globex", role: "viewer" },
      ]);
    });

    test("skips the loader entirely for empty input", async () => {
      const loader = vi.fn(loadOrgs);

      const result = await join([] as Membership[])
        .on((m) => m.organizationId)
        .with(loader)
        .select((_, org) => org.name);

      expect(loader).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    test("treats null/undefined keys as no match and excludes them from the loader call", async () => {
      const loader = vi.fn(loadOrgs);
      const items: Array<{ organizationId: string | null }> = [
        { organizationId: "org1" },
        { organizationId: null },
      ];

      const inner = await join(items)
        .on((item) => item.organizationId)
        .with(loader)
        .select((_, org) => org.name);

      expect(loader).toHaveBeenCalledWith(["org1"]);
      expect(inner).toEqual(["Acme"]);

      const left = await join(items)
        .on((item) => item.organizationId)
        .with(loadOrgs)
        .selectAll((_, org) => org?.name ?? null);

      expect(left).toEqual(["Acme", null]);
    });

    test("throws when the loader result is not aligned with the keys", async () => {
      await expect(
        join([{ organizationId: "org1" }, { organizationId: "org2" }])
          .on((m) => m.organizationId)
          .with(() => Promise.resolve([orgs.org1]))
          .select((_, org) => org.name)
      ).rejects.toThrow("join: loader returned 1 results for 2 keys");
    });
  });
});
