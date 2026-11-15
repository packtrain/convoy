"use client";

import { useEffect } from "react";
import { useAppUpdateProfileName, useAppUser } from "@/lib/auth/hooks";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { toast } from "sonner";
import { ActionButton } from "@/components/custom/action-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorMessage } from "@/lib/errors";

const profileFormSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(50),
  lastName: z.string().max(50).optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

export function GeneralSection() {
  const { user, isLoaded } = useAppUser();
  const updateProfileName = useAppUpdateProfileName();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
    },
  });

  // Reset form when user data loads
  useEffect(() => {
    if (user) {
      form.reset({
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
      });
    }
  }, [user, form]);

  const onSubmit = async (values: ProfileFormValues) => {
    if (!user) return;

    try {
      await updateProfileName({
        firstName: values.firstName,
        lastName: values.lastName,
      });

      toast.success("Profile updated");
    } catch (error) {
      toast.error(
        getErrorMessage(error, "Failed to update profile")
      );
    }
  };

  const email = user?.email ?? "";

  const header = (
    <div>
      <h2 className="text-lg font-semibold">Profile</h2>
      <p className="text-sm text-muted-foreground">
        Update your personal information.
      </p>
    </div>
  );

  if (!isLoaded) {
    return (
      <div className="space-y-8">
        <div className="space-y-4">
          {header}
          <ProfileFormSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Profile Section */}
      <div className="space-y-4">
        {header}

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* First Name and Last Name on one line */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                {...form.register("firstName")}
                placeholder="John"
              />
              {form.formState.errors.firstName && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.firstName.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                {...form.register("lastName")}
                placeholder="Doe"
              />
              {form.formState.errors.lastName && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.lastName.message}
                </p>
              )}
            </div>
          </div>

          {/* Email (read-only) */}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={email} disabled className="bg-muted/50" />
            <p className="text-sm text-muted-foreground">
              Email changes are managed through your account settings.
            </p>
          </div>

          {/* Save Button */}
          <div className="flex justify-end">
            <ActionButton
              type="submit"
              busy={form.formState.isSubmitting}
              disabled={!form.formState.isDirty}
              showIcon={false}
            >
              Save changes
            </ActionButton>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Profile form placeholder: two name fields, the email field and Save. */
function ProfileFormSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading profile">
      <div className="grid grid-cols-2 gap-4">
        {[0, 1].map((index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-4 w-20 rounded-sm" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-12 rounded-sm" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-72 max-w-full rounded-sm" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-8 w-28" />
      </div>
    </div>
  );
}
