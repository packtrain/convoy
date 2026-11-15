"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { showConvexErrorToast } from "@/lib/errors";
import type { CheckDefinition } from "./types";

/** Create or edit one catalog Check. The key is fixed once created. */
export function CheckDialog({
  projectId,
  check,
  onClose,
}: {
  projectId: Id<"projects">;
  /** `undefined` creates a new Check. */
  check: CheckDefinition | undefined;
  onClose: () => void;
}) {
  const createCheck = useMutation(api.checks.definitions.create);
  const updateCheck = useMutation(api.checks.definitions.update);
  const [key, setKey] = useState(check?.key ?? "");
  const [label, setLabel] = useState(check?.label ?? "");
  const [instruction, setInstruction] = useState(check?.instruction ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const canSave = key.trim() !== "" && label.trim() !== "" && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      if (check) {
        await updateCheck({ checkId: check._id, label, instruction });
      } else {
        await createCheck({ projectId, key, label, instruction });
      }
      onClose();
    } catch (error) {
      showConvexErrorToast(error, check ? "Failed to update check" : "Failed to create check");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{check ? "Edit check" : "New check"}</DialogTitle>
          <DialogDescription>Agents report a check by its key.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="check-key">Key</Label>
            <Input
              id="check-key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="tests"
              className="font-mono"
              disabled={check !== undefined}
              autoFocus={check === undefined}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="check-label">Label</Label>
            <Input
              id="check-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="All tests pass"
              autoFocus={check !== undefined}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="check-instruction">Instruction (Prompt)</Label>
            <Textarea
              id="check-instruction"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="Run the test suite and attach the output."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="cursor-pointer" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="cursor-pointer" disabled={!canSave}>
              {check ? "Save" : "Create check"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
