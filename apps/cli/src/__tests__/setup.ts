// Spawned CLIs must not inherit the agent shell's bridge identity or its relative tsx tsconfig (OS-2275).
for (const key of Object.keys(process.env)) {
  if (key.startsWith("CONVOY_") || key === "TSX_TSCONFIG_PATH") delete process.env[key];
}
