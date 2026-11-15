"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { toast } from "sonner";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, X } from "lucide-react";
import { ActionButton } from "@/components/custom/action-button";
import { FormFieldExt } from "@/components/custom/form-field-ext";
import {
  SettingsActions,
  SettingsFormGrid,
} from "@/components/custom/settings-layout";
import { Spinner } from "@/components/custom/spinner";
import { useDebounce } from "@/hooks/react/use-debounce";
import { ColorPicker } from "@/components/custom/color-picker";
import { getErrorMessage } from "@/lib/errors";

const generalFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  slug: z
    .string()
    .min(2, "URL must be at least 2 characters")
    .max(50, "URL must be at most 50 characters")
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      "URL must contain only lowercase letters, numbers, and hyphens"
    ),
  color: z.string().nullable(),
});

type GeneralFormValues = z.infer<typeof generalFormSchema>;

interface GeneralSectionProps {
  organization: Doc<"organizations"> | null | undefined;
  onSlugChanged?: (newSlug: string) => void;
}

export function GeneralSection({
  organization,
  onSlugChanged,
}: GeneralSectionProps) {
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false);
  const updateOrganization = useMutation(api.organizations.core.update);

  const form = useForm<GeneralFormValues>({
    resolver: zodResolver(generalFormSchema),
    defaultValues: {
      name: "",
      slug: "",
      color: null,
    },
  });

  const watchedSlug = form.watch("slug");
  const debouncedSlug = useDebounce(watchedSlug, 300);

  // Check slug availability
  const slugAvailability = useQuery(
    api.organizations.core.checkSlugAvailability,
    debouncedSlug && debouncedSlug !== organization?.slug
      ? { slug: debouncedSlug }
      : "skip"
  );

  // Reset form when organization changes
  useEffect(() => {
    if (organization) {
      form.reset({
        name: organization.name,
        slug: organization.slug,
        color: organization.color ?? null,
      });
      setIsSlugManuallyEdited(false);
    }
  }, [organization, form]);

  // Auto-generate slug from name (unless manually edited)
  const watchedName = form.watch("name");
  useEffect(() => {
    if (!isSlugManuallyEdited && watchedName && !organization) {
      const generatedSlug = watchedName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      form.setValue("slug", generatedSlug);
    }
  }, [watchedName, isSlugManuallyEdited, form, organization]);

  const onSubmit = async (values: GeneralFormValues) => {
    if (!organization) return;

    try {
      const slugChanged = values.slug !== organization.slug;

      await updateOrganization({
        id: organization._id,
        name: values.name,
        slug: values.slug,
        color: values.color,
      });

      toast.success("Organization settings saved");

      if (slugChanged && onSlugChanged) {
        onSlugChanged(values.slug);
      }
    } catch (error) {
      toast.error(
        getErrorMessage(error, "Failed to save settings")
      );
    }
  };

  const isDirty =
    form.formState.isDirty ||
    form.getValues("name") !== organization?.name ||
    form.getValues("slug") !== organization?.slug ||
    form.getValues("color") !== (organization?.color ?? null);

  const isSlugValid =
    !debouncedSlug ||
    debouncedSlug === organization?.slug ||
    slugAvailability?.available;

  const isSlugChecking =
    debouncedSlug &&
    debouncedSlug !== organization?.slug &&
    slugAvailability === undefined;

  if (!organization) {
    return <GeneralFormSkeleton />;
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <SettingsFormGrid className="max-w-none">
          <div className="col-span-full grid gap-2">
            <Label htmlFor="organization-name">Organization name</Label>
            <div className="flex gap-2">
              <ColorPicker
                value={form.watch("color")}
                onChange={(c) => form.setValue("color", c, { shouldDirty: true })}
                disabled={form.formState.isSubmitting}
              />
              <FormFieldExt
                control={form.control}
                name="name"
                className="flex-1"
                render={({ field }) => (
                  <Input id="organization-name" placeholder="My organization" {...field} />
                )}
              />
            </div>
          </div>

          {/* Plain FormField: FormControl must sit on the input, not the group. */}
          <FormField
            control={form.control}
            name="slug"
            render={({ field }) => (
              <FormItem className="col-span-full">
                <FormLabel>Organization URL</FormLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>/o/</InputGroupText>
                  </InputGroupAddon>
                  <FormControl>
                    <InputGroupInput
                      placeholder="my-organization"
                      {...field}
                      onChange={(e) => {
                        setIsSlugManuallyEdited(true);
                        field.onChange(e.target.value.toLowerCase());
                      }}
                    />
                  </FormControl>
                  <InputGroupAddon align="inline-end">
                    <span role="status" className="flex items-center">
                      {isSlugChecking ? (
                        <>
                          <Spinner className="size-4 text-muted-foreground" />
                          <span className="sr-only">Checking URL</span>
                        </>
                      ) : debouncedSlug && debouncedSlug !== organization.slug ? (
                        slugAvailability?.available ? (
                          <>
                            <Check className="size-4 text-success" aria-hidden />
                            <span className="sr-only">URL available</span>
                          </>
                        ) : (
                          <>
                            <X className="size-4 text-destructive" aria-hidden />
                            <span className="sr-only">URL taken</span>
                          </>
                        )
                      ) : null}
                    </span>
                  </InputGroupAddon>
                </InputGroup>
                <FormMessage />
                {!isSlugValid && !form.formState.errors.slug && (
                  <p className="text-sm text-destructive">This URL is already taken</p>
                )}
                {form.getValues("slug") !== organization.slug && (
                  <p className="text-sm text-muted-foreground">
                    Changing the URL will redirect you to the new address.
                  </p>
                )}
              </FormItem>
            )}
          />
        </SettingsFormGrid>

        <SettingsActions>
          <ActionButton
            type="submit"
            busy={form.formState.isSubmitting}
            disabled={!isDirty || !isSlugValid || Boolean(isSlugChecking)}
            showIcon={false}
          >
            Save changes
          </ActionButton>
        </SettingsActions>
      </form>
    </Form>
  );
}

/** Form placeholder: the name row with its color swatch, the URL row and Save. */
function GeneralFormSkeleton() {
  return (
    <div className="space-y-8" aria-label="Loading organization settings">
      <div className="space-y-8">
        <div className="grid gap-2">
          <Skeleton className="h-4 w-32 rounded-sm" />
          <div className="flex gap-2">
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="h-8 flex-1" />
          </div>
        </div>
        <div className="grid gap-2">
          <Skeleton className="h-4 w-28 rounded-sm" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-8 w-28" />
      </div>
    </div>
  );
}
