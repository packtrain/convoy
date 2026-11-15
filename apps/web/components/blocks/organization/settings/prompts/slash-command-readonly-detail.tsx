import { ArrowLeft } from "lucide-react";

import { SettingsReadonlyMarkdown } from "@/components/blocks/settings-catalog/settings-readonly-markdown";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  UNCATEGORIZED_CATEGORY,
  getSlashCommandCategory,
  getSlashCommandDisplayKey,
  type SlashCommandListItem,
} from "./slash-command-list-utils";

interface SlashCommandReadonlyDetailProps {
  command: SlashCommandListItem;
  onBack: () => void;
}

export function SlashCommandReadonlyDetail({ command, onBack }: SlashCommandReadonlyDetailProps) {
  const category = getSlashCommandCategory(command);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" />
        Back
      </Button>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{getSlashCommandDisplayKey(command.key)}</h1>
          {command.autoExpand ? (
            <Badge variant="outline" shape="rounded">
              Auto-expand
            </Badge>
          ) : null}
          {command.autoSubmit ? (
            <Badge variant="outline" shape="rounded">
              Autosubmit
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <span>{category || UNCATEGORIZED_CATEGORY}</span>
        </div>
        {command.description ? <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{command.description}</p> : null}
      </header>

      <section className="rounded-lg border border-border bg-background p-5">
        <SettingsReadonlyMarkdown value={command.content} />
      </section>
    </div>
  );
}
