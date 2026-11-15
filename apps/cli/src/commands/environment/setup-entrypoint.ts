import { addProject, addProjectGuided } from "../project/workflow.js";
import { setupRequestSchema } from "./validators.js";

let input = "";
try {
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (Buffer.byteLength(input) > 16_384) throw new Error("Registration input exceeds limit.");
  }
  const request = setupRequestSchema.parse(JSON.parse(input));
  if (request.guided) console.log(JSON.stringify(await addProjectGuided(request.directory, request.options)));
  else await addProject(request.directory, { ...request.options, nonInteractive: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Project setup failed. Inspect project list before retrying.");
  process.exitCode = 1;
}
