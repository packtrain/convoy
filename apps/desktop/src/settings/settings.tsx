import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DragStrip } from "@/components/drag-strip";
import { type ConfigInfo } from "@/lib/backend";
import { GeneralTab } from "./general-tab";
import { ProfilesTab } from "./profiles-tab";
import { ApiKeysTab } from "./api-keys-tab";
import { AdvancedTab } from "./advanced-tab";

export function Settings({
  config,
  onReload,
  onAddProfile,
}: {
  config: ConfigInfo;
  onReload: () => void;
  onAddProfile: () => void;
}) {
  const defaultProfileKey = config.defaultProfile ?? config.profiles[0]?.key;

  return (
    <main className="flex h-screen flex-col">
      <DragStrip />
      <div className="flex min-h-0 flex-1 flex-col px-7 pb-6">
        <Tabs defaultValue="general" orientation="vertical" className="min-h-0 flex-1 gap-6">
          <TabsList variant="line" className="w-32 shrink-0">
            <TabsTrigger value="general" className="h-8">General</TabsTrigger>
            <TabsTrigger value="profiles" className="h-8">Profiles</TabsTrigger>
            <TabsTrigger value="api-keys" className="h-8">API keys</TabsTrigger>
            <TabsTrigger value="advanced" className="h-8">Advanced</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="min-h-0 overflow-y-auto">
            <GeneralTab config={config} defaultProfileKey={defaultProfileKey} />
          </TabsContent>
          <TabsContent value="profiles" className="min-h-0 overflow-y-auto">
            <ProfilesTab
              config={config}
              defaultProfileKey={defaultProfileKey}
              onReload={onReload}
              onAddProfile={onAddProfile}
            />
          </TabsContent>
          <TabsContent value="api-keys" className="min-h-0 overflow-y-auto">
            <ApiKeysTab config={config} onReload={onReload} />
          </TabsContent>
          <TabsContent value="advanced" className="min-h-0 overflow-y-auto">
            <AdvancedTab />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
