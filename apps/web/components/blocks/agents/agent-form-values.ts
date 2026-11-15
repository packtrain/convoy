import type { AgentFormValues } from "./agent-form";

export function agentFormValuesToCreateFields(values: AgentFormValues) {
  return {
    name: values.name,
    description: values.description?.trim() || undefined,
    category: values.category?.trim() || undefined,
    prompt: values.prompt,
    appearance: values.appearance,
  };
}

export function agentFormValuesToUpdateFields(values: AgentFormValues) {
  return {
    name: values.name,
    description: values.description?.trim() || null,
    category: values.category?.trim() || null,
    prompt: values.prompt,
    appearance: values.appearance,
  };
}
