"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Settings, Bell, Bot, Shield, AlertTriangle, Key, Wrench, Server, Palette, Github } from "lucide-react";
import { ConnectedAccountsSection } from "@/components/blocks/integrations";
import { cn } from "@/lib/utils";
import { useShowUnfinishedItems } from "@/lib/dev-mode/use-dev-mode";
import { GeneralSection } from "./general-section";
import { AppearanceSection } from "./appearance-section";
import { AgentAutomationSection } from "./agent-automation-section";
import { ApiKeysSection } from "./api-keys";
import { DeveloperSection } from "./developer-section";
import { ProfilesSection } from "./profiles-section";
import { NotificationsSection } from "./notifications-section";

export type UserSettingsSectionId = "general" | "appearance" | "agents" | "profiles" | "developer" | "api-keys" | "notifications" | "connected-accounts" | "account" | "danger";

interface UserSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: UserSettingsSectionId;
  onSectionChange: (section: UserSettingsSectionId) => void;
}

const sections = [
  { id: "general" as const, label: "General", icon: Settings, disabled: false },
  { id: "appearance" as const, label: "Appearance", icon: Palette, disabled: false },
  { id: "agents" as const, label: "Agents", icon: Bot, disabled: false },
  { id: "profiles" as const, label: "CLI profiles", icon: Server, disabled: false },
  { id: "api-keys" as const, label: "API keys", icon: Key, disabled: false },
  {
    id: "notifications" as const,
    label: "Notifications",
    icon: Bell,
    disabled: false,
  },
  // Behind the GitHub integration developer toggle until it ships.
  { id: "connected-accounts" as const, label: "Connected accounts", icon: Github, disabled: false },
  { id: "account" as const, label: "Account", icon: Shield, disabled: true },
  {
    id: "danger" as const,
    label: "Danger zone",
    icon: AlertTriangle,
    disabled: true,
  },
  { id: "developer" as const, label: "Developer", icon: Wrench, disabled: false },
];

export function UserSettingsDialog({ open, onOpenChange, section, onSectionChange }: UserSettingsDialogProps) {
  const showUnfinishedItems = useShowUnfinishedItems();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl sm:max-w-3xl p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">User settings</DialogTitle>
        <DialogDescription className="sr-only">Manage your account, CLI profiles, API keys, and local developer settings.</DialogDescription>
        <div className="flex h-[500px] min-w-0">
          {/* Sidebar */}
          <nav className="w-52 shrink-0 bg-muted/30 p-2 flex flex-col gap-1">
            {sections.filter((s) => showUnfinishedItems || !s.disabled).map((s) => (
              <Button
                key={s.id}
                variant="ghost"
                onClick={() => !s.disabled && onSectionChange(s.id)}
                disabled={s.disabled}
                className={cn(
                  "h-8 justify-start gap-2 cursor-pointer",
                  section === s.id && !s.disabled && "bg-accent",
                  s.id === "danger" && !s.disabled && "text-destructive hover:text-destructive"
                )}
              >
                <s.icon className="size-4" />
                <span>{s.label}</span>
              </Button>
            ))}
          </nav>

          {/* Main content */}
          <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden overflow-y-auto p-6">
            {section === "general" && <GeneralSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "agents" && <AgentAutomationSection />}
            {section === "profiles" && <ProfilesSection />}
            {section === "developer" && <DeveloperSection />}
            {section === "api-keys" && <ApiKeysSection />}
            {section === "notifications" && <NotificationsSection />}
            {section === "connected-accounts" && <ConnectedAccountsSection />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
