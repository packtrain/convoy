"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { addDays, format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { FormFieldExt } from "@/components/custom/form-field-ext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ApiKeyScopePicker,
  type ApiKeyScopeInput,
} from "./api-key-scope-picker";
import { getErrorMessage } from "@/lib/errors";

const formSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or less"),
  expiration: z.enum(["30d", "90d", "180d", "365d", "custom", "never"]),
  customDate: z.date().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface CreateApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onKeyCreated: (key: string) => void;
}

export function CreateApiKeyDialog({
  open,
  onOpenChange,
  onKeyCreated,
}: CreateApiKeyDialogProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [scope, setScope] = useState<ApiKeyScopeInput>(null);
  const createKey = useMutation(api.apiKeys.core.create);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      expiration: "90d",
    },
  });

  const expiration = form.watch("expiration");

  const getExpirationDate = (values: FormValues): Date | undefined => {
    const now = new Date();
    switch (values.expiration) {
      case "30d":
        return addDays(now, 30);
      case "90d":
        return addDays(now, 90);
      case "180d":
        return addDays(now, 180);
      case "365d":
        return addDays(now, 365);
      case "custom":
        return values.customDate || addDays(now, 90);
      case "never":
        return undefined;
    }
  };

  const onSubmit = async (values: FormValues) => {
    setIsCreating(true);
    try {
      const expiresAt = getExpirationDate(values)?.getTime();
      const result = await createKey({
        name: values.name,
        expiresAt,
        scope,
      });
      onKeyCreated(result.key);
      form.reset();
      setScope(null);
    } catch (error) {
      const message = getErrorMessage(error, "Failed to create API key");
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  };

  const maxDate = addDays(new Date(), 365);
  const minDate = new Date();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>
            Create a new API key for MCP access. The key will only be shown once.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormFieldExt
              control={form.control}
              name="name"
              label="Name"
              description="A name to identify this key"
              render={({ field }) => (
                <Input placeholder="e.g., Claude Code, CI/CD" {...field} />
              )}
            />

            <FormFieldExt
              control={form.control}
              name="expiration"
              label="Expiration"
              render={({ field }) => (
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select expiration" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30d">30 days</SelectItem>
                    <SelectItem value="90d">90 days</SelectItem>
                    <SelectItem value="180d">180 days</SelectItem>
                    <SelectItem value="365d">1 year</SelectItem>
                    <SelectItem value="custom">Custom date</SelectItem>
                    <SelectItem value="never">No expiration</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />

            {expiration === "custom" && (
              <FormFieldExt
                control={form.control}
                name="customDate"
                className="flex flex-col"
                label="Custom expiration date"
                description="Maximum 1 year from today"
                render={({ field }) => (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full pl-3 text-left font-normal",
                          !field.value && "text-muted-foreground"
                        )}
                      >
                        {field.value ? (
                          format(field.value, "PPP")
                        ) : (
                          <span>Pick a date</span>
                        )}
                        <CalendarIcon className="ml-auto size-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) =>
                          date < minDate || date > maxDate
                        }
                      />
                    </PopoverContent>
                  </Popover>
                )}
              />
            )}

            <ApiKeyScopePicker value={scope} onChange={setScope} />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating}>
                {isCreating ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
