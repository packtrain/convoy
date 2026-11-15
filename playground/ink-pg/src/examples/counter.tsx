import { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";

export function Counter() {
  const { exit } = useApp();
  const [count, setCount] = useState(0);

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      exit();
    }
    if (key.upArrow || input === "k") {
      setCount((prev) => prev + 1);
    }
    if (key.downArrow || input === "j") {
      setCount((prev) => prev - 1);
    }
    if (input === "r") {
      setCount(0);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Interactive Counter
        </Text>
      </Box>

      <Box
        borderStyle="round"
        borderColor="green"
        paddingX={2}
        paddingY={1}
        alignItems="center"
        justifyContent="center"
      >
        <Text bold>
          Count:{" "}
          <Text color={count >= 0 ? "green" : "red"}>{count}</Text>
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Controls:</Text>
        <Text dimColor>  Up/k    - Increment</Text>
        <Text dimColor>  Down/j  - Decrement</Text>
        <Text dimColor>  r       - Reset</Text>
        <Text dimColor>  q/Esc   - Quit</Text>
      </Box>
    </Box>
  );
}
