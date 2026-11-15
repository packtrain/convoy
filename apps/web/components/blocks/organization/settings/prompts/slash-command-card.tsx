import { SettingsCatalogCard } from "@/components/blocks/settings-catalog/settings-catalog-card";
import type { RouteTarget } from "@/lib/navigation";
import { deriveSlashCommandCardPreview, getSlashCommandDisplayKey, type SlashCommandListItem } from "./slash-command-list-utils";

interface SlashCommandCardProps {
  command: SlashCommandListItem;
  href: RouteTarget | string;
}

export function SlashCommandCard({ command, href }: SlashCommandCardProps) {
  const preview = deriveSlashCommandCardPreview(command);

  return (
    <SettingsCatalogCard
      href={href}
      ariaLabel={`Open ${getSlashCommandDisplayKey(command.key)}`}
      title={getSlashCommandDisplayKey(command.key)}
      metadata={getSlashCommandDisplayKey(command.key)}
      preview={preview}
    />
  );
}
