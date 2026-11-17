"use client";

import { Fragment, useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CheckIcon, ChevronDown, Info, Star } from "lucide-react";
import { DropdownSearchInput } from "@/components/custom/dropdown-search-input";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import {
  getCliEffortOptions,
  getCliModelOption,
  getCliModelOptions,
  getCliModelTooltip,
  getCliModelGroups,
  getCliProviderNotice,
  getCliTriggerLabel,
  isCliSelectable,
  renderCliIcon,
  CLI_TYPE_MAP,
  CLI_TYPE_SELECTOR_ORDER,
  DEFAULT_FALLBACK_CLI_TYPE,
  type AvailableCliInfo,
  type CliModel,
  type CliTypeSlug,
} from "@/lib/cli-runtime-ui/registry";
import {
  loadRememberedNewThreadCliSelection,
  type RememberedNewThreadCliCombos,
} from "@/lib/threads/remembered-new-thread-cli-models";
import {
  isSameCliFavoriteCombo,
  type CliFavoriteCombo,
  type CliFavoriteComboView,
} from "@/lib/threads/cli-favorite-combos";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CliTypeSelectorProps {
  /** undefined = nothing selected (no check marks); the menu still scopes to the default runtime. */
  value?: CliTypeSlug;
  onChange: (value: CliTypeSlug) => void;
  cliModel?: CliModel;
  cliEffort?: string;
  availableClis?: AvailableCliInfo[];
  onCliModelChange?: (value: CliModel) => void;
  onCliEffortChange?: (value: string) => void;
  allowedCliTypes?: CliTypeSlug[];
  disabled?: boolean;
  compact?: boolean;
  /**
   * Favorite CLI+model+effort combos (OS-1208), already sanitized against
   * the runtime registry. Rendered as a "Favorites" section on the menu edge
   * nearest the trigger; when `onToggleFavoriteCombo` is provided, "Last used" and
   * favorite rows get a star toggle. Combos marked unavailable render
   * disabled (tooltip explains why) but keep their unpin star.
   */
  favoriteCombos?: CliFavoriteComboView[];
  onToggleFavoriteCombo?: (combo: CliFavoriteCombo) => void;
  /**
   * Menu items rendered above everything else, for hosts that add a
   * non-runtime choice (the Workflow lane menu's "Parallel").
   */
  leadingItems?: React.ReactNode;
  /** Menu items rendered below the runtime list (the Workflow lane menu's mode/agent/delete). */
  trailingItems?: React.ReactNode;
  /**
   * Keep the menu open when a runtime, model, or effort is picked — for hosts
   * whose menu is a settings surface that closes only on outside click or an
   * explicit action (the Workflow lane menu).
   */
  keepOpenOnSelect?: boolean;
  /** Replaces the trigger's icon + label; button behavior and chevron kept. */
  triggerContent?: React.ReactNode;
  /** Names the trigger for hosts rendered once per entity (per-lane menus). */
  triggerAriaLabel?: string;
}

/** Model lists longer than this get a filter input above them. */
const MODEL_SEARCH_THRESHOLD = 10;

