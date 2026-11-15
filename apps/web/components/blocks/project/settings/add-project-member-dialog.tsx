"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { toast } from "sonner";
import { ActionButton } from "@/components/custom/action-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Form } from "@/components/ui/form";
import { EmptyMessage } from "@/components/custom/empty-state";
import { FormFieldExt } from "@/components/custom/form-field-ext";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown } from "lucide-react";
import { showConvexErrorToast } from "@/lib/errors";
import { getInitials } from "@/lib/utils";
import { ProjectRoleSelect } from "@/components/blocks/project/project-role-select";
import { ProjectRole } from "@/lib/authz/roles";

const addMemberFormSchema = z.object({
  userId: z.string().min(1, "Please select a member"),
  role: z.enum([ProjectRole.PROJECT_ADMIN, ProjectRole.MEMBER, ProjectRole.VIEWER]),
});

type AddMemberFormValues = z.infer<typeof addMemberFormSchema>;

interface AddProjectMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: Id<"projects">;
  organizationId: Id<"organizations">;
}

export function AddProjectMemberDialog({
  open,
  onOpenChange,
  projectId,
}: AddProjectMemberDialogProps) {
  const eligibleUsers = useQuery(
    api.projects.members.listEligibleToAdd,
    open ? { projectId } : "skip"
  );

  const addMember = useMutation(api.projects.members.add);

  const form = useForm<AddMemberFormValues>({
    resolver: zodResolver(addMemberFormSchema),
    defaultValues: {
      userId: "",
      role: "member",
    },
  });

  const selectedUserId = form.watch("userId");
  const selectedUser = eligibleUsers?.find((u) => u._id === selectedUserId);

  const onSubmit = async (values: AddMemberFormValues) => {
    try {
      await addMember({
        projectId,
        userId: values.userId as Id<"users">,
        role: values.role,
      });
      toast.success("Member added to project");
      handleOpenChange(false);
    } catch (error) {
      showConvexErrorToast(error, "Failed to add member");
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      form.reset();
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add project member</DialogTitle>
          <DialogDescription>
            Add an organization member to this project. They will gain access to
            all tasks in this project.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="space-y-4 py-4">
              {/* User Selection */}
              <FormFieldExt
                control={form.control}
                name="userId"
                label="Member"
                render={({ field }) => (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-between"
                        type="button"
                      >
                        {selectedUser ? (
                          <div className="flex items-center gap-2">
                            <Avatar className="size-5">
                              <AvatarImage src={selectedUser.avatarUrl} />
                              <AvatarFallback className="text-[10px]">
                                {getInitials(selectedUser.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span>{selectedUser.name}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Select a member...</span>
                        )}
                        <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
                      {eligibleUsers === undefined ? (
                        <div aria-label="Loading members">
                          {[0, 1, 2].map((index) => (
                            <div key={index} className="flex items-center px-2 py-1.5">
                              <Skeleton className="mr-2 size-6 rounded-full" />
                              <div className="flex flex-1 flex-col gap-1">
                                <Skeleton className="h-3.5 w-24 rounded-sm" />
                                <Skeleton className="h-3 w-36 rounded-sm" />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : eligibleUsers.length === 0 ? (
                        <EmptyMessage size="compact">
                          No eligible members found.
                        </EmptyMessage>
                      ) : (
                        <div className="max-h-[200px] overflow-y-auto">
                          {eligibleUsers.map((user) => (
                            <DropdownMenuItem
                              key={user._id}
                              onClick={() => field.onChange(user._id)}
                            >
                              <Avatar className="size-6 mr-2">
                                <AvatarImage src={user.avatarUrl} />
                                <AvatarFallback className="text-[10px]">
                                  {getInitials(user.name)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex flex-col">
                                <span>{user.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {user.email}
                                </span>
                              </div>
                            </DropdownMenuItem>
                          ))}
                        </div>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              />

              {/* Role Selection */}
              <FormFieldExt
                control={form.control}
                name="role"
                label="Role"
                render={({ field }) => (
                  <ProjectRoleSelect
                    value={field.value}
                    onValueChange={field.onChange}
                    showDescriptions
                  />
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <ActionButton
                type="submit"
                busy={form.formState.isSubmitting}
                showIcon={false}
              >
                Add member
              </ActionButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
