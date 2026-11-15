import type { ReactNode } from "react";
import { AppWindow, Cloud, Database, Laptop, Server, Users } from "lucide-react";
import { RuntimeIcon, type PreviewRuntime } from "../runtime-icons";
import { PROVIDER_LOGOS, type ProviderLogo } from "./provider-icons";
import styles from "./self-hosting-preview.module.css";

/* Explanatory architecture, not product UI: no screen shows "self-hosted".
   Facts follow self-hosted/docker-compose.yml and the CLI's Convex client. */

const MACHINES: { name: string; os: string; icon: typeof Laptop; runtimes: PreviewRuntime[] }[] = [
  { name: "Your laptop", os: "macOS", icon: Laptop, runtimes: ["claude-code", "codex"] },
  { name: "Build server", os: "Linux", icon: Server, runtimes: ["codex", "opencode"] },
  { name: "Cloud VM", os: "Linux", icon: Cloud, runtimes: ["claude-code", "cursor"] },
];

/* Agents call whichever provider their runtime is configured for. */
const PROVIDERS: { name: string; logo: ProviderLogo }[] = [
  { name: "Anthropic", logo: "anthropic" },
  { name: "OpenAI", logo: "openai" },
  { name: "Amazon Bedrock", logo: "bedrock" },
  { name: "Google Vertex AI", logo: "vertexai" },
];

function Node({ icon: Icon, title, children }: { icon: typeof Laptop; title: string; children: ReactNode }) {
  return (
    <div className={styles.node}>
      <span className={styles.icon}><Icon aria-hidden="true" /></span>
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        <span className={styles.detail}>{children}</span>
      </span>
    </div>
  );
}

function Flow({ label, up }: { label: ReactNode; up?: boolean }) {
  return (
    <div className={styles.flow}>
      <span data-flow className={up ? styles.lineUp : styles.line} aria-hidden="true" />
      <span className={styles.flowLabel}>{label}</span>
    </div>
  );
}

export function SelfHostingPreview() {
  return (
    <figure className={styles.root} aria-label="Self-hosted Convoy architecture">
      <Node icon={Users} title="Your team">Plan tasks, follow threads and answer agents in the browser</Node>
      <Flow label="Live updates" />
      <section className={styles.boundary} aria-labelledby="self-hosting-infrastructure">
        <h3 id="self-hosting-infrastructure" className={styles.boundaryLabel}>Your infrastructure</h3>
        <div className={styles.services}>
          <Node icon={AppWindow} title="Web app">Convoy&apos;s Next.js app</Node>
          <span className={styles.bridge} aria-hidden="true" />
          <Node icon={Database} title="Convex backend">Tasks, threads, artifacts and MCP</Node>
        </div>
      </section>
      <Flow up label={<><code>convoy connect</code><span className={styles.flowNote}>outbound connection</span></>} />
      <ul className={styles.machines} aria-label="Connected machines">
        {MACHINES.map((machine) => (
          <li key={machine.name} className={styles.machine}>
            <span className={styles.machineHead}>
              <machine.icon aria-hidden="true" className={styles.machineIcon} />
              <span className={styles.title}>{machine.name}</span>
            </span>
            <span className={styles.machineFoot}>
              <span className={styles.detail}>{machine.os}</span>
              <span className={styles.runtimes}>
                {machine.runtimes.map((runtime) => <span key={runtime} className={styles.runtime}><RuntimeIcon runtime={runtime} /></span>)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.narrowFlow}><Flow label="model API calls" /></div>
      <div className={styles.fanout} aria-hidden="true">
        <div className={styles.drops}>
          {MACHINES.map((machine, index) => <span key={machine.name}><span data-flow data-drop className={styles.line} />{index === 1 ? <span className={styles.fanoutLabel}>model API calls</span> : null}</span>)}
        </div>
        <span data-bus className={styles.bus} />
        <div className={styles.stubs}>
          {PROVIDERS.map((provider) => <span key={provider.name}><span data-flow data-stub className={styles.line} /></span>)}
        </div>
      </div>
      <ul className={styles.providers} aria-label="Model providers">
        {PROVIDERS.map((provider) => (
          <li key={provider.name} className={styles.provider}>
            <span role="img" aria-label={provider.name} className={styles.logo}>{PROVIDER_LOGOS[provider.logo]}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
