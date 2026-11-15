"use client";

import * as React from "react";
import { Bell, ChevronDown, Info, Mail, Monitor, PictureInPicture2, Smartphone } from "lucide-react";
import type { NotificationChannel } from "@/convex/lib/contracts/notifications";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { NOTIFICATION_PREFERENCE_GROUPS } from "@/lib/notifications/preference-groups";
import { readNotificationSoundEnabled, writeNotificationSoundEnabled } from "@/lib/notifications/sound";
import { useNotificationPreferences } from "@/lib/notifications/hooks/use-notification-preferences";

// Delivery channels shown in every multiselect. In-app and toast are wired; the rest ship with
// their tickets (email OS-1126, push OS-1245, desktop OS-1355) and stay visible-but-disabled so
// the direction is discoverable. The discriminated union ties `available: true` to a real backend
// channel, so flipping a future one on forces its key into NotificationChannel first.
type ChannelOption =
  | { key: NotificationChannel; label: string; icon: typeof Bell; available: true }
  | { key: NotificationChannel | "push" | "desktop"; label: string; icon: typeof Bell; available: false };

const CHANNEL_OPTIONS: ChannelOption[] = [
  { key: "inApp", label: "In-app", icon: Bell, available: true },
  { key: "toast", label: "Toast", icon: PictureInPicture2, available: true },
  { key: "email", label: "Email", icon: Mail, available: false },
  { key: "push", label: "Push", icon: Smartphone, available: false },
  { key: "desktop", label: "Desktop", icon: Monitor, available: false },
];

const ACTIVE_CHANNELS = CHANNEL_OPTIONS.filter(
  (channel): channel is Extract<ChannelOption, { available: true }> => channel.available
);

type ChannelState = Partial<Record<NotificationChannel, boolean | "indeterminate">>;

function NotificationTypeInfo({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`About ${label} notifications`}
          className="size-5 shrink-0 text-muted-foreground"
        >
          <Info className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>{label}</PopoverTitle>
          <PopoverDescription>{description}</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Channel multiselect for one notification type (or a whole group): a
 * badge-style trigger summarizing the enabled channels, opening checkbox
 * items that keep the menu open across flips.
 */
function ChannelsDropdown({
  ariaLabel,
  state,
  disabled,
  onChange,
}: {
  ariaLabel: string;
  state: ChannelState;
  disabled: boolean;
  onChange: (channel: NotificationChannel, next: boolean) => void;
}) {
  const mixed = ACTIVE_CHANNELS.some((channel) => state[channel.key] === "indeterminate");
  const active = ACTIVE_CHANNELS.filter((channel) => state[channel.key] === true);
  const summary = mixed ? "Mixed" : active.length === 0 ? "Off" : active.map((channel) => channel.label).join(", ");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          disabled={disabled}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-[min(var(--radius-md),12px)] bg-muted py-1 pl-2 pr-1.5 text-xs text-muted-foreground transition-colors select-none hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {summary}
          <ChevronDown className="size-3 pointer-events-none" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Channels</DropdownMenuLabel>
        {CHANNEL_OPTIONS.map((channel) => {
          // In the true branch `channel` narrows to the available arm, so its
          // key is a real NotificationChannel — no cast needed.
          const enabledKey = channel.available ? channel.key : null;
          return (
            <DropdownMenuCheckboxItem
              key={channel.key}
              className="cursor-pointer gap-2"
              checked={enabledKey !== null ? (state[enabledKey] ?? false) : false}
              disabled={enabledKey === null}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(next) => {
                if (enabledKey !== null) {
                  onChange(enabledKey, next === true);
                }
              }}
            >
              <channel.icon className="size-4 text-muted-foreground" />
              {channel.label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Sound rides the agent-run toast rather than being its own channel, so it is a
 * per-device switch (localStorage) instead of a matrix column
 * (docs/specs/notifications.md).
 */
function SoundRow() {
  const [enabled, setEnabled] = React.useState(readNotificationSoundEnabled);

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm">Sound for agent runs</p>
        <p className="text-xs text-muted-foreground">
          Plays a short sound wherever an agent-run toast appears, and a more insistent one when a
          run fails or needs your input. This browser only.
        </p>
      </div>
      <Switch
        checked={enabled}
        aria-label="Sound for agent runs"
        onCheckedChange={(next) => {
          setEnabled(next);
          writeNotificationSoundEnabled(next);
        }}
      />
    </div>
  );
}

/**
 * Per-type notification channels, grouped for scanning. The group header's
 * multiselect applies a channel to every type in the group at once — a UI
 * convenience; storage and writes stay per-type
 * (docs/specs/notifications.md).
 */
export function NotificationsSection() {
  const { loading, isEnabled, setChannel } = useNotificationPreferences();

  const typeState = (type: (typeof NOTIFICATION_PREFERENCE_GROUPS)[number]["types"][number]["type"]): ChannelState =>
    Object.fromEntries(ACTIVE_CHANNELS.map((channel) => [channel.key, isEnabled(type, channel.key)]));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Choose which notifications you receive and through which channels. Applies across all your projects.
        </p>
      </div>

      <SoundRow />

      {NOTIFICATION_PREFERENCE_GROUPS.map((group) => {
        const groupState: ChannelState = Object.fromEntries(
          ACTIVE_CHANNELS.map((channel) => {
            const enabledCount = group.types.filter((entry) => isEnabled(entry.type, channel.key)).length;
            return [
              channel.key,
              enabledCount === group.types.length ? true : enabledCount === 0 ? false : "indeterminate",
            ];
          })
        );
        return (
          <div key={group.id} className="space-y-2">
            {/* pr-4 keeps the group trigger flush with the row triggers,
                which sit inside the bordered container's px-4 padding. */}
            <div className="flex items-center justify-between gap-4 pr-4">
              <h3 className="text-sm font-medium">{group.label}</h3>
              <ChannelsDropdown
                ariaLabel={`Channels for all ${group.label} notifications`}
                state={groupState}
                disabled={loading}
                onChange={(channel, next) => void setChannel(group.types.map((entry) => entry.type), channel, next)}
              />
            </div>
            <div className="divide-y divide-border rounded-lg border border-border">
              {group.types.map((entry) => (
                <div key={entry.type} className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="truncate text-sm">{entry.label}</span>
                    <NotificationTypeInfo label={entry.label} description={entry.description} />
                  </div>
                  <ChannelsDropdown
                    ariaLabel={`Channels for ${entry.label} notifications`}
                    state={typeState(entry.type)}
                    disabled={loading}
                    onChange={(channel, next) => void setChannel([entry.type], channel, next)}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
