import { Command } from "commander";
import { render } from "ink";
import { Counter } from "./examples/counter.js";
import { SpinnerDemo } from "./examples/spinner.js";
import { TextInputDemo } from "./examples/text-input.js";
import { SelectDemo } from "./examples/select.js";
import { TableDemo } from "./examples/table.js";
import { ProgressDemo } from "./examples/progress.js";
import { ExamplePicker } from "./examples/picker.js";

const program = new Command();

program
  .name("ink-pg")
  .description("Ink CLI playground - exploring React for CLI applications")
  .version("0.1.0");

program
  .command("counter")
  .description("Interactive counter with keyboard controls")
  .action(() => {
    render(<Counter />);
  });

program
  .command("spinner")
  .description("Loading spinner animation demo")
  .action(() => {
    render(<SpinnerDemo />);
  });

program
  .command("input")
  .description("Text input component demo")
  .action(() => {
    render(<TextInputDemo />);
  });

program
  .command("select")
  .description("Selection menu demo")
  .action(() => {
    render(<SelectDemo />);
  });

program
  .command("table")
  .description("Table rendering demo")
  .action(() => {
    render(<TableDemo />);
  });

program
  .command("progress")
  .description("Progress bar animation demo")
  .action(() => {
    render(<ProgressDemo />);
  });

program
  .command("all", { isDefault: true })
  .description("Interactive menu to pick an example")
  .action(() => {
    render(<ExamplePicker />);
  });

export function runCli(): void {
  program.parse();
}
