import { useState } from "react";
import { Box, Text, useApp } from "ink";
import SelectInput from "ink-select-input";

interface Item {
  label: string;
  value: string;
}

const frameworks: Item[] = [
  { label: "React", value: "react" },
  { label: "Vue", value: "vue" },
  { label: "Svelte", value: "svelte" },
  { label: "Angular", value: "angular" },
  { label: "Solid", value: "solid" },
];

const buildTools: Item[] = [
  { label: "Vite", value: "vite" },
  { label: "Webpack", value: "webpack" },
  { label: "Rollup", value: "rollup" },
  { label: "esbuild", value: "esbuild" },
  { label: "Parcel", value: "parcel" },
];

export function SelectDemo() {
  const { exit } = useApp();
  const [step, setStep] = useState<"framework" | "build" | "done">("framework");
  const [framework, setFramework] = useState<string | null>(null);
  const [buildTool, setBuildTool] = useState<string | null>(null);

  const handleFrameworkSelect = (item: Item) => {
    setFramework(item.label);
    setStep("build");
  };

  const handleBuildToolSelect = (item: Item) => {
    setBuildTool(item.label);
    setStep("done");
    setTimeout(() => exit(), 2000);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Selection Menu Demo
        </Text>
      </Box>

      {step === "framework" && (
        <Box flexDirection="column">
          <Text>Choose a framework:</Text>
          <Box marginTop={1}>
            <SelectInput items={frameworks} onSelect={handleFrameworkSelect} />
          </Box>
        </Box>
      )}

      {step === "build" && (
        <Box flexDirection="column">
          <Text dimColor>Framework: {framework}</Text>
          <Box marginTop={1}>
            <Text>Choose a build tool:</Text>
          </Box>
          <Box marginTop={1}>
            <SelectInput items={buildTools} onSelect={handleBuildToolSelect} />
          </Box>
        </Box>
      )}

      {step === "done" && (
        <Box flexDirection="column">
          <Box
            borderStyle="round"
            borderColor="green"
            paddingX={2}
            paddingY={1}
            flexDirection="column"
          >
            <Text bold color="green">
              Configuration Complete!
            </Text>
            <Text>Framework: {framework}</Text>
            <Text>Build Tool: {buildTool}</Text>
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Use arrows to navigate, Enter to select</Text>
      </Box>
    </Box>
  );
}
