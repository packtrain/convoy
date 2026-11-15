"use client";

import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { TitledDialog } from "@/components/ui/dialog";
import { UseDialogReturnWithData } from "@/hooks/ui/use-dialog";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { z } from "zod/v3";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormFieldExt } from "@/components/custom/form-field-ext";
import { ActionButton } from "@/components/custom/action-button";
import { showConvexErrorToast } from "@/lib/errors";
import { generateAliasFromName } from "./project-alias";

const formSchema = z.object({
  name: z
    .string()
    .min(2, {
      message: "Name must be at least 2 characters.",
    })
    .refine((val) => val.trim() === val, {
      message: "No leading or trailing spaces allowed.",
    }),
  alias: z
    .string()
    .min(2, { message: "Project key must be at least 2 characters." })
    .max(5, { message: "Project key must be at most 5 characters." })
    .regex(/^[A-Z][A-Z0-9]{1,4}$/, {
      message: "Must start with a letter, uppercase letters and numbers only.",
    }),
  description: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface ProjectFormProps {
  onSubmit: (data: FormValues) => void;
  busy: boolean;
}

function ProjectForm({ onSubmit, busy }: ProjectFormProps) {
  const [aliasManuallyEdited, setAliasManuallyEdited] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      alias: "",
      description: "",
    },
  });

  // Auto-generate alias from name when name changes (only if alias hasn't been manually edited)
  const watchedName = form.watch("name");
  useEffect(() => {
    if (!aliasManuallyEdited) {
      const suggestedAlias = generateAliasFromName(watchedName);
      if (suggestedAlias) {
        form.setValue("alias", suggestedAlias);
      }
    }
  }, [watchedName, aliasManuallyEdited, form]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
        <FormFieldExt
          control={form.control}
          name="name"
          label="Name"
          render={({ field }) => (
            <Input placeholder="My project" {...field} disabled={busy} autoFocus />
          )}
        />
        <FormFieldExt
          control={form.control}
          name="alias"
          label="Project key"
          description="Short identifier for task IDs (e.g., ABC-1, ABC-2)"
          render={({ field }) => (
            <Input
              placeholder="ABC"
              {...field}
              disabled={busy}
              onChange={(e) => {
                const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                field.onChange(value);
                setAliasManuallyEdited(true);
              }}
              maxLength={5}
            />
          )}
        />
        <FormFieldExt
          control={form.control}
          name="description"
          label="Description"
          render={({ field }) => (
            <Textarea placeholder="Optional description..." {...field} disabled={busy} />
          )}
        />
        <div className="flex justify-end pt-2">
          <ActionButton busy={busy}>Create</ActionButton>
        </div>
      </form>
    </Form>
  );
}

// Empty object type - dialog data not needed for create-only mode
export type ProjectDialogData = Record<string, never>;

interface ProjectDialogProps {
  organizationId: string;
  dialog: UseDialogReturnWithData<ProjectDialogData>;
  onSuccess?: () => void;
}

export function ProjectDialog({ organizationId, dialog, onSuccess }: ProjectDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createProject = useMutation(api.projects.core.create);

  const handleSubmit = async (data: FormValues) => {
    setIsSubmitting(true);
    try {
      await createProject({
        organizationId: organizationId as Id<"organizations">,
        name: data.name,
        alias: data.alias,
        description: data.description?.trim() || undefined,
      });
      dialog.close();
      onSuccess?.();
    } catch (error) {
      console.error("Failed to create project:", error);
      showConvexErrorToast(error, "Failed to create project");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TitledDialog
      title="New project"
      description="Create a new project to organize your tasks."
      size="md"
      {...dialog.props}
    >
      <ProjectForm onSubmit={handleSubmit} busy={isSubmitting} />
    </TitledDialog>
  );
}
