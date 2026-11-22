"use client";

import { AuthPageWrapper } from "@/components/blocks/auth/auth-page-wrapper";
import { SignUpScreen } from "@/lib/auth/hooks";

export default function SignUpPage() {
  return (
    <AuthPageWrapper>
      <SignUpScreen />
    </AuthPageWrapper>
  );
}
