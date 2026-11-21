import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Browser } from "../workflow.js";
import { Dialog } from "../dialog/index.js";
import { palette, plain, printable } from "../formatters.js";
import { getCliVersion } from "../../../lib/version.js";
import { environmentFormSchema, type EnvironmentProposal, type UpdateProposal, type EnvironmentOperation, type EnvironmentForm } from "../../environment/validators.js";
import { MODE_COPY } from "../../environment/formatters.js";

const operations: { label: string; operation: EnvironmentOperation }[] = [
  { label: "Start environment / recover", operation: "start" },
  { label: "Stop environment", operation: "stop" },
  { label: "Delete environment", operation: "delete" },
  { label: "Restart service", operation: "restart" },
  { label: "Update CLI", operation: "update" },
];
const working_ = "Working. Wait for the result; detaching does not undo this operation.";
const recovery = {
  create: "Back keeps your settings. Create / Resume continues a partially created environment.",
  delete: "Deletion did not complete. Some data may already be removed. The local record is retained so you can retry.",
  other: "Inspect status before retrying. Start recovers interrupted updates. Saved volumes and service logs are retained.",
};
type Draft = Omit<EnvironmentForm, "mounts"> & { mode: "shared" | "isolated"; mounts: string };
const radios = { mode: ["shared", "isolated"], networkMode: ["open", "strict"] } as const;

