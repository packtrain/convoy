import { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";

export function TextInputDemo() {
  const { exit } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [activeField, setActiveField] = useState<"name" | "email" | "done">("name");
  const [submitted, setSubmitted] = useState(false);

  useInput((input, key) => {
    if (key.escape) {
      exit();
    }
  });

  const handleNameSubmit = () => {
    if (name.trim()) {
      setActiveField("email");
    }
  };

  const handleEmailSubmit = () => {
    if (email.trim()) {
      setActiveField("done");
      setSubmitted(true);
      setTimeout(() => exit(), 2000);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Text Input Demo
        </Text>
      </Box>

      <Box flexDirection="column" gap={1}>
        <Box>
          <Text>Name: </Text>
          {activeField === "name" ? (
            <TextInput
              value={name}
              onChange={setName}
              onSubmit={handleNameSubmit}
              placeholder="Enter your name..."
            />
          ) : (
            <Text color="green">{name}</Text>
          )}
        </Box>

        <Box>
          <Text>Email: </Text>
          {activeField === "email" ? (
            <TextInput
              value={email}
              onChange={setEmail}
              onSubmit={handleEmailSubmit}
              placeholder="Enter your email..."
            />
          ) : activeField === "done" ? (
            <Text color="green">{email}</Text>
          ) : (
            <Text dimColor>-</Text>
          )}
        </Box>
      </Box>

      {submitted && (
        <Box marginTop={1} borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
          <Text color="green">
            Submitted! Name: {name}, Email: {email}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Press Enter to submit, Esc to quit</Text>
      </Box>
    </Box>
  );
}
