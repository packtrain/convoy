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
 * Full-page halftone with the wordmark over a card holding an email and password form, shared by the Convex Auth sign-in
 * and sign-up screens. A new password also gets a length hint and a confirmation field.
 */
export function EmailPasswordForm({
  title,
  description,
  submitLabel,
  passwordAutoComplete,
  error,
  pending,
  footer,
  onSubmit,
}: {
  title: string;
  description: string;
  submitLabel: string;
  passwordAutoComplete: "current-password" | "new-password";
  error: string | null;
  pending: boolean;
  footer: ReactNode;
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
    <div className="relative flex min-h-svh w-full items-center justify-center bg-[#08080d] p-6 md:p-10">
      <HalftoneHero />
      <div className="relative flex w-full max-w-sm flex-col items-center gap-6">
        <LogoText className="h-6 w-auto text-[#f2f3f5]" />
        <Card className="w-full py-6">
          <CardContent className="px-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div className="flex flex-col items-center gap-1 text-center">
                <h1 className="text-2xl font-semibold">{title}</h1>
                <p className="text-sm text-balance text-muted-foreground">{description}</p>
              </div>
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
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
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
                  <FieldDescription id="password-hint">
                    At least {DEFAULT_MIN_PASSWORD_LENGTH} characters.
                  </FieldDescription>
                )}
              </div>
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
              {shownError && (
                <p role="alert" className="text-sm text-destructive">
                  {shownError}
                </p>
              )}
              <ActionButton busy={pending} showIcon={false} className="w-full">
                {submitLabel}
              </ActionButton>
              <p className="text-center text-sm text-muted-foreground">{footer}</p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
