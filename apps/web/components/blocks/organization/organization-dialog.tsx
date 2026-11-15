"use client";

import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { TitledDialog } from "@/components/ui/dialog";
import { UseDialogReturnWithData } from "@/hooks/ui/use-dialog";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { z } from "zod/v3";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormFieldExt } from "@/components/custom/form-field-ext";
import { ActionButton } from "@/components/custom/action-button";
import { Check, X } from "lucide-react";
import { Spinner } from "@/components/custom/spinner";
import { cn } from "@/lib/utils";
import { getErrorMessage, showConvexErrorToast } from "@/lib/errors";
import { appRoute, useNavigation } from "@/lib/navigation";

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

const formSchema = z.object({
  name: z
    .string()
    .min(2, {
      message: "Name must be at least 2 characters.",
    })
    .refine((val) => val.trim() === val, {
      message: "No leading or trailing spaces allowed.",
    }),
  slug: z
    .string()
    .min(2, {
      message: "Slug must be at least 2 characters.",
    })
    .regex(/^[a-z0-9-]+$/, {
      message: "Slug can only contain lowercase letters, numbers, and hyphens.",
    }),
});

type FormValues = z.infer<typeof formSchema>;

interface OrganizationFormProps {
  onSubmit: (data: FormValues) => void;
  busy: boolean;
  slugAvailability: { available: boolean } | undefined;
  isCheckingSlug: boolean;
}

interface OrganizationFormInternalProps extends OrganizationFormProps {
  onSlugChange: (slug: string) => void;
}

function OrganizationForm({
  onSubmit,
  busy,
  slugAvailability,
  isCheckingSlug,
  onSlugChange,
}: OrganizationFormInternalProps) {
  const [slugDirty, setSlugDirty] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      slug: "",
    },
  });

  const watchedName = useWatch({ control: form.control, name: "name" });
  const watchedSlug = useWatch({ control: form.control, name: "slug" });

  // Auto-update slug from name until user manually edits it
  useEffect(() => {
    if (!slugDirty && watchedName) {
      const newSlug = generateSlug(watchedName);
      form.setValue("slug", newSlug, { shouldValidate: true });
    }
  }, [watchedName, slugDirty, form]);

  // Notify parent of slug changes for availability checking
  useEffect(() => {
    onSlugChange(watchedSlug || "");
  }, [watchedSlug, onSlugChange]);

  const handleSlugChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSlugDirty(true);
      form.setValue("slug", e.target.value, { shouldValidate: true });
    },
    [form]
  );

  const isSlugValid = Boolean(watchedSlug && watchedSlug.length >= 2);
  const showAvailability = isSlugValid && !form.formState.errors.slug;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
        <FormFieldExt
          control={form.control}
          name="name"
          label="Name"
          render={({ field }) => (
            <Input
              placeholder="My organization"
              {...field}
              disabled={busy}
              autoFocus
            />
          )}
        />

        <FormFieldExt
          control={form.control}
          name="slug"
          label="URL slug"
          description="This will be used in your organization URL"
          render={({ field }) => (
            <div className="relative">
              <Input
                placeholder="my-organization"
                {...field}
                onChange={handleSlugChange}
                disabled={busy}
                className={cn(
                  "pr-10",
                  showAvailability &&
                    slugAvailability?.available === false &&
                    "border-destructive focus-visible:ring-destructive"
                )}
              />
              {showAvailability && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isCheckingSlug ? (
                    <Spinner className="size-4 text-muted-foreground" />
                  ) : slugAvailability?.available ? (
                    <Check className="size-4 text-green-500" />
                  ) : (
                    <X className="size-4 text-destructive" />
                  )}
                </div>
              )}
            </div>
          )}
        />

        {showAvailability && slugAvailability?.available === false && (
          <p className="text-sm text-destructive">
            This slug is already taken. Please choose another.
          </p>
        )}

        {watchedSlug && !form.formState.errors.slug && (
          <p className="text-sm text-muted-foreground">
            Your organization URL will be:{" "}
            <span className="font-mono text-foreground">/o/{watchedSlug}/</span>
          </p>
        )}

        <div className="flex justify-end pt-2">
          <ActionButton
            busy={busy}
            disabled={
              busy ||
              isCheckingSlug ||
              (showAvailability && slugAvailability?.available === false)
            }
          >
            Create
          </ActionButton>
        </div>
      </form>
    </Form>
  );
}

export interface OrganizationDialogData {
  // For future edit mode support
  id?: string;
}

interface OrganizationDialogProps {
  dialog: UseDialogReturnWithData<OrganizationDialogData>;
  onSuccess?: (slug: string) => void;
}

export function OrganizationDialog({
  dialog,
  onSuccess,
}: OrganizationDialogProps) {
  const navigation = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slugToCheck, setSlugToCheck] = useState("");

  const createOrganization = useMutation(api.organizations.core.create);

  // Debounce slug checking
  const [debouncedSlug, setDebouncedSlug] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSlug(slugToCheck);
    }, 300);
    return () => clearTimeout(timer);
  }, [slugToCheck]);

  const slugAvailability = useQuery(
    api.organizations.core.checkSlugAvailability,
    debouncedSlug.length >= 2 ? { slug: debouncedSlug } : "skip"
  );

  const isCheckingSlug =
    slugToCheck !== debouncedSlug ||
    (debouncedSlug.length >= 2 && slugAvailability === undefined);

  const handleSlugChange = useCallback((slug: string) => {
    setSlugToCheck(slug);
  }, []);

  const handleSubmit = async (data: FormValues) => {
    setIsSubmitting(true);
    try {
      await createOrganization({
        name: data.name,
        slug: data.slug,
      });
      dialog.close();
      onSuccess?.(data.slug);
      navigation.push(appRoute.organization(data.slug));
    } catch (error) {
      console.error("Failed to create organization:", error);
      showConvexErrorToast(error, "Failed to create organization");
      // Handle slug already taken error from server
      if (getErrorMessage(error, "").includes("slug already taken")) {
        setDebouncedSlug(data.slug); // Trigger re-check
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset state when dialog closes
  useEffect(() => {
    if (!dialog.isOpen) {
      setSlugToCheck("");
      setDebouncedSlug("");
    }
  }, [dialog.isOpen]);

  return (
    <TitledDialog
      title="New organization"
      description="Create a new organization to collaborate with your team."
      size="md"
      {...dialog.props}
    >
      <OrganizationForm
        onSubmit={handleSubmit}
        busy={isSubmitting}
        slugAvailability={slugAvailability}
        isCheckingSlug={isCheckingSlug}
        onSlugChange={handleSlugChange}
      />
    </TitledDialog>
  );
}
