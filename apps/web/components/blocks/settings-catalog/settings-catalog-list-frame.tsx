import type { ReactNode } from "react";

export function SettingsCatalogListFrame({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border divide-y">{children}</div>;
}