export function CliTypeSelector({
  value,
  onChange,
  cliModel,
  cliEffort,
  availableClis,
  onCliModelChange,
  onCliEffortChange,
  allowedCliTypes,
  disabled = false,
  compact = false,
  favoriteCombos,
  onToggleFavoriteCombo,
  leadingItems,
  trailingItems,
  keepOpenOnSelect = false,
  triggerContent,
  triggerAriaLabel,
}: CliTypeSelectorProps) {
  const [open, setOpen] = useState(false);
  // Selections close the menu unless the host keeps it open as a settings surface.
  const closeOnSelect = () => {
    if (!keepOpenOnSelect) {
      setOpen(false);
    }
  };
  const preventCloseOnSelect = keepOpenOnSelect
    ? (event: Event) => event.preventDefault()
    : undefined;
  const [modelSearch, setModelSearch] = useState("");
  // Favorites and "Last used" sit on the edge nearest the trigger (OS-1899),
  // which depends on the side Radix picked: `data-side` on the content node.
  // Read it from a callback ref — Radix portals the content in a commit of its
  // own, so a mount effect runs before the node exists. Radix then resolves
  // the side asynchronously (the menu is parked off-screen until it does), so
  // watch the attribute and reorder before the paint that reveals the menu.
  const [opensUpwards, setOpensUpwards] = useState(false);
  const sideObserver = useRef<MutationObserver | null>(null);
  const trackMenuSide = useCallback((content: HTMLDivElement | null) => {
    sideObserver.current?.disconnect();
    sideObserver.current = null;
    if (!content) {
      return;
    }
    const read = () => setOpensUpwards(content.dataset.side === "top");
    read();
    sideObserver.current = new MutationObserver(() => flushSync(read));
    sideObserver.current.observe(content, { attributeFilter: ["data-side"] });
  }, []);
  // Last-used model+effort combos per runtime (OS-1200). Loaded from the
  // remembered-selection store lazily and refreshed on every open so combos
  // recorded by other composers in the same tab show up without a remount.
  const [rememberedCombos, setRememberedCombos] =
    useState<RememberedNewThreadCliCombos>(
      () => loadRememberedNewThreadCliSelection().combosByCliType,
    );
  // Selection checks compare against `value` (undefined matches nothing);
  // everything that needs a concrete runtime scopes to this instead.
  const scopeCliType = value ?? DEFAULT_FALLBACK_CLI_TYPE;
  const triggerLabel = getCliTriggerLabel(scopeCliType, cliModel, availableClis);
  const triggerProvider = getCliProviderNotice(scopeCliType, availableClis)?.label;
  // Mirror the Codex app trigger ("5.5 High"): append the effort label when
  // a non-default reasoning effort is selected.
  const triggerEffortLabel =
    cliEffort && cliEffort !== "default"
      ? getCliEffortOptions(scopeCliType, { cliModel, availableClis }).find(
          (option) => option.value === cliEffort,
        )?.label
      : undefined;

  const isAllowedCliType = (slug: CliTypeSlug) =>
    !allowedCliTypes || allowedCliTypes.includes(slug);

  // Started threads cannot switch CLI, so the selector skips the CLI-type
  // list and opens the active runtime's model/effort menu directly.
  const isLockedToCurrent =
    allowedCliTypes?.length === 1 && allowedCliTypes[0] === value;

  // Star toggle for "Last used" and favorite rows (OS-1208). Same
  // swallow-the-event pattern as the model info tooltip so toggling never
  // selects the row or closes the menu.
  const renderFavoriteStar = (combo: CliFavoriteCombo, starDisabled: boolean) => {
    if (!onToggleFavoriteCombo) {
      return null;
    }
    const favorited = (favoriteCombos ?? []).some((entry) =>
      isSameCliFavoriteCombo(entry, combo),
    );
    return (
      <span
        role="button"
        aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
        className="inline-flex size-4 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (starDisabled) {
            return;
          }
          onToggleFavoriteCombo(combo);
        }}
        onKeyDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <Star className={cn("size-3.5", favorited && "fill-current")} />
      </span>
    );
  };

  const renderRuntimeOptions = (slug: CliTypeSlug, itemsDisabled: boolean) => {
    const modelOptions = getCliModelOptions(slug, availableClis);
    // Per-model efforts (OpenCode variants) only apply to the active
    // runtime's selected model; other runtimes see their static catalog.
    const effortOptions = getCliEffortOptions(slug, {
      cliModel: value === slug ? cliModel : undefined,
      availableClis,
    });

    // Hosted provider (OS-2105): name it, its limits, and a saved model it cannot run.
    const providerNotice = getCliProviderNotice(slug, availableClis);
    const providerSection = providerNotice ? (
      <>
        <DropdownMenuLabel className="text-xs">
          <span className="block">{providerNotice.label}</span>
          <span className="block font-normal text-muted-foreground">{providerNotice.limits}</span>
          {value === slug && cliModel !== undefined && !modelOptions.some((option) => option.value === cliModel) ? (
            <span className="block font-normal text-destructive">Select a supported model to run.</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
      </>
    ) : null;

    // Reasoning does not close the menu, so effort + model can be picked
    // in one visit (effort applies to the model selected next).
    const renderEffortItem = (option: (typeof effortOptions)[number]) => (
      <DropdownMenuItem
        key={option.value}
        title={option.description}
        onSelect={(event) => event.preventDefault()}
        onClick={() => {
          if (itemsDisabled) {
            return;
          }
          // Only fire the type change on an actual
          // switch — it resets model/effort to defaults.
          if (value !== slug) {
            onChange(slug);
          }
          onCliEffortChange?.(option.value);
        }}
      >
        <span>{option.label}</span>
        {value === slug && (cliEffort ?? "default") === option.value && (
          <CheckIcon className="ml-auto size-4" />
        )}
      </DropdownMenuItem>
    );

    const renderModelItem = (option: (typeof modelOptions)[number]) => {
      const model = option.value;
      const modelTooltip = getCliModelTooltip(slug, model);
      return (
        <DropdownMenuItem
          key={model}
          onSelect={preventCloseOnSelect}
          onClick={() => {
            if (itemsDisabled) {
              return;
            }
            // Only fire the type change on an actual
            // switch — it resets model/effort to defaults.
            if (value !== slug) {
              onChange(slug);
            }
            onCliModelChange?.(model);
            closeOnSelect();
          }}
        >
          <div className="flex items-center gap-1.5">
            <span>{option?.label ?? model}</span>
            {modelTooltip ? (
              <TooltipExt content={modelTooltip}>
                <span
                  aria-label="Default model info"
                  className="inline-flex size-4 items-center justify-center text-muted-foreground"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onKeyDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <Info className="size-3.5" />
                </span>
              </TooltipExt>
            ) : null}
          </div>
          {value === slug && cliModel === model && (
            <CheckIcon className="ml-auto size-4" />
          )}
        </DropdownMenuItem>
      );
    };

    // Last-used model+effort combos (OS-1200): rendered at the top level of
    // the runtime submenu (never inside provider groups), newest first, on the
    // edge nearest the trigger (OS-1899).
    // Selecting a combo applies both values and closes the menu.
    const combos = rememberedCombos[slug] ?? [];
    const lastUsedSection =
      combos.length > 0 ? (
        <>
          {opensUpwards ? <DropdownMenuSeparator /> : null}
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Last used
          </DropdownMenuLabel>
          {combos.map((combo) => {
            const comboEffort = combo.cliEffort ?? "default";
            const modelLabel =
              getCliModelOption(slug, combo.cliModel, availableClis)?.label ??
              combo.cliModel;
            const effortLabel =
              comboEffort !== "default"
                ? getCliEffortOptions(slug, {
                    cliModel: combo.cliModel,
                    availableClis,
                  }).find((option) => option.value === comboEffort)?.label
                : undefined;
            const comboSelected =
              value === slug &&
              cliModel === combo.cliModel &&
              (cliEffort ?? "default") === comboEffort;
            return (
              <DropdownMenuItem
                key={`${combo.cliModel}::${comboEffort}`}
                onSelect={preventCloseOnSelect}
                onClick={() => {
                  if (itemsDisabled) {
                    return;
                  }
                  if (value !== slug) {
                    onChange(slug);
                  }
                  onCliModelChange?.(combo.cliModel);
                  onCliEffortChange?.(comboEffort);
                  closeOnSelect();
                }}
              >
                <span>
                  {modelLabel}
                  {effortLabel ? (
                    <span className="ml-1 text-muted-foreground">
                      {effortLabel}
                    </span>
                  ) : null}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {comboSelected && <CheckIcon className="size-4" />}
                  {renderFavoriteStar(
                    {
                      cliType: slug,
                      cliModel: combo.cliModel,
                      cliEffort: combo.cliEffort,
                    },
                    itemsDisabled,
                  )}
                </span>
              </DropdownMenuItem>
            );
          })}
          {opensUpwards ? null : <DropdownMenuSeparator />}
        </>
      ) : null;
    const lastUsedAbove = opensUpwards ? null : lastUsedSection;
    const lastUsedBelow = opensUpwards ? lastUsedSection : null;

    // Long catalogs (OpenCode advertises every connected provider's models)
    // get a filter input; a non-empty query flattens the list to matches.
    const searchable = modelOptions.length > MODEL_SEARCH_THRESHOLD;
    const searchQuery = modelSearch.trim().toLowerCase();
    // Known issue (OS-1139): Radix DropdownMenu owns focus — items grab it on hover and the
    // content grabs it between items — so typing without first clicking the input hits the menu
    // typeahead instead of this field. Failed workarounds are catalogued in OS-1139; do not
    // retry them. The proper fix is the cmdk Command pattern for the searchable surface.
    const searchInput = searchable ? (
      <DropdownSearchInput
        value={modelSearch}
        placeholder="Search models…"
        // Match DropdownMenuItem rows: menu already pads p-1, rows are h-7 with px-1.5; pb-1 spaces the first row.
        wrapperClassName="p-0 pb-1"
        className="h-7 *:data-[slot=input-group-addon]:pl-1.5"
        onChange={(event) => setModelSearch(event.target.value)}
        onKeyDown={(event) => {
          // Keep typing out of the menu's typeahead; Escape still
          // closes, and arrow keys hand focus to the result list.
          if (
            event.key !== "Escape" &&
            event.key !== "ArrowDown" &&
            event.key !== "ArrowUp"
          ) {
            event.stopPropagation();
          }
        }}
      />
    ) : null;

    if (searchable && searchQuery.length > 0) {
      const matches = modelOptions.filter((option) =>
        `${option.label} ${option.value}`.toLowerCase().includes(searchQuery),
      );
      return (
        <>
          {searchInput}
          {matches.length > 0 ? (
            matches.map(renderModelItem)
          ) : (
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              No models match
            </DropdownMenuLabel>
          )}
        </>
      );
    }

    const modelGroups = getCliModelGroups(slug, modelOptions);
    if (modelGroups) {
      // Provider submenus: icon + provider name on the trigger; inside, the group's Reasoning
      // section above its models. Unlabeled groups (the machine-default slot) render as plain
      // rows. Runtimes whose groups carry no reasoning of their own keep the selected-model
      // Reasoning section on top.
      const groupsHaveEfforts = modelGroups.some(
        (group) => (group.effortOptions?.length ?? 0) > 0,
      );
      return (
        <>
          {providerSection}
          {lastUsedAbove}
          {searchInput}
          {!groupsHaveEfforts && effortOptions.length > 0 ? (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Reasoning
              </DropdownMenuLabel>
              {effortOptions.map(renderEffortItem)}
              <DropdownMenuSeparator />
            </>
          ) : null}
          {modelGroups.map((group) => {
            if (!group.label) {
              return (
                <Fragment key={group.key}>
                  {group.options.map(renderModelItem)}
                </Fragment>
              );
            }
            const groupSelected =
              value === slug &&
              group.options.some((option) => option.value === cliModel);
            return (
              <DropdownMenuSub key={group.key}>
                <DropdownMenuSubTrigger
                  disabled={itemsDisabled}
                  className={cn(groupSelected && "bg-accent/50")}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {group.icon ? <group.icon className="size-4" /> : null}
                      <span>{group.label}</span>
                    </div>
                    {groupSelected && <CheckIcon className="size-4" />}
                  </div>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="max-h-[70vh] w-56 overflow-y-auto">
                    {group.effortOptions && group.effortOptions.length > 0 ? (
                      <>
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          Reasoning
                        </DropdownMenuLabel>
                        {group.effortOptions.map(renderEffortItem)}
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    {group.options.map(renderModelItem)}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            );
          })}
          {lastUsedBelow}
        </>
      );
    }

    return (
      <>
        {providerSection}
        {lastUsedAbove}
        {effortOptions.length > 0 ? (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Reasoning
            </DropdownMenuLabel>
            {effortOptions.map(renderEffortItem)}
            {modelOptions.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Model
                </DropdownMenuLabel>
              </>
            ) : null}
          </>
        ) : null}
        {searchInput}
        {modelOptions.map(renderModelItem)}
        {lastUsedBelow}
      </>
    );
  };

  const lockedRuntimeHasOptions =
    getCliModelOptions(scopeCliType, availableClis).length > 0 ||
    getCliEffortOptions(scopeCliType, { cliModel, availableClis }).length > 0;

  // Favorites (OS-1208): cross-runtime CLI+model+effort combos pinned to the
  // menu edge nearest the trigger (OS-1899). One click applies all three and
  // closes. Locked threads only see favorites for the runtime they are locked
  // to.
  // Unavailable combos fall back to the raw model value so the user can
  // still tell which combo the stale row was.
  const favoriteModelLabel = (combo: CliFavoriteComboView) =>
    getCliModelOption(combo.cliType, combo.cliModel, availableClis)?.label ??
    combo.cliModel;
  // Grouped by runtime (selector order), then by model label (OS-1919); the
  // sort is stable, so effort variants of one model keep their pinned order.
  const visibleFavorites = (favoriteCombos ?? [])
    .filter(
      (combo) =>
        isAllowedCliType(combo.cliType) && isCliSelectable(combo.cliType),
    )
    .sort(
      (a, b) =>
        CLI_TYPE_SELECTOR_ORDER.indexOf(a.cliType) -
          CLI_TYPE_SELECTOR_ORDER.indexOf(b.cliType) ||
        favoriteModelLabel(a).localeCompare(favoriteModelLabel(b)),
    );
  const favoritesSection =
    visibleFavorites.length > 0 ? (
      <>
        {opensUpwards ? <DropdownMenuSeparator /> : null}
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Favorites
        </DropdownMenuLabel>
        {visibleFavorites.map((combo) => {
          const comboEffort = combo.cliEffort ?? "default";
          const modelLabel = favoriteModelLabel(combo);
          const effortLabel =
            comboEffort !== "default"
              ? (getCliEffortOptions(combo.cliType, {
                  cliModel: combo.cliModel,
                  availableClis,
                }).find((option) => option.value === comboEffort)?.label ??
                comboEffort)
              : undefined;
          const comboSelected =
            value === combo.cliType &&
            cliModel === combo.cliModel &&
            (cliEffort ?? "default") === comboEffort;
          // Unavailable favorites (model dropped from the registry) render
          // disabled but keep the star, so the list never grows stale rows
          // the user can't get rid of. Not Radix `disabled` — that would
          // swallow pointer events on the unpin star too.
          const unavailable = !combo.isAvailable;
          return (
            <DropdownMenuItem
              key={`${combo.cliType}::${combo.cliModel}::${comboEffort}`}
              aria-disabled={unavailable}
              title={
                unavailable
                  ? `${modelLabel} is no longer available for ${CLI_TYPE_MAP[combo.cliType]}. Unpin it with the star.`
                  : undefined
              }
              className={cn(unavailable && "text-muted-foreground opacity-60")}
              onSelect={preventCloseOnSelect}
              onClick={() => {
                if (disabled || unavailable) {
                  return;
                }
                // Only fire the type change on an actual
                // switch — it resets model/effort to defaults.
                if (value !== combo.cliType) {
                  onChange(combo.cliType);
                }
                onCliModelChange?.(combo.cliModel);
                onCliEffortChange?.(comboEffort);
                closeOnSelect();
              }}
            >
              <div className="flex w-full items-center gap-2">
                {renderCliIcon(combo.cliType, "size-4")}
                <span>
                  {modelLabel}
                  {effortLabel ? (
                    <span className="ml-1 text-muted-foreground">
                      {effortLabel}
                    </span>
                  ) : null}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {comboSelected && <CheckIcon className="size-4" />}
                  {renderFavoriteStar(combo, disabled)}
                </span>
              </div>
            </DropdownMenuItem>
          );
        })}
        {opensUpwards ? null : <DropdownMenuSeparator />}
      </>
    ) : null;

  return (
    <DropdownMenu
      // Non-modal like the other composer selectors: a modal menu sets
      // pointer-events:none on body, which breaks tap-outside dismissal and
      // hit-testing when the composer is hosted inside a vaul drawer.
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        if (disabled || (isLockedToCurrent && !lockedRuntimeHasOptions)) return;
        setOpen(nextOpen);
        if (nextOpen) {
          setRememberedCombos(
            loadRememberedNewThreadCliSelection().combosByCliType,
          );
        } else {
          setModelSearch("");
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            "min-w-0 shrink",
            compact ? "gap-1 px-2" : "gap-2",
            !disabled && "cursor-pointer",
            disabled && "cursor-default text-muted-foreground/80"
          )}
          aria-disabled={disabled}
          aria-label={triggerAriaLabel}
          title={triggerContent ? undefined : triggerProvider ? `${triggerLabel} · ${triggerProvider}` : triggerLabel}
        >
          {triggerContent ?? (
            <>
              {renderCliIcon(scopeCliType, "size-4")}
              {compact ? (
                <span className="sr-only">{triggerLabel}</span>
              ) : (
                <span className="min-w-0 truncate">
                  {triggerLabel}
                  {triggerEffortLabel ? (
                    <span className="ml-1 text-muted-foreground">
                      {triggerEffortLabel}
                    </span>
                  ) : null}
                </span>
              )}
            </>
          )}
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={trackMenuSide}
        align="start"
        className="max-h-[70vh] w-56 overflow-y-auto"
      >
        {leadingItems}
        {opensUpwards ? null : favoritesSection}
        {isLockedToCurrent
          ? renderRuntimeOptions(scopeCliType, disabled || !isCliSelectable(scopeCliType))
          : CLI_TYPE_SELECTOR_ORDER.map((slug) => {
              const name = CLI_TYPE_MAP[slug];
              const modelOptions = getCliModelOptions(slug, availableClis);
              const effortOptions = getCliEffortOptions(slug, {
                cliModel: value === slug ? cliModel : undefined,
                availableClis,
              });
              const isLocked = !isAllowedCliType(slug);
              const isDisabled = !isCliSelectable(slug) || isLocked;

              if (modelOptions.length > 0 || effortOptions.length > 0) {
                return (
                  <DropdownMenuSub key={slug}>
                    <DropdownMenuSubTrigger
                      disabled={disabled || isDisabled}
                      className={cn(value === slug && "bg-accent/50")}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {renderCliIcon(slug, "size-4")}
                          <span>{name}</span>
                        </div>
                        {value === slug && <CheckIcon className="size-4" />}
                      </div>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent className="max-h-[70vh] w-56 overflow-y-auto">
                        {renderRuntimeOptions(slug, disabled || isDisabled)}
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                );
              }

              return (
                <DropdownMenuItem
                  key={slug}
                  disabled={disabled || isDisabled}
                  onSelect={preventCloseOnSelect}
                  onClick={() => {
                    if (disabled || isDisabled) {
                      return;
                    }
                    onChange(slug);
                    closeOnSelect();
                  }}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {renderCliIcon(slug, "size-4")}
                      <span>{name}</span>
                    </div>
                    {value === slug && <CheckIcon className="size-4" />}
                  </div>
                </DropdownMenuItem>
              );
            })}
        {opensUpwards ? favoritesSection : null}
        {trailingItems}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
