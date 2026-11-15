import React from "react";
import { ControllerFieldState, ControllerRenderProps, UseControllerProps, UseFormStateReturn, Path } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { cn } from "@/lib/utils";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface FormFieldExtProps<TFieldValues extends Record<string, any> = Record<string, any>, TName extends Path<TFieldValues> = Path<TFieldValues>> extends UseControllerProps<
  TFieldValues,
  TName
> {
  className?: string;
  labelClassName?: string;
  label?: string;
  help?: string;
  isCheckbox?: boolean;
  description?: string;
  descriptionBelowLabel?: boolean;
  headerControl?: React.ReactNode;
  render?: ({
    field,
    fieldState,
    formState,
  }: {
    field: ControllerRenderProps<TFieldValues, TName>;
    fieldState: ControllerFieldState;
    formState: UseFormStateReturn<TFieldValues>;
  }) => React.ReactElement;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function FormFieldExt<TFieldValues extends Record<string, any> = Record<string, any>, TName extends Path<TFieldValues> = Path<TFieldValues>>({
  className,
  labelClassName,
  control,
  name,
  label,
  help,
  isCheckbox = false,
  description,
  descriptionBelowLabel = false,
  headerControl,
  render,
  ...props
}: FormFieldExtProps<TFieldValues, TName>) {
  return (
    <FormField<TFieldValues, TName>
      control={control}
      name={name}
      render={({ field, fieldState, formState }) => (
        <FormItem className={className}>
          {isCheckbox && <FormControl>{render?.({ field, fieldState, formState })}</FormControl>}
          {headerControl && headerControl}
          {!headerControl && (
            <>
              {label && <FormLabel className={labelClassName}>{label} <FormFieldHelp help={help} /></FormLabel>}
              {description && (!label || descriptionBelowLabel) && <FormDescription className="mb-0">{description}</FormDescription>}
            </>
          )}
          {/* {!isCheckbox && <br />} */}
          {!isCheckbox && <FormControl>{render?.({ field, fieldState, formState })}</FormControl>}
          {description && label && !descriptionBelowLabel && <FormDescription className="mb-0">{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
      {...props}
    />
  );
}

export function FormFieldsInline({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex gap-5 items-start", className)}>{children}</div>;
}

export function FormFieldHelp({ help }: { help?: string }) {
  if (!help) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="size-3.5 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent>{help}</TooltipContent>
    </Tooltip>
  );
}
