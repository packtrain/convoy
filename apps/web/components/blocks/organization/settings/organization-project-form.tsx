"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";

import { ColorPicker } from "@/components/custom/color-picker";
import { FormFieldExt } from "@/components/custom/form-field-ext";
import {
  SettingsFormGrid,
  SettingsTwoColumnSection,
} from "@/components/custom/settings-layout";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const organizationProjectFormSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .refine((value) => value.trim() === value, {
      message: "No leading or trailing spaces allowed.",
    }),
  alias: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{1,4}$/, "Must be 2-5 characters, start with a letter, uppercase only."),
  description: z.string().optional(),
  color: z.string().nullable(),
});

export type OrganizationProjectFormValues = z.infer<typeof organizationProjectFormSchema>;

export function normalizeAliasInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

interface OrganizationProjectFormProps {
  initialValues: OrganizationProjectFormValues;
  isSubmitting?: boolean;
  onSubmit: (values: OrganizationProjectFormValues) => Promise<void>;
}

export function OrganizationProjectForm({
  initialValues,
  isSubmitting = false,
  onSubmit,
}: OrganizationProjectFormProps) {
  const form = useForm<OrganizationProjectFormValues>({
    resolver: zodResolver(organizationProjectFormSchema),
    defaultValues: initialValues,
  });

  useEffect(() => {
    form.reset(initialValues);
  }, [form, initialValues]);

  const disabled = isSubmitting || form.formState.isSubmitting;
  const alias = form.watch("alias");
  const color = form.watch("color");

  return (
    <Form {...form}>
      {/* No `flex-1`: this form sits above other sections, so stretching it to
          fill the page would open a gap between it and what follows. */}
      <form className="w-full" onSubmit={form.handleSubmit(onSubmit)}>
        {/* Keeps its default bottom border: it separates Details from Members. */}
        <SettingsTwoColumnSection
          title="Details"
          description="Name this project and choose how it appears in navigation."
        >
          <SettingsFormGrid className="sm:grid-cols-12">
            <div className="grid gap-2 self-start sm:col-span-8">
              <Label htmlFor="organization-project-name">Project name</Label>
              <div className="flex gap-2">
                <ColorPicker
                  value={color}
                  onChange={(next) =>
                    form.setValue("color", next, { shouldDirty: true })
                  }
                  disabled={disabled}
                />
                <FormFieldExt
                  control={form.control}
                  name="name"
                  className="flex-1"
                  render={({ field }) => (
                    <Input
                      id="organization-project-name"
                      placeholder="Website Redesign"
                      disabled={disabled}
                      {...field}
                    />
                  )}
                />
              </div>
            </div>

            <FormFieldExt
              control={form.control}
              name="alias"
              label="Project key"
              className="sm:col-span-4"
              render={({ field }) => (
                <Input
                  placeholder="ABC"
                  maxLength={5}
                  className="font-mono uppercase"
                  disabled={disabled}
                  {...field}
                  onChange={(event) =>
                    form.setValue("alias", normalizeAliasInput(event.target.value), {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
              )}
            />

            <FormFieldExt
              control={form.control}
              name="description"
              label="Description"
              className="col-span-full"
              render={({ field }) => (
                <Textarea
                  placeholder="What is this project about?"
                  rows={3}
                  disabled={disabled}
                  {...field}
                  value={field.value ?? ""}
                />
              )}
            />

            <p className="col-span-full text-sm text-muted-foreground">
              Task IDs will look like{" "}
              <span className="font-mono font-medium text-foreground">
                {alias || "ABC"}-123
              </span>
              . Changing the project key affects all existing task references.
            </p>

            <div className="col-span-full flex justify-end">
              <Button type="submit" disabled={disabled || !form.formState.isDirty}>
                Save
              </Button>
            </div>
          </SettingsFormGrid>
        </SettingsTwoColumnSection>
      </form>
    </Form>
  );
}
