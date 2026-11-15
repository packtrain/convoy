"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const MdxEditor = dynamic(
  () => import("@/components/mdx-editor").then((mod) => mod.MdxEditor),
  {
    ssr: false,
    loading: () => <ReadonlyMarkdownSkeleton />,
  }
);

interface SettingsReadonlyMarkdownProps {
  value: string;
  className?: string;
}

export function SettingsReadonlyMarkdown({
  value,
  className,
}: SettingsReadonlyMarkdownProps) {
  return (
    <div className={cn("overflow-hidden", className)}>
      <MdxEditor
        value={value}
        onChange={() => {}}
        showDiffMode={false}
        toolbar={false}
        disabled
        className="min-h-0"
      />
    </div>
  );
}

function ReadonlyMarkdownSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading markdown">
      <Skeleton className="h-5 w-2/3 rounded-sm" />
      <Skeleton className="h-4 w-full rounded-sm" />
      <Skeleton className="h-4 w-5/6 rounded-sm" />
    </div>
  );
}
