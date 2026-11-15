import { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";

interface ProgressBarProps {
  percent: number;
  width?: number;
  label: string;
}

function ProgressBar({ percent, width = 30, label }: ProgressBarProps) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  const getColor = (pct: number) => {
    if (pct >= 100) return "green";
    if (pct >= 60) return "yellow";
    return "cyan";
  };

  return (
    <Box>
      <Text>{label.padEnd(12)}</Text>
      <Text color={getColor(percent)}>
        {"█".repeat(filled)}
        <Text dimColor>{"░".repeat(empty)}</Text>
      </Text>
      <Text> {percent.toFixed(0).padStart(3)}%</Text>
    </Box>
  );
}

export function ProgressDemo() {
  const { exit } = useApp();
  const [downloading, setDownloading] = useState(0);
  const [installing, setInstalling] = useState(0);
  const [building, setBuilding] = useState(0);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setDownloading((prev) => {
        if (prev >= 100) return 100;
        return Math.min(100, prev + Math.random() * 15);
      });
    }, 200);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (downloading < 30) return;

    const interval = setInterval(() => {
      setInstalling((prev) => {
        if (prev >= 100) return 100;
        return Math.min(100, prev + Math.random() * 10);
      });
    }, 200);

    return () => clearInterval(interval);
  }, [downloading]);

  useEffect(() => {
    if (installing < 50) return;

    const interval = setInterval(() => {
      setBuilding((prev) => {
        if (prev >= 100) return 100;
        return Math.min(100, prev + Math.random() * 8);
      });
    }, 200);

    return () => clearInterval(interval);
  }, [installing]);

  useEffect(() => {
    if (downloading >= 100 && installing >= 100 && building >= 100) {
      setComplete(true);
      setTimeout(() => exit(), 1500);
    }
  }, [downloading, installing, building, exit]);

  const overallProgress = (downloading + installing + building) / 3;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Progress Bar Demo
        </Text>
      </Box>

      <Box flexDirection="column" gap={1}>
        <ProgressBar percent={downloading} label="Downloading" />
        <ProgressBar percent={installing} label="Installing" />
        <ProgressBar percent={building} label="Building" />
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor="blue" paddingX={2}>
        <Text>Overall: </Text>
        <ProgressBar percent={overallProgress} width={20} label="" />
      </Box>

      {complete && (
        <Box marginTop={1}>
          <Text bold color="green">
            All operations completed successfully!
          </Text>
        </Box>
      )}
    </Box>
  );
}
