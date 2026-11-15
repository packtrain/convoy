import { Activity, Braces, CircleDot, Route, ScanLine, Terminal } from "lucide-react";
import { SnakeLoader, WaveLoader, type GridAnimVariant } from "@/components/custom/cli-loaders";
import { Spinner } from "@/components/custom/spinner";
import { ButtonBusyPreview } from "./button-busy-preview";

interface ShowcaseCardProps {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}

const waveVariants: Array<{
  variant: GridAnimVariant;
  title: string;
  description: string;
}> = [
  {
    variant: "wave",
    title: "Wave",
    description: "Diagonal pulse for compact inline loading.",
  },
  {
    variant: "ripple",
    title: "Ripple",
    description: "Centered expansion for background jobs.",
  },
  {
    variant: "sweep",
    title: "Sweep",
    description: "Left-to-right scan for command execution.",
  },
  {
    variant: "checkerboard",
    title: "Checker",
    description: "Alternating cadence for queued work.",
  },
  {
    variant: "random",
    title: "Random",
    description: "Deterministic scatter pulse for noisy work.",
  },
  {
    variant: "cross",
    title: "Cross",
    description: "Axis-first pulse for selection states.",
  },
];

function ShowcaseCard({ title, description, children, className }: ShowcaseCardProps) {
  return (
    <div
      className={className}
      data-slot="loader-card"
    >
      <div className="flex min-h-28 items-center justify-center rounded-lg border border-border bg-background text-primary">
        {children}
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export default function CliLoadersPlaygroundPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-8">
        <header className="grid gap-6 border-b border-border pb-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex max-w-3xl flex-col justify-between gap-6">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                <Terminal className="size-3.5" />
                CLI loader playground
              </div>
              <div className="space-y-3">
                <h1 className="text-4xl font-semibold tracking-tight text-balance">
                  Pixel loaders for agent and command states
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  Review the snake route loader and grid wave loader across sizes, masks,
                  shapes, and animation variants before using them in the CLI surfaces.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-card p-4">
                <Activity className="mb-3 size-4 text-primary" />
                <div className="text-sm font-medium">Inline status</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Small enough for buttons, rows, and chat metadata.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <ScanLine className="mb-3 size-4 text-primary" />
                <div className="text-sm font-medium">Grid variants</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Wave, sweep, ripple, checker, cross, and stable random.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <Braces className="mb-3 size-4 text-primary" />
                <div className="text-sm font-medium">Mask modes</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Letter and word masks for Convoy-flavored loading.
                </p>
              </div>
            </div>
          </div>

          <div className="flex min-h-80 flex-col justify-between rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CircleDot className="size-4 text-primary" />
                Agent stream
              </div>
              <div className="text-muted-foreground">
                <WaveLoader cols={6} rows={6} size="sm" variant="word" word="CONVOY" strictMask speed={0.7} />
              </div>
            </div>
            <div className="space-y-4 py-5 text-sm">
              <div className="flex items-start gap-3">
                <Route className="mt-0.5 size-4 text-primary" />
                <div>
                  <div className="font-medium">Routing user request</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Runtime selector is preparing the next agent response.
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-background p-4 font-mono text-xs leading-6 text-muted-foreground">
                <div>claim_thread: acquired</div>
                <div>working_dir: convoy</div>
                <div className="flex items-center gap-2 text-primary">
                  <SnakeLoader cols={2} rows={3} size="md" />
                  streaming response
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
              <span>lease refresh active</span>
              <SnakeLoader cols={3} rows={3} size="sm" speed={1} />
            </div>
          </div>
        </header>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Snake route loader</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Rectangular path options for tight inline states and denser panels.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&_[data-slot=loader-card]]:space-y-3 [&_[data-slot=loader-card]]:rounded-lg [&_[data-slot=loader-card]]:border [&_[data-slot=loader-card]]:border-border [&_[data-slot=loader-card]]:bg-card [&_[data-slot=loader-card]]:p-4">
            <ShowcaseCard title="Default 2x3" description="The compact CLI wait state.">
              <SnakeLoader cols={2} rows={3} size="lg" />
            </ShowcaseCard>
            <ShowcaseCard title="Square path" description="Balanced status marker for headers.">
              <SnakeLoader cols={3} rows={3} size="xl" speed={1.1} />
            </ShowcaseCard>
            <ShowcaseCard title="Tall route" description="Useful beside multiline stream output.">
              <SnakeLoader cols={3} rows={5} size="lg" speed={1.4} />
            </ShowcaseCard>
            <ShowcaseCard title="Dense track" description="Longer trail across a small footprint.">
              <SnakeLoader cols={6} rows={6} size="xs" speed={2.2} snakeLength={12} />
            </ShowcaseCard>
            <ShowcaseCard title="Short trail" description="Sharper movement with a two-pixel body.">
              <SnakeLoader cols={4} rows={4} size="md" speed={0.8} snakeLength={2} />
            </ShowcaseCard>
            <ShowcaseCard title="Muted inline" description="Theme-colored loader for quiet UI chrome.">
              <div className="text-muted-foreground">
                <SnakeLoader cols={2} rows={4} size="sm" speed={0.7} />
              </div>
            </ShowcaseCard>
            <ShowcaseCard title="SM Scale (3x4)" description="Small pixel density example used for busy buttons.">
              <div className="text-muted-foreground">
                <SnakeLoader cols={3} rows={4} size="sm" speed={0.8} />
              </div>
            </ShowcaseCard>
            <ShowcaseCard title="Spinner Default" description="SM Scale (3x4) wrapped for compact UI states.">
              <Spinner />
            </ShowcaseCard>
            <ShowcaseCard title="Spinner Large" description="Tall route wrapped with optional loading text.">
              <Spinner size="large" text="Loading" />
            </ShowcaseCard>
            <ShowcaseCard title="ButtonExt Busy" description="Click-through preview of the busy button indicator.">
              <ButtonBusyPreview />
            </ShowcaseCard>
          </div>
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Wave grid variants</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              The same 4x4 grid with different delay strategies.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&_[data-slot=loader-card]]:space-y-3 [&_[data-slot=loader-card]]:rounded-lg [&_[data-slot=loader-card]]:border [&_[data-slot=loader-card]]:border-border [&_[data-slot=loader-card]]:bg-card [&_[data-slot=loader-card]]:p-4">
            {waveVariants.map((item) => (
              <ShowcaseCard
                key={item.variant}
                title={item.title}
                description={item.description}
              >
                <WaveLoader cols={4} rows={4} size="lg" variant={item.variant} />
              </ShowcaseCard>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Masks, shapes, and steps</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Letter masks, word sequencing, circular pixels, scale animation, and stepped opacity.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 [&_[data-slot=loader-card]]:space-y-3 [&_[data-slot=loader-card]]:rounded-lg [&_[data-slot=loader-card]]:border [&_[data-slot=loader-card]]:border-border [&_[data-slot=loader-card]]:bg-card [&_[data-slot=loader-card]]:p-4">
            <ShowcaseCard title="Letter A" description="Soft mask pulse.">
              <WaveLoader cols={4} rows={4} size="lg" variant="letter" letter="A" />
            </ShowcaseCard>
            <ShowcaseCard title="Strict E" description="Inactive cells stay dim.">
              <WaveLoader cols={4} rows={4} size="lg" variant="letter" letter="E" strictMask />
            </ShowcaseCard>
            <ShowcaseCard title="Word CONVOY" description="Sequential 6x6 character masks with even letter timing.">
              <div className="text-muted-foreground">
                <WaveLoader
                  cols={6}
                  rows={6}
                  size="lg"
                  variant="word"
                  word="CONVOY"
                  strictMask
                  speed={0.7}
                />
              </div>
            </ShowcaseCard>
            <ShowcaseCard title="Stepped mask" description="Two-step opacity for hard pixels.">
              <WaveLoader cols={4} rows={4} size="lg" variant="letter" letter="S" colorSteps={2} />
            </ShowcaseCard>
            <ShowcaseCard title="Circular ripple" description="Round pixels with radial timing.">
              <WaveLoader cols={6} rows={6} size="md" variant="ripple" shape="circle" />
            </ShowcaseCard>
            <ShowcaseCard title="Scaled wave" description="Opacity and scale animate together.">
              <WaveLoader cols={5} rows={5} size="md" variant="wave" animateScale />
            </ShowcaseCard>
            <ShowcaseCard title="Cross dots" description="Circle shape with cross timing.">
              <WaveLoader cols={5} rows={5} size="md" variant="cross" shape="circle" animateScale />
            </ShowcaseCard>
            <ShowcaseCard title="Harsh easing" description="Custom cubic bezier for crisp command states.">
              <WaveLoader
                cols={4}
                rows={4}
                size="lg"
                variant="word"
                word="SANA"
                easing={[0.9, 0, 0.1, 1]}
                strictMask
                speed={0.8}
              />
            </ShowcaseCard>
          </div>
        </section>
      </div>
    </main>
  );
}
