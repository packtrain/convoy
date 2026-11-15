"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useRef, type ClipboardEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";

import { SkillFileList } from "./skill-file-list";
import { parseSkillSourceUrl } from "./skill-source";
import { FormFieldExt } from "@/components/custom/form-field-ext";
import { SettingsCatalogNameField } from "@/components/blocks/settings-catalog/settings-catalog-name-field";
import { SettingsPromptEditor, boundedPromptEditorClassName } from "@/components/blocks/settings-catalog/settings-prompt-editor";
import { SettingsActions, SettingsFormGrid, SettingsTwoColumnSection } from "@/components/custom/settings-layout";
import { Button } from "@/components/ui/button";
import { Form, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { stripTrailingSpaces } from "@/lib/editor/authored-markdown";

const SKILL_COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/i;

/**
 * Every field is optional, in any combination — partial provenance beats none. What
 * is typed still has to be usable, so the form carries the backend's formats
 * (docs/specs/skills.md#git-sources): a commit that is not a commit records the
 * wrong answer to "which version is this".
 */
const skillSourceFormSchema = z.object({
  repoUrl: z.string().trim().max(500, "Repository URL must be 500 characters or less").optional(),
  commitSha: z
    .string()
    .trim()
    .refine((value) => !value || SKILL_COMMIT_SHA_PATTERN.test(value), "Commit must be 7 to 64 hex characters")
    .optional(),
  ref: z.string().trim().max(200, "Ref must be 200 characters or less").optional(),
  subpath: z.string().trim().max(200, "Subpath must be 200 characters or less").optional(),
});

const skillFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(64)
    .regex(
      /^[a-z0-9-]+(?::[a-z0-9-]+)?$/,
      "Name can only contain lowercase letters, numbers, and hyphens, with at most one `namespace:` prefix"
    ),
  description: z.string().max(500).optional(),
  category: z.string().max(80).optional(),
  // Strip before validating so content made only of trailing-space escapes is
  // still rejected as empty.
  content: z.string().transform(stripTrailingSpaces).pipe(z.string().trim().min(1, "SKILL.md content is required")),
  // The additional files, edited as a draft and saved with the rest of the form.
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  source: skillSourceFormSchema.optional(),
});

const EMPTY_SOURCE_FIELDS = { repoUrl: "", commitSha: "", ref: "", subpath: "" };

export type SkillFormValues = z.infer<typeof skillFormSchema>;

