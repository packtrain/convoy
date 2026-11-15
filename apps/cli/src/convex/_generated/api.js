// Real file, not a symlink into apps/web: the web app's generated api.js sits
// in a CommonJS package scope (apps/web has no "type": "module"), which tsx on
// Node >= 22 transpiles to CJS and breaks named ESM imports. This mirror lives
// in apps/cli's ESM scope; the runtime value is identical (anyApi). Types come
// from the adjacent api.d.ts, which re-exports the generated declarations, so
// they never go stale.
import { anyApi, componentsGeneric } from "convex/server";

export const api = anyApi;
export const internal = anyApi;
export const components = componentsGeneric();
