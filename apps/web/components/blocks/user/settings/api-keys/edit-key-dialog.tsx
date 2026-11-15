"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ActionButton } from "@/components/custom/action-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ApiKeyScopePicker,
  type ApiKeyScopeInput,
} from "./api-key-scope-picker";
import { getErrorMessage } from "@/lib/errors";

type EditKeyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKeyId: Id<"apiKeys">;
  currentName: string;
  currentScope: ApiKeyScopeInput;
};

function scopesEqual(left: ApiKeyScopeInput, right: ApiKeyScopeInput) {
  if (!left || !right) {
    return left === right;
  }

  if (left.organizationId !== right.organizationId) {
    return false;
  }

  if (left.projectIds.length !== right.projectIds.length) {
    return false;
  }

  const rightProjectIds = new Set(right.projectIds);
  return left.projectIds.every((projectId) => rightProjectIds.has(projectId));
}

export function EditKeyDialog({
  open,
  onOpenChange,
  apiKeyId,
  currentName,
  currentScope,
}: EditKeyDialogProps) {
  const wasOpenRef = useRef(false);
  const [name, setName] = useState(currentName);
  const [scope, setScope] = useState<ApiKeyScopeInput>(currentScope);
  const [isSaving, setIsSaving] = useState(false);
  const updateApiKey = useMutation(api.apiKeys.core.update);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setName(currentName);
      setScope(currentScope);
    }

    wasOpenRef.current = open;
  }, [currentName, currentScope, open]);

  const initialScope = currentScope;
  const trimmedName = name.trim();
  const hasNameChanged = trimmedName !== currentName;
  const hasScopeChanged = !scopesEqual(scope, initialScope);
  const hasChanges = hasNameChanged || hasScopeChanged;

  const handleSave = async () => {
    if (!trimmedName) {
      toast.error("Name is required");
      return;
    }

    setIsSaving(true);
    try {
      await updateApiKey({ id: apiKeyId, name: trimmedName, scope });

      toast.success("API key updated");
      onOpenChange(false);
    } catch (error) {
      const message =
        getErrorMessage(error, "Failed to update API key");
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit API key</DialogTitle>
          <DialogDescription>
            Update the key name and where it can be used.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`api-key-name-${apiKeyId}`}>Name</Label>
            <Input
              id={`api-key-name-${apiKeyId}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g., Claude Code, CI/CD"
              maxLength={100}
            />
          </div>

          <ApiKeyScopePicker value={scope} onChange={setScope} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <ActionButton
            type="button"
            busy={isSaving}
            disabled={!hasChanges}
            onClick={handleSave}
            showIcon={false}
          >
            Save changes
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
