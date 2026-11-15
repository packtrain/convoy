import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Spinner } from "@/components/ui/spinner";
import { DragStrip } from "@/components/drag-strip";
import { loadConfig, type ConfigInfo } from "@/lib/backend";
import { applyDockIconPrefOnStartup } from "@/lib/dock";
import { Onboarding } from "./onboarding/onboarding";
import { Settings } from "./settings/settings";

export function App() {
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [addingProfile, setAddingProfile] = useState(false);

  const reload = useCallback(() => {
    void loadConfig().then((loaded) => {
      setConfig(loaded);
      // The window starts hidden (tray app); first launch must surface onboarding.
      if (loaded.profiles.length === 0) {
        const window = getCurrentWindow();
        void window.show().then(() => window.setFocus()).catch(() => {});
      }
    });
  }, []);

  useEffect(reload, [reload]);
  useEffect(applyDockIconPrefOnStartup, []);

  if (!config) {
    return (
      <main className="flex h-screen flex-col">
        <DragStrip />
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      </main>
    );
  }

  if (config.profiles.length === 0 || addingProfile) {
    return (
      <Onboarding
        onComplete={() => {
          setAddingProfile(false);
          reload();
        }}
        onCancel={addingProfile ? () => setAddingProfile(false) : undefined}
      />
    );
  }

  return <Settings config={config} onReload={reload} onAddProfile={() => setAddingProfile(true)} />;
}
