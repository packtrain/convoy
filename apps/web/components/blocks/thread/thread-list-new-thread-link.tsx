import { Plus } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { AppLink, appRoute } from "@/lib/navigation";

interface ThreadListNewThreadLinkProps {
  organizationSlug: string;
  projectAlias: string;
}

export function ThreadListNewThreadLink({
  organizationSlug,
  projectAlias,
}: ThreadListNewThreadLinkProps) {
  return (
    <AppLink
      href={appRoute.projectThreads(organizationSlug, projectAlias)}
      className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground mb-1"
    >
      <Plus className="size-4" />
      <span className="flex-1">New thread</span>
      <Kbd>N</Kbd>
    </AppLink>
  );
}
