"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id, Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { SettingsDangerRow } from "@/components/custom/settings-layout";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { LogOut, Trash2 } from "lucide-react";
import { appRoute, useNavigation } from "@/lib/navigation";
import { getErrorMessage } from "@/lib/errors";

interface DangerSectionProps {
  organizationId: Id<"organizations">;
  organization: Doc<"organizations"> | null | undefined;
  onOrganizationLeft: () => void;
}

export function DangerSection({
  organizationId,
  organization,
  onOrganizationLeft,
}: DangerSectionProps) {
  const navigation = useNavigation();
  const leaveOrganization = useMutation(api.organizations.members.leave);
  const myRole = useQuery(api.organizations.members.getMyRole, { organizationId });

  const handleLeave = async () => {
    try {
      await leaveOrganization({ organizationId });
      toast.success("You have left the organization");
      onOrganizationLeft();
      navigation.push(appRoute.organizations());
    } catch (error) {
      toast.error(
        getErrorMessage(error, "Failed to leave organization")
      );
    }
  };

  return (
    <div className="space-y-6">
      <SettingsDangerRow
        icon={<LogOut />}
        title="Leave organization"
        description="You will lose access to all projects in this organization."
        action={
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                Leave
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave organization?</AlertDialogTitle>
                <AlertDialogDescription>
                  You will be removed from {organization?.name || "this organization"} and lose access to all its projects.
                  {myRole === "owner" && (
                    <span className="block mt-2 text-destructive">
                      Warning: As an owner, you can only leave if there is another owner.
                    </span>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleLeave}
                  variant="destructive"
                >
                  Leave organization
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
      />

      {/* Delete Organization (Owner only) */}
      {myRole === "owner" && (
        <SettingsDangerRow
          icon={<Trash2 />}
          title="Delete organization"
          description="Permanently delete this organization and all its data."
          action={
            <Button variant="destructive" size="sm" disabled>
              Delete
            </Button>
          }
          disabledReason="Organization deletion will be available in a future update."
        />
      )}
    </div>
  );
}
