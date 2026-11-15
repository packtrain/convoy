import { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";

export function SpinnerDemo() {
  const { exit } = useApp();
  const [step, setStep] = useState(0);
  const [complete, setComplete] = useState(false);

  const steps = [
    "Initializing...",
    "Loading configuration...",
    "Connecting to server...",
    "Fetching data...",
    "Processing results...",
  ];

  useEffect(() => {
    if (step >= steps.length) {
      setComplete(true);
      setTimeout(() => exit(), 1000);
      return;
    }

    const timer = setTimeout(() => {
      setStep((prev) => prev + 1);
    }, 1500);

    return () => clearTimeout(timer);
  }, [step, steps.length, exit]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Spinner Demo
        </Text>
      </Box>

      {steps.map((stepText, index) => (
        <Box key={index}>
          {index < step ? (
            <Text color="green">✓ {stepText}</Text>
          ) : index === step && !complete ? (
            <Text>
              <Text color="yellow">
                <Spinner type="dots" />
              </Text>
              {" "}
              {stepText}
            </Text>
          ) : (
            <Text dimColor>○ {stepText}</Text>
          )}
        </Box>
      ))}

      {complete && (
        <Box marginTop={1}>
          <Text bold color="green">
            All tasks completed!
          </Text>
        </Box>
      )}
    </Box>
  );
}
