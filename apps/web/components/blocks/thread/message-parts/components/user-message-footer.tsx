"use client";

import { FolderOpen, GitBranch, User as UserIcon } from "lucide-react";
import {
  MessageFooterPopover,
  MessageFooterRow,
  MessageFooterTrigger,
} from "@/components/blocks/thread/message-parts/components/message-footer";
import {
  getCliEffortOptions,
  getCliIcon,
  getCliModeDefinition,
  getCliModelOption,
  renderCliIcon,
} from "@/lib/cli-runtime-ui/registry";
import { CLI_TYPE_MAP, type CliModel, type CliTypeSlug } from "@/lib/threads/types";

interface UserMessageFooterProps {
  cliType: CliTypeSlug;
  cliMode?: string;
  cliModel?: CliModel;
  cliEffort?: string;
  createdAt: number;
  profileName?: string;
  pathString?: string;
  gitRemoteUrl?: string;
}

export function UserMessageFooter({
  cliType,
  cliMode,
  cliModel,
  cliEffort,
  createdAt,
  profileName,
  pathString,
  gitRemoteUrl,
}: UserMessageFooterProps) {
  const modeDef = cliMode ? getCliModeDefinition(cliType, cliMode) : undefined;
  const ModeIcon = modeDef?.icon;
  const modelLabel = cliModel
    ? (getCliModelOption(cliType, cliModel)?.label ?? cliModel)
    : undefined;
  const effortLabel = cliEffort
    ? (getCliEffortOptions(cliType, { cliModel }).find((option) => option.value === cliEffort)
        ?.label ?? cliEffort)
    : undefined;
  const time = new Date(createdAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const trigger = (
    <MessageFooterTrigger>
      {renderCliIcon(cliType, "size-3.5")}
      {ModeIcon && <ModeIcon className="size-3" />}
      <span>{time}</span>
    </MessageFooterTrigger>
  );

  return (
    <MessageFooterPopover trigger={trigger} align="end">
      <MessageFooterRow
        label="CLI"
        icon={getCliIcon(cliType)}
        value={CLI_TYPE_MAP[cliType]}
      />
      {modeDef && (
        <MessageFooterRow
          label="Mode"
          icon={ModeIcon}
          value={modeDef.label}
        />
      )}
      {modelLabel && <MessageFooterRow label="Model" value={modelLabel} />}
      {effortLabel && <MessageFooterRow label="Reasoning" value={effortLabel} />}
      {profileName && (
        <MessageFooterRow
          label="Profile"
          icon={UserIcon}
          value={profileName}
        />
      )}
      {pathString && (
        <MessageFooterRow
          label="Path"
          icon={FolderOpen}
          value={pathString}
          truncate
        />
      )}
      {gitRemoteUrl && (
        <MessageFooterRow
          label="Git"
          icon={GitBranch}
          value={gitRemoteUrl}
          truncate
        />
      )}
      <MessageFooterRow label="Sent at" value={time} />
    </MessageFooterPopover>
  );
}
