import { CircleCheck } from "lucide-react";
import { toast } from "sonner";

import { CircularProgress } from "@/components/ui/circular-progress";

export function showBatchProgressToast({
  toastId,
  completed,
  total,
  label,
}: {
  toastId: string;
  completed: number;
  total: number;
  label: string;
}): void {
  toast(
    <span className="flex items-center gap-2">
      <CircularProgress completed={completed} total={total} className="size-5" />
      <span>
        {label} {completed}/{total}…
      </span>
    </span>,
    { id: toastId, duration: Infinity }
  );
}

export function showBatchDoneToast({
  toastId,
  total,
  label,
  itemLabel,
}: {
  toastId: string;
  total: number;
  label: string;
  itemLabel: string;
}): void {
  toast(
    <span className="flex items-center gap-2">
      <CircleCheck className="size-5 shrink-0 text-emerald-500" />
      <span>
        {label} {total} {itemLabel}
        {total === 1 ? "" : "s"}
      </span>
    </span>,
    { id: toastId }
  );
}
