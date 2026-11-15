/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Form, FormField, FormItem } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { SettingsPromptEditor } from "./settings-prompt-editor";

// Render the (dynamically imported) MDX editor as a plain textarea so we can
// assert how many editor instances are mounted and drive value changes.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MockMdxEditor({
      value,
      onChange,
    }: {
      value: string;
      onChange: (value: string) => void;
    }) {
      return (
        <textarea
          aria-label="Prompt editor"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    },
}));

function Harness({ initialValue = "" }: { initialValue?: string }) {
  const form = useForm<{ prompt: string }>({
    defaultValues: { prompt: initialValue },
  });

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="prompt"
        render={({ field }) => (
          <FormItem>
            <SettingsPromptEditor
              label="Prompt"
              value={field.value}
              disabled={false}
              onChange={(value) =>
                form.setValue("prompt", value, { shouldDirty: true })
              }
            />
          </FormItem>
        )}
      />
    </Form>
  );
}

// Drives the editor with an externally updated value (simulates a parent
// updating the value prop, e.g. a server load).
function ExternalHarness() {
  const form = useForm<{ prompt: string }>({
    defaultValues: { prompt: "initial" },
  });

  return (
    <Form {...form}>
      <button
        type="button"
        onClick={() => form.setValue("prompt", "external update")}
      >
        set external
      </button>
      <FormField
        control={form.control}
        name="prompt"
        render={({ field }) => (
          <FormItem>
            <SettingsPromptEditor
              label="Prompt"
              value={field.value}
              disabled={false}
              onChange={field.onChange}
            />
          </FormItem>
        )}
      />
    </Form>
  );
}

describe("SettingsPromptEditor", () => {
  beforeAll(() => {
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserver);
  });

  afterEach(() => {
    cleanup();
  });

  test("only one editor instance is mounted while collapsed", () => {
    render(<Harness />);
    expect(screen.getAllByLabelText("Prompt editor")).toHaveLength(1);
  });

  test("typing inline propagates the value", () => {
    render(<Harness />);
    const editor = screen.getByLabelText("Prompt editor");
    fireEvent.change(editor, { target: { value: "hello" } });
    expect((editor as HTMLTextAreaElement).value).toBe("hello");
  });

  test("expanding keeps a single editor instance with value continuity", () => {
    render(<Harness initialValue="seed" />);

    fireEvent.change(screen.getByLabelText("Prompt editor"), {
      target: { value: "typed inline" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Open prompt editor wide view" })
    );

    // Never two editors at once, and the dialog editor carries the value.
    const editors = screen.getAllByLabelText("Prompt editor");
    expect(editors).toHaveLength(1);
    expect((editors[0] as HTMLTextAreaElement).value).toBe("typed inline");
  });

  test("editing in the dialog is reflected after closing", () => {
    render(<Harness />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open prompt editor wide view" })
    );
    fireEvent.change(screen.getByLabelText("Prompt editor"), {
      target: { value: "edited in dialog" },
    });

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    const inline = screen.getByLabelText("Prompt editor");
    expect((inline as HTMLTextAreaElement).value).toBe("edited in dialog");
  });

  test("external value updates are reflected", () => {
    render(<ExternalHarness />);
    expect((screen.getByLabelText("Prompt editor") as HTMLTextAreaElement).value).toBe(
      "initial"
    );

    fireEvent.click(screen.getByRole("button", { name: "set external" }));
    expect((screen.getByLabelText("Prompt editor") as HTMLTextAreaElement).value).toBe(
      "external update"
    );
  });
});
