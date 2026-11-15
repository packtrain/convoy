import { LexoRank } from "lexorank";

let counter = 0;
let rankGen = LexoRank.middle();

export const gen = {
  id: () => crypto.randomUUID(),
  name: (prefix: string) => `${prefix} ${++counter}`,
  email: () => `user-${++counter}@test.com`,
  slug: (name: string) => name.toLowerCase().replace(/\s+/g, "-"),
  alias: () => `T${String(++counter).padStart(2, "0")}`,
  tokenIdentifier: () => `test-user-${++counter}`,
  rank: () => (rankGen = rankGen.genNext()).toString(),
  clientId: () => crypto.randomUUID(),
  now: () => Date.now(),
  instanceId: () => `instance-${crypto.randomUUID()}`,
  repoPath: () => `/home/user/project-${++counter}`,
  pathId: () => crypto.randomUUID(),
  hostname: () => `machine-${++counter}`,
};

export const resetGenerators = () => {
  counter = 0;
  rankGen = LexoRank.middle();
};
