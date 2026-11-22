"use client";

import { AuthPageWrapper } from "@/components/blocks/auth/auth-page-wrapper";
import { ForgotPasswordScreen } from "@/lib/auth/hooks";

export default function ForgotPasswordPage() {
  return (
    <AuthPageWrapper>
      <ForgotPasswordScreen />
    </AuthPageWrapper>
  );
}
