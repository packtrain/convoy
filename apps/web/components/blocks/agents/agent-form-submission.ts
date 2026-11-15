"use client";

import { useState } from "react";

import { showConvexErrorToast } from "@/lib/errors";

export function useAgentFormSubmission(errorMessage: string) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitAgentForm(submit: () => Promise<void>) {
    setIsSubmitting(true);
    try {
      await submit();
    } catch (error) {
      showConvexErrorToast(error, errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  }

  return { isSubmitting, submitAgentForm };
}
