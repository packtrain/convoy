"use client";

import type { WorkerKeyStatus } from "@/convex/apiKeys/lib/validators";
import type { ApiKeyKind } from "@/convex/lib/contracts/validators";
import type { Id } from "@/convex/_generated/dataModel";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MoreHorizontal, Trash2, Pencil, Shield } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { DeleteKeyDialog } from "./delete-key-dialog";
import { EditKeyDialog } from "./edit-key-dialog";
import { formatCompactRelativeTime } from "./api-key-time";
import {
  formatApiKeyScopeSummary,
  toApiKeyScopeInput,
  type ApiKeyListScope,
} from "./api-key-scope-types";

interface ApiKeyRowProps {
  apiKey: {
    _id: Id<"apiKeys">;
    name: string;
    keyPrefix: string;
    createdAt: number;
    lastUsedAt?: number;
    expiresAt?: number;
    scope: ApiKeyListScope;
    kind?: ApiKeyKind;
    sourceKeyName?: string;
    workerStatus?: WorkerKeyStatus;
  };
}

const WORKER_STATUS_REASON: Record<WorkerKeyStatus, string> = {
  active: "Requires a valid source key that still covers this project.",
  expired: "Worker key expired. Register this project again with a valid manual setup key.",
  invalid: "Worker credential or source is invalid. Register this project again with a manual setup key.",
  "source-deleted": "Source key was deleted. Register this project again with a new manual setup key.",
  "source-expired": "Source key expired. Register this project again with a new manual setup key.",
  "source-scope": "Source key no longer covers this project.",
};

export function ApiKeyRow({ apiKey }: ApiKeyRowProps) {
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  // Track current time at mount for expiration calculations
  const [now] = useState(() => Date.now());

  const { expiresAt } = apiKey;

  const workerInactive = apiKey.kind === "project-worker" && apiKey.workerStatus && apiKey.workerStatus !== "active";
  const workerReason = WORKER_STATUS_REASON[apiKey.workerStatus ?? "active"];
  const getExpiresInText = () => {
    if (workerInactive) return <span className="text-destructive" title={workerReason}>Inactive</span>;
    if (expiresAt === undefined) return <span className="text-muted-foreground">Never</span>;
    if (expiresAt < now) {
      return <span className="text-destructive">Expired</span>;
    }
    const daysUntilExpiry = differenceInDays(expiresAt, now);
    if (daysUntilExpiry <= 7) {
      return (
        <span className="text-amber-600 dark:text-amber-400">
          {daysUntilExpiry} days
        </span>
      );
    }
    return `${daysUntilExpiry} days`;
  };

  const getLastUsedText = () => {
    if (!apiKey.lastUsedAt) {
      return <span className="text-muted-foreground">Never</span>;
    }
    return (
      <span title={format(apiKey.lastUsedAt, "PPpp")}>
        {formatCompactRelativeTime(apiKey.lastUsedAt, now)}
      </span>
    );
  };

  const scopeSummary = formatApiKeyScopeSummary(apiKey.scope);
  const scopeForEdit = toApiKeyScopeInput(apiKey.scope);

  return (
    <>
      <TableRow>
        <TableCell className="min-w-0 overflow-hidden">
          <div className="flex min-w-0 items-center gap-1.5">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-auto min-w-0 max-w-full cursor-pointer px-0 py-0 text-left font-medium hover:bg-transparent"
                >
                  {/* truncate must live on a child span: text-overflow does not apply inside the button's flex container */}
                  <span className="truncate" title={apiKey.name}>
                    {apiKey.name}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64" align="start">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Created</span>
                    <span>{format(apiKey.createdAt, "MMM d, yyyy")}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Expires</span>
                    <span>{expiresAt === undefined ? "Never" : format(expiresAt, "MMM d, yyyy")}</span>
                  </div>
                  {apiKey.kind === "project-worker" ? (
                    <div className="space-y-1 border-t pt-2">
                      <p className="font-medium">Project worker</p>
                      <p className="break-words">
                        Source: {apiKey.sourceKeyName ?? "Deleted source key"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {workerReason}
                      </p>
                    </div>
                  ) : null}
                  <div className="border-t pt-2">
                    <p className="text-muted-foreground">Scope</p>
                    <p className="mt-1">{scopeSummary}</p>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            {apiKey.scope.kind !== "unscoped" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground"
                    aria-label={scopeSummary}
                  >
                    <Shield className="size-4" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{scopeSummary}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </TableCell>
        <TableCell className="w-40 max-w-40 overflow-hidden">
          <code
            className="block max-w-full truncate text-xs text-muted-foreground"
            title={`${apiKey.keyPrefix}...`}
          >
            {apiKey.keyPrefix}...
          </code>
        </TableCell>
        <TableCell className="w-20">{getExpiresInText()}</TableCell>
        <TableCell className="w-20">{getLastUsedText()}</TableCell>
        <TableCell className="w-10 pr-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label={`${apiKey.name} actions`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {apiKey.kind !== "project-worker" ? (
                <>
                  <DropdownMenuItem onClick={() => setIsEditOpen(true)}>
                    <Pencil className="mr-2 size-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem
                onClick={() => setIsDeleteOpen(true)}
                variant="destructive"
              >
                <Trash2 className="mr-2 size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>

      <DeleteKeyDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        apiKeyId={apiKey._id}
        apiKeyName={apiKey.name}
      />

      <EditKeyDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        apiKeyId={apiKey._id}
        currentName={apiKey.name}
        currentScope={scopeForEdit}
      />
    </>
  );
}
