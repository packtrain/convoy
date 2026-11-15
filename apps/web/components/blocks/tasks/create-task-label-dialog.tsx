"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/custom/color-picker";
import { DEFAULT_LABEL_COLOR, MAX_LABELS_PER_PROJECT } from "@/lib/tasks/constants";
import { showConvexErrorToast } from "@/lib/errors";

interface CreateTaskLabelDialogProps {
  projectId: Id<"projects">;
  label?: {
    _id: Id<"projectLabels">;
    name: string;
    color: string;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  labelCount?: number;
  onCreated?: (labelId: Id<"projectLabels">) => void;
}

export function CreateTaskLabelDialog({
  projectId,
  label = null,
  open,
  onOpenChange,
  initialName = "",
  labelCount = 0,
  onCreated,
}: CreateTaskLabelDialogProps) {
  const createLabel = useMutation(api.tasks.labels.create);
  const updateLabel = useMutation(api.tasks.labels.update);
  const isEditing = label !== null;
  const [name, setName] = useState(label?.name ?? initialName);
  const [color, setColor] = useState<string | null>(label?.color ?? DEFAULT_LABEL_COLOR);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const capReached = !isEditing && labelCount >= MAX_LABELS_PER_PROJECT;
  const trimmedName = name.trim();

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(label?.name ?? initialName);
    setColor(label?.color ?? DEFAULT_LABEL_COLOR);
    setIsSubmitting(false);
  }, [initialName, label, open]);

  const handleSubmit = async () => {
    if (!trimmedName || capReached || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      if (label) {
        await updateLabel({
          labelId: label._id,
          name: trimmedName,
          color: color ?? DEFAULT_LABEL_COLOR,
        });
        onOpenChange(false);
        return;
      }

      const labelId = await createLabel({
        projectId,
        name: trimmedName,
        color: color ?? DEFAULT_LABEL_COLOR,
      });
      onCreated?.(labelId);
      onOpenChange(false);
    } catch (error) {
      showConvexErrorToast(error, isEditing ? "Failed to update label" : "Failed to create label");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit label" : "New label"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="task-label-name">Label</Label>
          <div className="flex gap-2">
            <ColorPicker
              value={color}
              onChange={setColor}
              allowEmpty={false}
              palette="extended"
              columns={8}
              triggerAriaLabel="Label color"
              triggerClassName="shrink-0"
            />
            <Input
              id="task-label-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="Label name"
              autoFocus
            />
          </div>
          {capReached && (
            <p className="text-xs text-muted-foreground">
              {MAX_LABELS_PER_PROJECT} of {MAX_LABELS_PER_PROJECT} labels used.
              Delete a label to create another.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="cursor-pointer"
            disabled={!trimmedName || capReached || isSubmitting}
            onClick={() => void handleSubmit()}
          >
            {!isEditing && <Plus className="size-4" />}
            {isEditing ? "Save" : "Create label"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
