export type PreviewCheck = {
  key: string;
  label: string;
  status: "passed" | "warning" | "failed" | "pending" | "not_performed";
  note: string;
  added?: boolean;
  file?: string;
  evidence?: string;
};

export const checks: PreviewCheck[] = [
  { key: "tests", label: "All tests pass", status: "warning", note: "42 tests passed. The integration suite needs staging credentials and was not run.", file: "test-results.log", evidence: "PASS delivery.test.ts\n42 passed · 0 failed · 4.2s\nIntegration suite: staging credentials unavailable" },
  { key: "screenshots", label: "Add screenshot evidence", status: "pending", note: "No result reported yet." },
  { key: "diff", label: "Diff contains only intended changes", status: "not_performed", note: "The final diff review has not been performed." },
  { key: "lint", label: "Lint and type check are clean", status: "failed", note: "TypeScript found a missing return type in the delivery worker.", file: "typecheck.log", evidence: "src/workers/deliver-webhook.ts\nTS7023: Return type annotation required." },
  { key: "regression", label: "Regression test fails before the fix, passes after", status: "passed", note: "Confirmed the retry regression fails on the old worker and passes with the fix." },
  { key: "mobile", label: "Mobile layout", status: "passed", added: true, note: "Checked at 390px. Delivery history and retry controls fit without horizontal scrolling." },
];
