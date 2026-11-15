import { WifiOff } from "lucide-react";

/**
 * Sits above the composer while the thread's CLI profile is offline (OS-2256).
 * `undefined` is a loading profile, which is no evidence the CLI is gone.
 */
export function ThreadCliOfflineBanner({
  isOnline,
  className,
}: {
  isOnline: boolean | undefined;
  className?: string;
}) {
  if (isOnline !== false) {
    return null;
  }

  return (
    <div className={className}>
      <div
        role="status"
        className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-foreground"
      >
        <WifiOff aria-hidden="true" className="size-4 shrink-0" />
        <span>CLI offline. Messages will queue until it reconnects.</span>
      </div>
    </div>
  );
}
