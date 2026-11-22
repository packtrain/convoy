"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { DEFAULT_MIN_PASSWORD_LENGTH } from "@convex-dev/auth/methods/email-password";
import { ActionButton } from "@/components/custom/action-button";
import { HalftoneHero } from "@/components/custom/halftone-hero";
import { LogoText } from "@/components/custom/logo/logo-text";
import { Card, CardContent } from "@/components/ui/card";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type EmailPasswordCredentials = { email: string; password: string };

const PASSWORD_MISMATCH = "Passwords don't match.";

/**
 * Full-page halftone with the wordmark over a card holding the Convex Auth forms. Without `askEmail` or with a null
 * `passwordAutoComplete` that field is left out. A new password also gets a length hint and a confirmation field.
 */
export function EmailPasswordForm({
  title,
  description,
  submitLabel,
  askEmail = true,
  passwordAutoComplete,
  passwordLabelAside,
  otherMethods,
  error,
  pending,
  footer,
  onSubmit,
}: {
  title: string;
  description: string;
  submitLabel: string;
  askEmail?: boolean;
  passwordAutoComplete: "current-password" | "new-password" | null;
  /** Shown to the right of the password label, e.g. a "Forgot password?" link. */
  passwordLabelAside?: ReactNode;
  /** Other sign-in methods, between the heading and the fields. */
  otherMethods?: ReactNode;
  error: string | null;
  pending: boolean;
  footer?: ReactNode;
  onSubmit: (credentials: EmailPasswordCredentials) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const isNewPassword = passwordAutoComplete === "new-password";

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const passwordsDiffer = isNewPassword && confirmation !== password;
    setMismatch(passwordsDiffer);
    if (!passwordsDiffer) onSubmit({ email: email.trim(), password });
  };
  const shownError = mismatch ? PASSWORD_MISMATCH : error;

  return (
    <AuthCardPage>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <AuthCardHeading title={title} description={description} />
        {otherMethods}
        {/* The error sits close under the fields, not a full form gap away. */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-6">
            {askEmail && (
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={pending}
                />
              </div>
            )}
            {passwordAutoComplete && (
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="password">Password</Label>
                  {passwordLabelAside}
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete={passwordAutoComplete}
                  minLength={isNewPassword ? DEFAULT_MIN_PASSWORD_LENGTH : undefined}
                  aria-describedby={isNewPassword ? "password-hint" : undefined}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={pending}
                />
                {isNewPassword && (
                  <FieldDescription id="password-hint">At least {DEFAULT_MIN_PASSWORD_LENGTH} characters.</FieldDescription>
                )}
              </div>
            )}
            {isNewPassword && (
              <div className="grid gap-2">
                <Label htmlFor="password-confirmation">Confirm password</Label>
                <Input
                  id="password-confirmation"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={pending}
                />
              </div>
            )}
          </div>
          {shownError && (
            <p role="alert" className="text-sm text-destructive">
              {shownError}
            </p>
          )}
        </div>
        <ActionButton busy={pending} showIcon={false} className="w-full">
          {submitLabel}
        </ActionButton>
        {footer && <p className="text-center text-sm text-muted-foreground">{footer}</p>}
      </form>
    </AuthCardPage>
  );
}

/** Full-page halftone with the wordmark over a card: the Convex Auth page shell. */
export function AuthCardPage({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-svh w-full items-center justify-center bg-[#08080d] p-6 md:p-10">
      <HalftoneHero />
      <div className="relative flex w-full max-w-sm flex-col items-center gap-6">
        <LogoText className="h-6 w-auto text-[#f2f3f5]" />
        <Card className="w-full py-6">
          <CardContent className="px-6">{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}

export function AuthCardHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description && <p className="text-sm text-balance text-muted-foreground">{description}</p>}
    </div>
  );
}
