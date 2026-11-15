"use client";

import { Trash2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";

import { FormFieldExt } from "@/components/custom/form-field-ext";
import { SettingsPromptEditor, boundedPromptEditorClassName } from "@/components/blocks/settings-catalog/settings-prompt-editor";
import { SettingsActions, SettingsFormGrid, SettingsTwoColumnSection } from "@/components/custom/settings-layout";
import { ColorPicker } from "@/components/custom/color-picker";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_COLOR_PALETTE } from "@/lib/colors/palette";
import { stripTrailingSpaces } from "@/lib/editor/authored-markdown";

export const agentFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().max(500).optional(),
  category: z.string().max(80).optional(),
  prompt: z.string().transform(stripTrailingSpaces),
  appearance: z.object({
    color: z
      .string()
      .min(1, "Color is required")
      .refine((color) => AGENT_COLOR_PALETTE.some((paletteColor) => paletteColor === color), "Choose a supported color"),
  }),
});

export type AgentFormValues = z.infer<typeof agentFormSchema>;

interface AgentFormProps {
  mode: "create" | "edit";
  layout: "settings-page" | "compact";
  initialValues: AgentFormValues;
  canManage: boolean;
  isSubmitting?: boolean;
  onSubmit: (values: AgentFormValues) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  /** Extra fields rendered between Description and Prompt in the compact layout (e.g. project-agent automation), so they stay visible without scrolling. */
  extraCompactFields?: ReactNode;
  /** Extra section rendered between Details and Prompt in the settings-page layout (e.g. project-agent automation). */
  extraSettingsPageSection?: ReactNode;
}

export const EMPTY_AGENT_FORM_VALUES: AgentFormValues = {
  name: "",
  description: "",
  category: "",
  prompt: "",
  appearance: {
    color: AGENT_COLOR_PALETTE[0],
  },
};

export function AgentForm({
  mode,
  layout,
  initialValues,
  canManage,
  isSubmitting = false,
  onSubmit,
  onCancel,
  onDelete,
  extraCompactFields,
  extraSettingsPageSection,
}: AgentFormProps) {
  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: initialValues,
  });

  useEffect(() => {
    form.reset(initialValues);
  }, [form, initialValues]);

  const disabled = !canManage || isSubmitting || form.formState.isSubmitting;

  if (layout === "compact") {
    return (
      <Form {...form}>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <CompactAgentFields form={form} disabled={disabled} extraFields={extraCompactFields} />
          </div>
          <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t-0 bg-background p-4 sm:justify-between">
            {mode === "edit" && onDelete ? (
              <Button type="button" variant="destructive" size="settings" disabled={disabled} onClick={onDelete}>
                <Trash2 className="size-4" />
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="settings" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" size="settings" disabled={disabled}>
                {mode === "create" ? "Create" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </Form>
    );
  }

  return (
    <Form {...form}>
      <form className="flex w-full flex-1 flex-col gap-8" onSubmit={form.handleSubmit(onSubmit)}>
        <SettingsTwoColumnSection title="Details" description="Name the agent and choose how it appears in catalogs and assignee surfaces.">
          <SettingsFormGrid className="sm:grid-cols-12">
            <AgentDetailsFields form={form} disabled={disabled} />
          </SettingsFormGrid>
        </SettingsTwoColumnSection>

        {extraSettingsPageSection}

        <SettingsTwoColumnSection title="Prompt" description="Write the working prompt that will be copied into project agents.">
          <AgentPromptField
            form={form}
            disabled={disabled}
            containerClassName="h-[min(60vh,560px)]"
            editorClassName={boundedPromptEditorClassName}
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

type AgentFormHandle = ReturnType<typeof useForm<AgentFormValues>>;

function AgentDetailsFields({ form, disabled }: { form: AgentFormHandle; disabled: boolean }) {
  return (
    <>
      <AgentNameField form={form} disabled={disabled} className="sm:col-span-7" />

      <FormFieldExt
        control={form.control}
        name="category"
        label="Category"
        className="sm:col-span-4"
        render={({ field }) => <Input {...field} disabled={disabled} value={field.value ?? ""} placeholder="Engineering" />}
      />

      <FormFieldExt
        control={form.control}
        name="description"
        label="Description"
        className="col-span-full"
        render={({ field }) => (
          <Textarea {...field} disabled={disabled} value={field.value ?? ""} placeholder="Reviews code changes and calls out risks." />
        )}
      />
    </>
  );
}

function AgentNameField({ form, disabled, className }: { form: AgentFormHandle; disabled: boolean; className?: string }) {
  return (
    <FormField
      control={form.control}
      name="name"
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>Agent name</FormLabel>
          <div className="flex gap-2">
            <FormField
              control={form.control}
              name="appearance.color"
              render={({ field: colorField }) => (
                <ColorPicker
                  value={colorField.value}
                  onChange={(color) => {
                    if (color) {
                      colorField.onChange(color);
                    }
                  }}
                  allowEmpty={false}
                  palette="extended"
                  columns={8}
                  disabled={disabled}
                  triggerAriaLabel="Select agent color"
                  triggerClassName="shrink-0"
                />
              )}
            />
            <FormControl>
              <Input {...field} disabled={disabled} placeholder="Code Reviewer" />
            </FormControl>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function AgentPromptField({
  form,
  disabled,
  containerClassName,
  editorClassName,
}: {
  form: AgentFormHandle;
  disabled: boolean;
  containerClassName?: string;
  editorClassName?: string;
}) {
  return (
    <FormField
      control={form.control}
      name="prompt"
      render={({ field }) => (
        <FormItem>
          <SettingsPromptEditor
            label="Content"
            value={field.value}
            disabled={disabled}
            onChange={(value) =>
              form.setValue("prompt", value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            className={containerClassName}
            editorClassName={editorClassName}
          />
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function CompactAgentFields({ form, disabled, extraFields }: { form: AgentFormHandle; disabled: boolean; extraFields?: ReactNode }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <AgentNameField form={form} disabled={disabled} />
        <FormFieldExt
          control={form.control}
          name="category"
          label="Category"
          render={({ field }) => <Input {...field} disabled={disabled} value={field.value ?? ""} placeholder="Engineering" />}
        />
      </div>
      <FormFieldExt
        control={form.control}
        name="description"
        label="Description"
        render={({ field }) => (
          <Textarea
            {...field}
            disabled={disabled}
            value={field.value ?? ""}
            placeholder="Reviews code changes and calls out risks."
            className="min-h-20"
          />
        )}
      />
      {extraFields}
      <AgentPromptField form={form} disabled={disabled} containerClassName="h-74" editorClassName={boundedPromptEditorClassName} />
    </div>
  );
}
