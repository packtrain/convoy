import { Box, Text, useApp, useInput } from "ink";

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  status: "active" | "inactive";
}

const users: User[] = [
  { id: 1, name: "Alice Johnson", email: "alice@example.com", role: "Admin", status: "active" },
  { id: 2, name: "Bob Smith", email: "bob@example.com", role: "Developer", status: "active" },
  { id: 3, name: "Carol White", email: "carol@example.com", role: "Designer", status: "inactive" },
  { id: 4, name: "David Brown", email: "david@example.com", role: "Developer", status: "active" },
  { id: 5, name: "Eve Davis", email: "eve@example.com", role: "Manager", status: "active" },
];

const columns = [
  { key: "id", header: "ID", width: 4 },
  { key: "name", header: "Name", width: 16 },
  { key: "email", header: "Email", width: 22 },
  { key: "role", header: "Role", width: 12 },
  { key: "status", header: "Status", width: 10 },
] as const;

function TableCell({ value, width }: { value: string; width: number }) {
  const displayValue = value.length > width ? value.slice(0, width - 1) + "…" : value;
  return <Text>{displayValue.padEnd(width)}</Text>;
}

function StatusCell({ status }: { status: "active" | "inactive" }) {
  return (
    <Text color={status === "active" ? "green" : "red"}>
      {status === "active" ? "● Active" : "○ Inactive"}
    </Text>
  );
}

export function TableDemo() {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Table Demo
        </Text>
      </Box>

      {/* Header */}
      <Box>
        {columns.map((col) => (
          <Text key={col.key} bold color="yellow">
            {col.header.padEnd(col.width)}
          </Text>
        ))}
      </Box>

      {/* Divider */}
      <Box>
        <Text dimColor>{"─".repeat(columns.reduce((sum, col) => sum + col.width, 0))}</Text>
      </Box>

      {/* Rows */}
      {users.map((user) => (
        <Box key={user.id}>
          <TableCell value={String(user.id)} width={columns[0].width} />
          <TableCell value={user.name} width={columns[1].width} />
          <TableCell value={user.email} width={columns[2].width} />
          <TableCell value={user.role} width={columns[3].width} />
          <StatusCell status={user.status} />
        </Box>
      ))}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>Total: {users.length} users | Active: {users.filter((u) => u.status === "active").length}</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press q or Esc to quit</Text>
      </Box>
    </Box>
  );
}