export function SkillForm({
  mode,
  resetKey,
  initialValues,
  canManage,
  isSubmitting = false,
  onSubmit,
  onCancel,
  onDelete,
}: {
  mode: "create" | "edit";
  /** Identity the form is seeded from — a change re-seeds, a re-emit does not. */
  resetKey: string;
  initialValues: SkillFormValues;
  canManage: boolean;
  isSubmitting?: boolean;
  onSubmit: (values: SkillFormValues) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const form = useForm<SkillFormValues>({
    resolver: zodResolver(skillFormSchema),
    // The metadata inputs are controlled, so they always need a string to hold.
    defaultValues: { ...initialValues, source: { ...EMPTY_SOURCE_FIELDS, ...initialValues.source } },
    // Blur, not change: "pdf" is invalid after its first keystroke. Once an error
    // is showing, revalidate per keystroke so it clears as soon as it is fixed.
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const nameValue = useWatch({ control: form.control, name: "name" });
  const files = useWatch({ control: form.control, name: "files" });
  const seededKey = useRef<string | null>(null);

  // Reset only when a different Skill seeds the form: the skill query can
  // re-emit while the page is open — a save in another tab, an unrelated column
  // patch — and a blind reset would discard unsaved work.
  useEffect(() => {
    if (seededKey.current === resetKey) {
      return;
    }

    seededKey.current = resetKey;
    form.reset({ ...initialValues, source: { ...EMPTY_SOURCE_FIELDS, ...initialValues.source } });
  }, [form, initialValues, resetKey]);

  const disabled = !canManage || isSubmitting || form.formState.isSubmitting;

  /**
   * A pasted GitHub URL fills the whole section; anything else pastes as itself, so
   * an unparseable URL still lands in the field.
   */
  function handleSourcePaste(event: ClipboardEvent<HTMLInputElement>) {
    const parsed = parseSkillSourceUrl(event.clipboardData.getData("text"));
    if (!parsed) {
      return;
    }

    event.preventDefault();
    const options = { shouldDirty: true, shouldValidate: true };
    form.setValue("source.repoUrl", parsed.repoUrl, options);
    // A plain repository URL leaves the rest as typed: it says nothing about them.
    if (parsed.ref !== undefined || parsed.commitSha !== undefined) {
      form.setValue("source.ref", parsed.ref ?? "", options);
      form.setValue("source.commitSha", parsed.commitSha ?? "", options);
      form.setValue("source.subpath", parsed.subpath ?? "", options);
    }
  }
  const nameError = form.formState.errors.name?.message;

  return (
    <Form {...form}>
      <form className="flex w-full flex-1 flex-col gap-8" onSubmit={form.handleSubmit(onSubmit)}>
        <SettingsTwoColumnSection title="Details" description="The name and description agents see. Skills are mentioned as /name.">
          <SettingsFormGrid className="sm:grid-cols-12">
            {/* `/` addon: a Skill is mentioned as `/name` in the thread composer. */}
            <SettingsCatalogNameField
              id="skill-name"
              label="Name"
              placeholder="pdf-tools"
              value={nameValue}
              error={nameError}
              disabled={disabled}
              onBlur={() => form.trigger("name")}
              onValueChange={(value) =>
                form.setValue("name", value, {
                  shouldDirty: true,
                  // Hand-rolled field, so `reValidateMode` never fires: validate per
                  // keystroke only while an error is on screen, so it clears itself.
                  shouldValidate: Boolean(nameError),
                })
              }
            />

            <FormFieldExt
              control={form.control}
              name="category"
              label="Category"
              // self-start: a name validation error grows the row, and a stretched
              // field would center its label against the taller neighbour.
              className="self-start sm:col-span-4"
              render={({ field }) => <Input {...field} disabled={disabled} value={field.value ?? ""} placeholder="Documents" />}
            />

            <FormFieldExt
              control={form.control}
              name="description"
              label="Description"
              className="col-span-full"
              render={({ field }) => (
                <Textarea {...field} disabled={disabled} value={field.value ?? ""} placeholder="When an agent should use this skill" />
              )}
            />
          </SettingsFormGrid>
        </SettingsTwoColumnSection>

        <SettingsTwoColumnSection title="SKILL.md" description="The entry point an agent reads first.">
          <FormField
            control={form.control}
            name="content"
            render={({ field }) => (
              <FormItem>
                <SettingsPromptEditor
                  label="Content"
                  value={field.value}
                  disabled={disabled}
                  onChange={(value) => form.setValue("content", value, { shouldDirty: true })}
                  className="h-[420px]"
                  editorClassName={boundedPromptEditorClassName}
                />
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsTwoColumnSection>

        <SkillFileList files={files ?? []} disabled={disabled} onChange={(next) => form.setValue("files", next, { shouldDirty: true })} />

        <SettingsTwoColumnSection
          title="Metadata"
          description="Where you copied this skill from. Paste a GitHub URL to fill it in."
          data-testid="skill-source"
        >
          <SettingsFormGrid className="sm:grid-cols-12">
            <FormFieldExt
              control={form.control}
              name="source.repoUrl"
              label="Repository URL"
              className="self-start sm:col-span-7"
              render={({ field }) => (
                <Input
                  {...field}
                  disabled={disabled}
                  value={field.value ?? ""}
                  placeholder="https://github.com/owner/repo"
                  onPaste={handleSourcePaste}
                />
              )}
            />

            <FormFieldExt
              control={form.control}
              name="source.subpath"
              label="Subpath"
              className="self-start sm:col-span-5"
              render={({ field }) => <Input {...field} disabled={disabled} value={field.value ?? ""} placeholder="skills/pdf-tools" />}
            />

            <FormFieldExt
              control={form.control}
              name="source.ref"
              label="Ref"
              className="self-start sm:col-span-4"
              render={({ field }) => <Input {...field} disabled={disabled} value={field.value ?? ""} placeholder="main" />}
            />

            <FormFieldExt
              control={form.control}
              name="source.commitSha"
              label="Commit"
              className="self-start sm:col-span-8"
              render={({ field }) => <Input {...field} disabled={disabled} value={field.value ?? ""} placeholder="0f1e2d3" />}
            />
          </SettingsFormGrid>
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
