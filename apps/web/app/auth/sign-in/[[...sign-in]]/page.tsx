"use client";

import { AuthPageWrapper } from "@/components/blocks/auth/auth-page-wrapper";
import { SignInScreen } from "@/lib/auth/hooks";

export default function SignInPage() {
  return (
    <AuthPageWrapper>
      <SignInScreen />
    </AuthPageWrapper>
  );
}