export function Environments({ browser, width, height }: { browser: Browser; width: number; height: number }) {
  const state = browser.getSnapshot();
  const target = browser.targets[state.scope.connection];
  const [step, setStep] = useState<"form" | "confirm" | "busy" | "result">(state.environment === "create" ? "form" : "confirm");
  const [form, setForm] = useState<Draft>({ name: "", mode: "shared", mounts: "", networkMode: "open", deployment: "", domains: "" });
  const submittedForm: EnvironmentForm = { ...form, ...(form.networkMode === "open" ? { deployment: "", domains: "" } : {}),
    mounts: form.mode === "shared" ? form.mounts.split(",").map(folder => folder.trim()).filter(Boolean) : [] };
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState(operations[0]);
  const [proposal, setProposal] = useState<UpdateProposal>();
  const [creation, setCreation] = useState<EnvironmentProposal>();
  const [message, setMessage] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [discard, setDiscard] = useState(false);
  const alive = useRef(true);
  const working = useRef(false);
  useEffect(() => () => { alive.current = false; }, []);
  const close = () => { if (working.current) return; if (!created && state.environment === "create" && (form.name || form.deployment || form.domains || form.mounts || form.mode === "isolated" || form.networkMode === "strict")) setDiscard(true); else browser.closeEnvironment(); };
  const backToForm = () => { setMessage([]); setError(undefined); setStep("form"); };
  const progress = (text: string) => { if (alive.current) setMessage(old => [...old, plain(text.slice(-2048))].slice(-8)); };
  const run = async (action: () => Promise<void>, next: "result" | "confirm" = "result", label = chosen.label) => {
    if (working.current) return;
    working.current = true; browser.environmentBusy = true; setStep("busy"); setError(undefined); setMessage([`Target: ${state.environment === "create" ? form.name : target.name}`, working_]);
    try { await action(); if (alive.current) setStep(next); }
    catch (error) {
      if (!alive.current) return;
      setError(`${state.environment === "create" ? "Create environment" : label} failed: ${error instanceof Error ? error.message : "unknown error."}`);
      setMessage(old => [...old.filter(line => line !== working_).slice(-6), recovery[state.environment === "create" || state.environment === "delete" ? state.environment : "other"]]); setStep("result");
    }
    finally { working.current = false; browser.environmentBusy = false; }
  };
  const choose = async (control: typeof chosen) => {
    setChosen(control); setProposal(undefined); setError(undefined);
    if (!target.maintenance) { setMessage(["Environment lifecycle is unavailable on this transport. Use its service controls in Actions."]); setStep("result"); return; }
    if (control.operation === "update") {
      await run(async () => { const release = await target.maintenance!.release(browser.localPackage); if (alive.current) setProposal(release); }, "confirm", control.label);
    } else setStep("confirm");
  };
  useEffect(() => {
    if (state.environment !== "create") {
      const mode = state.environment;
      const control = operations.find(control => control.operation === mode);
      if (control) void choose(control);
    }
  }, []); // This workflow owns the selected target until closed.
  const execute = () => run(async () => {
    if (state.environment === "create") {
      await browser.createEnvironment(submittedForm, progress, creation);
      if (alive.current) { setCreated(true); setMessage([`Environment ${form.name} is ready.`, "Next: Add project. Projects use the agent runtimes the image provides; Agent runtimes installs more."]); }
      return;
    }
    const result = await target.maintenance!.execute(chosen.operation, progress, { version: proposal?.proposed, localPackage: proposal?.localPackage });
    if (result.deleted === true && alive.current) setDeleted(true);
    await browser.refreshEnvironment(result);
    if (alive.current) setMessage([
      ...(chosen.operation === "stop" ? [`Environment ${target.name} is stopped.`, result.state === "not-created" ? "No container was created. There is nothing running to stop." : "All projects in this container are stopped.", "Saved data is retained. Use Delete environment to remove it."]
        : chosen.operation === "delete" ? [`Environment ${target.name} deleted.`, "Its container, saved volumes and local record were removed."]
        : [`${chosen.label} completed.`, ...Object.entries(result).map(([key, value]) => `${key}: ${JSON.stringify(value)}`)]),
      ...(state.onboarding ? ["Project inputs retained. Close this result and explicitly continue registration."] : []),
    ]);
  });
  const fields = ["name", "mode", ...(form.mode === "shared" ? ["mounts"] as const : []), "networkMode", ...(form.networkMode === "strict" ? ["deployment", "domains"] as const : [])] as const;
  const cancelIndex = fields.length, reviewIndex = fields.length + 1;
  const minHeight = 15 + (form.mode === "shared" ? 2 : 0) + (form.networkMode === "strict" ? 5 : 0);
  const small = width < 45 || height < minHeight;
  const labels = { name: "Environment name", mode: "Project separation", mounts: "Mount folders, comma-separated (optional)", networkMode: "Internet access", deployment: "Allowed Convex deployment slug (optional)", domains: "Extra allowed domains, comma-separated (optional)" };
  useInput((input, key) => {
    if (discard || step !== "form") return;
    if (key.escape) { close(); return; }
    if (key.ctrl || key.meta || small) return;
    const count = fields.length + 2;
    const focused = fields[index];
    if ((focused === "mode" || focused === "networkMode") && (key.leftArrow || key.rightArrow || input === " " || key.return)) {
      const [first, second] = radios[focused];
      setForm(old => ({ ...old, [focused]: key.leftArrow ? first : key.rightArrow ? second : old[focused] === first ? second : first }));
      return;
    }
    if (index >= cancelIndex && (key.leftArrow || key.rightArrow)) {
      setIndex(key.leftArrow ? cancelIndex : reviewIndex); return;
    }
    if (key.tab || key.downArrow || key.upArrow) { setIndex(old => (old + (key.upArrow || key.shift ? count - 1 : 1)) % count); return; }
    if (key.return) {
      if (index === cancelIndex) { close(); return; }
      if (index === reviewIndex) {
        const valid = environmentFormSchema.safeParse(submittedForm);
        if (!valid.success) setMessage(["Use a lowercase environment name, deployment slug and comma-separated hostnames. No URLs or spaces."]);
        else void run(async () => { const value = await browser.prepareEnvironment(submittedForm); if (alive.current) setCreation(value); }, "confirm");
      }
      return;
    }
    if (step === "form" && index < fields.length) {
      const field = fields[index];
      if (field === "mode" || field === "networkMode") return;
      if (key.backspace || key.delete) setForm(old => ({ ...old, [field]: old[field].slice(0, -1) }));
      else if (input && !key.leftArrow && !key.rightArrow) setForm(old => ({ ...old, [field]: (old[field] + printable(input)).slice(0, 256) }));
    }
  });
  if (discard) return <Dialog width={width} height={height} lines={["Discard environment draft?", "Your entered settings will be lost."]} onCancel={() => setDiscard(false)} buttons={[{ label: "Keep editing", activate: () => setDiscard(false) }, { label: "Discard", activate: () => browser.closeEnvironment() }]} />;
  if (step === "confirm") return <Dialog inline={state.environment === "create" || state.environment === "update"} key="confirm" width={width} height={height} onCancel={() => state.environment === "create" ? backToForm() : close()}
    lines={state.environment === "create" ? ["Create / resume managed Docker environment", `Target: ${form.name}`, `CLI: ${creation?.version} · ${creation?.install ? creation.localPackage ? `install ${creation.localPackage}` : "install from npm" : "retain installed release"}`,
      ...(creation?.mode === "isolated" ? ["Projects: isolated accounts"] : ["Projects: shared account", `Mount folders: ${creation?.mounts?.join(", ") || "none"}`]), `Internet access: ${creation?.networkMode === "open" ? "Unrestricted" : "Restricted"}`, ...(creation?.networkMode === "open" ? ["Allows web research and downloads from any site."] : [`Deployment: ${creation?.deployment || "none"}`, `Extra domains: ${creation?.domains || "none"}`]), "Builds a local image and retains private data volumes. Requires Linux Docker."] : [
      chosen.label, `Exact target: ${target.name} · ${target.endpoint}`, `Host ${getCliVersion()} / Installed ${proposal?.installed ?? state.observations[state.scope.connection].version ?? "unknown"}`,
      ...(proposal ? [proposal.localPackage ? `Install ${proposal.localPackage} (${proposal.proposed}).` : `Install @useconvoy/cli@${proposal.proposed} from npm.`] : []),
      ...(chosen.operation === "delete" ? ["Permanently deletes the container and all saved volumes.", "Includes project files, credentials, configuration and logs.", "This cannot be undone. Remote Convoy projects are not deleted."] : ["May stop all connections and active work on this target. Other clients are affected."]), "Cancel leaves the target unchanged.",
    ]} buttons={[{ label: "Cancel", activate: () => state.environment === "create" ? backToForm() : close() }, { label: state.environment === "create" ? "Create / Resume" : chosen.operation === "update" ? "Update CLI" : chosen.label, activate: () => { void execute(); } }]} />;
  if (step === "busy" || step === "result") return <Dialog inline={state.environment !== "stop" && state.environment !== "delete"} key={step} width={width} height={height} scrollable error={step === "result" ? error : undefined} lines={message} onCancel={close}
    buttons={step === "busy" ? [] : [{ label: "Close", activate: close }, ...(!created && !deleted ? [{ label: "Back", activate: () => { setIndex(0); if (state.environment === "create") backToForm(); else void choose(chosen); } }] : [])]} />;
  return <Box width={width} height={height} backgroundColor={palette.base ?? "black"} flexDirection="column" paddingX={2}>
    <Text bold color={palette.text}>Add environment · managed Docker</Text>
    {small ? <Text>Resize to 45×{minHeight}. Esc cancels.</Text> : <>
      <>
        {fields.map((field, i) => <Box key={field} flexDirection="column">
          <Text color={index === i ? palette.accent : palette.text ?? "white"}>{labels[field]}</Text>
          {field === "mode" ? <>
            <Text color={palette.text}>{index === i ? ">" : " "} {form.mode === "shared" ? "(●)" : "( )"} Shared  {form.mode === "isolated" ? "(●)" : "( )"} Isolated</Text>
            <Text color={palette.muted}>{MODE_COPY[form.mode]}</Text>
          </> : field === "networkMode" ? <>
            <Text color={palette.text}>{index === i ? ">" : " "} {form.networkMode === "open" ? "(●)" : "( )"} Unrestricted  {form.networkMode === "strict" ? "(●)" : "( )"} Restricted</Text>
            <Text color={palette.muted}>{form.networkMode === "open" ? "Web research and downloads from any site." : "Only built-in and extra allowed destinations."}</Text>
            {form.networkMode === "strict" && <Text color={palette.muted}>Advanced network settings: add your Convex backend below.</Text>}
          </> : <Text wrap="truncate" color={palette.text}>{index === i ? ">" : " "} <Text backgroundColor={index === i ? palette.idle : palette.surface}>[ {form[field] || " "}{index === i ? "▏" : ""} ]</Text></Text>}
        </Box>)}
        <Box gap={2}>{([["Cancel", cancelIndex], ["Review", reviewIndex]] as const).map(([label, at]) => <Text key={label} bold color={index === at ? palette.selectedText : palette.accent} backgroundColor={index === at ? palette.selected : undefined}>{index === at ? ">" : " "} [ {label} ]</Text>)}</Box>
        {message.map(line => <Text key={line} color={palette.warning}>{line}</Text>)}
      </>
      <Text color={palette.muted}>Tab/↑/↓ focus · ←/→ choose · Enter activate · Esc close</Text>
    </>}
  </Box>;
}
