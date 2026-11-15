import { useState } from "react";
import { Box, Text, useApp } from "ink";
import SelectInput from "ink-select-input";
import { Counter } from "./counter.js";
import { SpinnerDemo } from "./spinner.js";
import { TextInputDemo } from "./text-input.js";
import { SelectDemo } from "./select.js";
import { TableDemo } from "./table.js";
import { ProgressDemo } from "./progress.js";

type ExampleKey = "counter" | "spinner" | "input" | "select" | "table" | "progress" | "quit";

interface Item {
  label: string;
  value: ExampleKey;
}

const examples: Item[] = [
  { label: "Counter - Interactive state with keyboard", value: "counter" },
  { label: "Spinner - Loading animations", value: "spinner" },
  { label: "Text Input - Form input handling", value: "input" },
  { label: "Select - Menu navigation", value: "select" },
  { label: "Table - Data display", value: "table" },
  { label: "Progress - Animated progress bars", value: "progress" },
  { label: "Quit", value: "quit" },
];

const exampleComponents: Record<ExampleKey, React.ComponentType | null> = {
  counter: Counter,
  spinner: SpinnerDemo,
  input: TextInputDemo,
  select: SelectDemo,
  table: TableDemo,
  progress: ProgressDemo,
  quit: null,
};

export function ExamplePicker() {
  const { exit } = useApp();
  const [selected, setSelected] = useState<ExampleKey | null>(null);

  const handleSelect = (item: Item) => {
    if (item.value === "quit") {
      exit();
      return;
    }
    setSelected(item.value);
  };

  if (selected) {
    const Component = exampleComponents[selected];
    if (Component) {
      return <Component />;
    }
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text bold color="cyan">
          Ink CLI Playground
        </Text>
        <Text dimColor>Exploring React for command-line interfaces</Text>
      </Box>

      <Box marginBottom={1}>
        <Text>Select an example to run:</Text>
      </Box>

      <SelectInput items={examples} onSelect={handleSelect} />

      <Box marginTop={1}>
        <Text dimColor>Use arrows to navigate, Enter to select</Text>
      </Box>
    </Box>
  );
}
