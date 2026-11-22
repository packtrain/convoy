"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { DEFAULT_MIN_PASSWORD_LENGTH } from "@convex-dev/auth/methods/email-password";
import { ActionButton } from "@/components/custom/action-button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type EmailPasswordCredentials = { email: string; password: string };

/** Card with an email and password form, shared by the Convex Auth sign-in and sign-up screens. */
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

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ email: email.trim(), password });
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1>{title}</h1>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={passwordAutoComplete}
              minLength={passwordAutoComplete === "new-password" ? DEFAULT_MIN_PASSWORD_LENGTH : undefined}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <ActionButton busy={pending} showIcon={false} className="w-full">
            {submitLabel}
          </ActionButton>
        </form>
      </CardContent>

      <CardFooter className="justify-center text-muted-foreground">{footer}</CardFooter>
    </Card>
  );
}
