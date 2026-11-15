"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy, AlertTriangle, X } from "lucide-react";

interface NewKeyDisplayProps {
  apiKey: string;
  onDismiss: () => void;
}

export function NewKeyDisplay({ apiKey, onDismiss }: NewKeyDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-amber-500 bg-amber-50 p-4 dark:bg-amber-950/20">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
        <div className="flex-1 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-amber-900 dark:text-amber-100">
              Save your API key now!
            </h4>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={onDismiss}
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </Button>
          </div>
          <p className="text-sm text-amber-800 dark:text-amber-200">
            This is the only time your API key will be shown. Copy it now and
            store it securely.
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={apiKey}
              className="font-mono text-sm"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopy}
              className="shrink-0"
              aria-label={copied ? "Copied" : "Copy API key"}
            >
              {copied ? (
                <Check className="size-4 text-green-600" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            You won&apos;t be able to see this key again. If you lose it, you&apos;ll
            need to create a new one.
          </p>
        </div>
      </div>
    </div>
  );
}
