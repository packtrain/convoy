import { SettingsPageContainer } from "@/components/custom/settings-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsCatalogListFrame } from "./settings-catalog-list-frame";

interface CatalogSkeletonProps {
  label: string;
}

interface CatalogSectionSkeletonProps extends CatalogSkeletonProps {
  variant: "agent" | "prompt";
}

export function SettingsCatalogSectionSkeleton({
  label,
  variant,
}: CatalogSectionSkeletonProps) {
  return (
    <div className="space-y-5" aria-label={label}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-9 w-full max-w-sm rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      <div className="grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="space-y-1">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-4/5 rounded-md" />
        </div>

        <SettingsCatalogListFrame>
          {Array.from({ length: 3 }).map((_, index) => (
            <SettingsCatalogSkeletonRow key={index} variant={variant} />
          ))}
        </SettingsCatalogListFrame>
      </div>
    </div>
  );
}

function SettingsCatalogSkeletonRow({ variant }: { variant: CatalogSectionSkeletonProps["variant"] }) {
  return (
    <div className="flex items-center gap-3 p-4">
      {variant === "agent" ? <Skeleton className="size-9 shrink-0 rounded-full" /> : null}
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-40 max-w-full rounded-sm" />
        <Skeleton className="h-3 w-64 max-w-full rounded-sm" />
      </div>
      <Skeleton className="h-6 w-24 shrink-0 rounded-full" />
      <Skeleton className="size-8 shrink-0 rounded-md" />
    </div>
  );
}

export function SettingsCatalogEditorSkeleton({ label }: CatalogSkeletonProps) {
  return (
    <SettingsPageContainer className="space-y-6" aria-label={label}>
      <Skeleton className="h-8 w-48 rounded-sm" />
      <div className="space-y-8">
        <div className="grid gap-6 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <div className="space-y-2">
            <Skeleton className="h-5 w-20 rounded-sm" />
            <Skeleton className="h-4 w-44 rounded-sm" />
          </div>
          <div className="grid gap-4 sm:grid-cols-6">
            <Skeleton className="h-16 rounded-lg sm:col-span-4" />
            <Skeleton className="h-16 rounded-lg sm:col-span-2" />
            <Skeleton className="h-20 rounded-lg sm:col-span-6" />
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <div className="space-y-2">
            <Skeleton className="h-5 w-20 rounded-sm" />
            <Skeleton className="h-4 w-52 rounded-sm" />
          </div>
          <Skeleton className="h-80 rounded-lg" />
        </div>
      </div>
    </SettingsPageContainer>
  );
}
