"use client";

import { Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";

import { FormFieldExt } from "@/components/custom/form-field-ext";
import { SettingsCatalogNameField } from "@/components/blocks/settings-catalog/settings-catalog-name-field";
import {
  SettingsPromptEditor,
  boundedPromptEditorClassName,
} from "@/components/blocks/settings-catalog/settings-prompt-editor";
import { SettingsActions, SettingsFormGrid, SettingsTwoColumnSection } from "@/components/custom/settings-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { stripTrailingSpaces } from "@/lib/editor/authored-markdown";

export const slashCommandFormSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2, "Key must be at least 2 characters")
    .max(40)
    .regex(/^[a-z0-9:-]+$/, "Key can only contain lowercase letters, numbers, hyphens, and colons"),
  description: z.string().max(500).optional(),
  category: z.string().max(80).optional(),
  autoExpand: z.boolean(),
  autoSubmit: z.boolean(),
  // Strip before validating so a prompt made only of trailing-space escapes is
  // still rejected as empty.
  content: z.string().transform(stripTrailingSpaces).pipe(z.string().trim().min(1, "Content is required").max(100_000)),
});

export type SlashCommandFormValues = z.infer<typeof slashCommandFormSchema>;

interface SlashCommandFormProps {
  mode: "create" | "edit";
  initialValues: SlashCommandFormValues;
  canManage: boolean;
  isSubmitting?: boolean;
  onSubmit: (values: SlashCommandFormValues) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}

export function SlashCommandForm({
  mode,
  initialValues,
  canManage,
  isSubmitting = false,
  onSubmit,
  onCancel,
  onDelete,
}: SlashCommandFormProps) {
  const form = useForm<SlashCommandFormValues>({
    resolver: zodResolver(slashCommandFormSchema),
    defaultValues: initialValues,
  });
  const keyValue = useWatch({ control: form.control, name: "key" });

  useEffect(() => {
    form.reset(initialValues);
  }, [form, initialValues]);

  const disabled = !canManage || isSubmitting || form.formState.isSubmitting;
  const keyError = form.formState.errors.key?.message;

  return (
    <Form {...form}>
      <form className="flex w-full flex-1 flex-col gap-8" onSubmit={form.handleSubmit(onSubmit)}>
        <SettingsTwoColumnSection title="Details" description="Choose the slash command users will type and how it appears in lists.">
          <SettingsFormGrid className="sm:grid-cols-12">
            <SettingsCatalogNameField
              id="slash-command-key"
              label="Command key"
              placeholder="review"
              value={keyValue}
              error={keyError}
              disabled={disabled}
              onBlur={() => form.trigger("key")}
              onValueChange={(value) => form.setValue("key", value, { shouldDirty: true, shouldValidate: true })}
            />

            <FormFieldExt
              control={form.control}
              name="category"
              label="Category"
              className="sm:col-span-4"
              render={({ field }) => <Input {...field} disabled={disabled} value={field.value ?? ""} placeholder="Requirements" />}
            />

            <FormFieldExt
              control={form.control}
              name="description"
              label="Description"
              className="col-span-full"
              render={({ field }) => (
                <Textarea {...field} disabled={disabled} value={field.value ?? ""} placeholder="Short card description" />
              )}
            />

            <FormField
              control={form.control}
              name="autoExpand"
              render={({ field }) => (
                <FormItem className="col-span-full">
                  <label className="flex cursor-pointer items-start gap-3">
                    <FormControl>
                      <Checkbox
                        aria-label="Auto expand"
                        checked={field.value}
                        disabled={disabled}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                        className="mt-0.5"
                      />
                    </FormControl>
                    <span className="grid gap-1">
                      <span className="text-sm font-medium leading-none">Auto expand</span>
                      <span className="text-sm leading-6 text-muted-foreground">
                        Insert the full prompt content when this command is selected.
                      </span>
                    </span>
                  </label>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="autoSubmit"
              render={({ field }) => (
                <FormItem className="col-span-full">
                  <label className="flex cursor-pointer items-start gap-3">
                    <FormControl>
                      <Checkbox
                        aria-label="Autosubmit"
                        checked={field.value}
                        disabled={disabled}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                        className="mt-0.5"
                      />
                    </FormControl>
                    <span className="grid gap-1">
                      <span className="text-sm font-medium leading-none">Autosubmit</span>
                      <span className="text-sm leading-6 text-muted-foreground">
                        Submit when selected in an empty thread composer.
                      </span>
                    </span>
                  </label>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGrid>
        </SettingsTwoColumnSection>

        <SettingsTwoColumnSection title="Prompt" description="Write the markdown content that belongs to this slash command.">
          <FormField
            control={form.control}
            name="content"
            render={({ field }) => (
              <FormItem>
                <SettingsPromptEditor
                  label="Content"
                  value={field.value}
                  disabled={disabled}
                  onChange={(value) =>
                    form.setValue("content", value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  className="h-[420px]"
                  editorClassName={boundedPromptEditorClassName}
                />
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsTwoColumnSection>

        <SettingsActions
          start={
            mode === "edit" && onDelete ? (
              <Button type="button" variant="destructive" disabled={disabled} onClick={onDelete}>
                <Trash2 className="size-4" />
                Delete
              </Button>
            ) : null
          }
        >
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={disabled}>
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </SettingsActions>
      </form>
    </Form>
  );
}
