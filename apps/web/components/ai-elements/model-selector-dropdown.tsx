import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ComponentPropsWithoutRef } from "react";

export type ModelSelectorDropdownProps = ComponentPropsWithoutRef<
  typeof DropdownMenu
>;

export const ModelSelectorDropdown = (props: ModelSelectorDropdownProps) => (
  <DropdownMenu {...props} />
);

export type ModelSelectorDropdownTriggerProps = ComponentPropsWithoutRef<
  typeof DropdownMenuTrigger
>;

export const ModelSelectorDropdownTrigger = (
  props: ModelSelectorDropdownTriggerProps
) => <DropdownMenuTrigger {...props} />;

export type ModelSelectorDropdownContentProps = Omit<
  ComponentPropsWithoutRef<typeof DropdownMenuContent>,
  "key"
> & {
  /** Value of the CommandItem to highlight initially (passed to cmdk's Command) */
  defaultHighlight?: string;
  /**
   * Remount key for the inner Command (resets cmdk search/highlight state,
   * e.g. between in-place pages) without remounting the Radix content —
   * remounting the content itself dismisses the open menu.
   */
  commandKey?: string;
};

export const ModelSelectorDropdownContent = ({
  className,
  children,
  defaultHighlight,
  commandKey,
  ...props
}: ModelSelectorDropdownContentProps) => (
  <DropdownMenuContent
    className={cn("w-[320px] p-0", className)}
    align="start"
    {...props}
  >
    <Command
      key={commandKey}
      className="**:data-[slot=command-input-wrapper]:h-auto"
      value={defaultHighlight}
    >
      {children}
    </Command>
  </DropdownMenuContent>
);

export type ModelSelectorDropdownInputProps = Omit<
  ComponentPropsWithoutRef<typeof CommandInput>,
  "key"
>;

export const ModelSelectorDropdownInput = ({
  className,
  ...props
}: ModelSelectorDropdownInputProps) => (
  <CommandInput className={cn("h-auto py-3.5", className)} {...props} />
);

export type ModelSelectorDropdownListProps = Omit<
  ComponentPropsWithoutRef<typeof CommandList>,
  "key"
>;

export const ModelSelectorDropdownList = (
  props: ModelSelectorDropdownListProps
) => <CommandList {...props} />;

export type ModelSelectorDropdownEmptyProps = Omit<
  ComponentPropsWithoutRef<typeof CommandEmpty>,
  "key"
>;

export const ModelSelectorDropdownEmpty = (
  props: ModelSelectorDropdownEmptyProps
) => <CommandEmpty {...props} />;

export type ModelSelectorDropdownGroupProps = Omit<
  ComponentPropsWithoutRef<typeof CommandGroup>,
  "key"
>;

export const ModelSelectorDropdownGroup = (
  props: ModelSelectorDropdownGroupProps
) => <CommandGroup {...props} />;

export type ModelSelectorDropdownItemProps = Omit<
  ComponentPropsWithoutRef<typeof CommandItem>,
  "key"
>;

export const ModelSelectorDropdownItem = (
  props: ModelSelectorDropdownItemProps
) => <CommandItem {...props} />;

export type ModelSelectorDropdownShortcutProps = Omit<
  ComponentPropsWithoutRef<typeof CommandShortcut>,
  "key"
>;

export const ModelSelectorDropdownShortcut = (
  props: ModelSelectorDropdownShortcutProps
) => <CommandShortcut {...props} />;

export type ModelSelectorDropdownSeparatorProps = Omit<
  ComponentPropsWithoutRef<typeof CommandSeparator>,
  "key"
>;

export const ModelSelectorDropdownSeparator = (
  props: ModelSelectorDropdownSeparatorProps
) => <CommandSeparator {...props} />;

export type ModelSelectorDropdownLogoProps = Omit<
  ComponentPropsWithoutRef<"img">,
  "src" | "alt"
> & {
  provider:
    | "moonshotai-cn"
    | "lucidquery"
    | "moonshotai"
    | "zai-coding-plan"
    | "alibaba"
    | "xai"
    | "vultr"
    | "nvidia"
    | "upstage"
    | "groq"
    | "github-copilot"
    | "mistral"
    | "vercel"
    | "nebius"
    | "deepseek"
    | "alibaba-cn"
    | "google-vertex-anthropic"
    | "venice"
    | "chutes"
    | "cortecs"
    | "github-models"
    | "togetherai"
    | "azure"
    | "baseten"
    | "huggingface"
    | "opencode"
    | "fastrouter"
    | "google"
    | "google-vertex"
    | "cloudflare-workers-ai"
    | "inception"
    | "wandb"
    | "openai"
    | "zhipuai-coding-plan"
    | "perplexity"
    | "openrouter"
    | "zenmux"
    | "v0"
    | "iflowcn"
    | "synthetic"
    | "deepinfra"
    | "zhipuai"
    | "submodel"
    | "zai"
    | "inference"
    | "requesty"
    | "morph"
    | "lmstudio"
    | "anthropic"
    | "aihubmix"
    | "fireworks-ai"
    | "modelscope"
    | "llama"
    | "scaleway"
    | "amazon-bedrock"
    | "cerebras"
    | (string & {});
};

export const ModelSelectorDropdownLogo = ({
  provider,
  className,
  ...props
}: ModelSelectorDropdownLogoProps) => (
  <img
    {...props}
    alt={`${provider} logo`}
    className={cn("size-3 dark:invert", className)}
    height={12}
    src={`https://models.dev/logos/${provider}.svg`}
    width={12}
  />
);

export type ModelSelectorDropdownLogoGroupProps = ComponentPropsWithoutRef<"div">;

export const ModelSelectorDropdownLogoGroup = ({
  className,
  ...props
}: ModelSelectorDropdownLogoGroupProps) => (
  <div
    className={cn(
      "flex shrink-0 items-center -space-x-1 [&>img]:rounded-full [&>img]:bg-background [&>img]:p-px [&>img]:ring-1 dark:[&>img]:bg-foreground",
      className
    )}
    {...props}
  />
);

export type ModelSelectorDropdownNameProps = ComponentPropsWithoutRef<"span">;

export const ModelSelectorDropdownName = ({
  className,
  ...props
}: ModelSelectorDropdownNameProps) => (
  <span className={cn("flex-1 truncate text-left", className)} {...props} />
);
