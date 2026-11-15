import { useEffect, useState } from "react";
import { ConvexClient } from "convex/browser";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../convex/_generated/api";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { SectionHeader } from "@/components/section-header";
import type { Credentials } from "./step-connect";

export interface ProjectChoice {
  id: string;
  name: string;
  alias: string;
  organizationName: string;
}

export interface WorkspaceSelection {
  project: ProjectChoice;
  paths: string[];
}

export function StepWorkspace({
  credentials,
  selection,
  onSelectionChange,
}: {
  credentials: Credentials;
  selection: WorkspaceSelection | null;
  onSelectionChange: (selection: WorkspaceSelection | null) => void;
}) {
  const [projects, setProjects] = useState<ProjectChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(selection?.project.id ?? "");
  const [paths, setPaths] = useState<string[]>(selection?.paths ?? []);

  useEffect(() => {
    let cancelled = false;
    const client = new ConvexClient(credentials.url);
    client
      .query(api.projects.core.listAccessible, { apiKey: credentials.apiKey })
      // Explicit row type: the generated api types collapse to `any` through
      // the _generated symlink (same situation as apps/cli), so
      // FunctionReturnType<> has nothing to derive from here.
      .then((result: Array<{ _id: string; name: string; alias: string; organizationName: string }>) => {
        if (cancelled) return;
        const choices = result.map((project) => ({
          id: project._id as string,
          name: project.name,
          alias: project.alias,
          organizationName: project.organizationName,
        }));
        setProjects(choices);
        if (choices.length > 0 && !projectId) setProjectId(choices[0].id);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => void client.close());
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once per credentials
  }, [credentials.url, credentials.apiKey]);

  useEffect(() => {
    const project = projects?.find((candidate) => candidate.id === projectId);
    onSelectionChange(project && paths.length > 0 ? { project, paths } : null);
  }, [projects, projectId, paths, onSelectionChange]);

  async function addFolder() {
    const picked = await openDialog({ directory: true, multiple: false, title: "Choose a repository folder" });
    if (typeof picked === "string" && !paths.includes(picked)) {
      setPaths((previous) => [...previous, picked]);
    }
  }

  return (
    <div className="flex w-full max-w-[460px] flex-col">
      <SectionHeader
        title="Choose your project & folders"
        description="Threads from this project run here. Folders are the repositories agents may work in."
      />

      <div className="mb-5">
        <Label htmlFor="project-select">Project</Label>
        {error ? (
          <div className="text-[12.5px] text-destructive">{error}</div>
        ) : projects === null ? (
          <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
            <Spinner /> Loading projects…
          </div>
        ) : projects.length === 0 ? (
          <div className="text-[13px] text-muted-foreground">
            No projects found. Create one in the web app first, then come back.
          </div>
        ) : (
          <select
            id="project-select"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="h-10 w-full cursor-pointer appearance-none rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:border-border-strong focus-visible:outline-none"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} · {project.alias} — {project.organizationName}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <Label>Folders</Label>
        <div className="flex flex-col gap-2">
          {paths.map((path) => (
            <div
              key={path}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-[12.5px] text-foreground/80"
            >
              <span className="min-w-0 flex-1 truncate" title={path}>{path}</span>
              <button
                className="shrink-0 cursor-pointer text-faint hover:text-foreground"
                title="Remove"
                onClick={() => setPaths((previous) => previous.filter((candidate) => candidate !== path))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="w-full cursor-pointer rounded-lg border border-dashed border-border-strong py-2.5 text-[12.5px] font-medium text-muted-foreground hover:border-white/30 hover:text-foreground"
            onClick={() => void addFolder()}
          >
            + Add folder
          </button>
        </div>
        <div className="mt-2.5 text-xs text-faint">
          Saved to <span className="font-mono">~/.config/convoy/config.toml</span> — shared with the{" "}
          <span className="font-mono">convoy</span> CLI.
        </div>
      </div>
    </div>
  );
}
