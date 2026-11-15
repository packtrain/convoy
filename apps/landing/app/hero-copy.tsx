import type { CSSProperties } from "react";

// One span per letter; `--i` staggers the roll in globals.css.
const rollLetters = (word: string, index: number) => (
  <span key={word} style={{ "--word": index } as CSSProperties}>
    {[...word].map((ch, i) => <span key={i} style={{ "--i": i } as CSSProperties}>{ch}</span>)}
  </span>
);

export function HeroCopy() {
  return (
    <>
      <h1 className="enter mt-7 text-[30px] min-[380px]:text-[36px] font-[450] leading-[0.99] tracking-[-0.045em] text-[#f2f3f5] [text-shadow:0_2px_24px_rgba(8,8,13,0.9)] sm:text-[48px] lg:text-[60px] xl:text-[68px]">
        <span className="block">Your best way of</span>
        <span className="block">
          <span className="sr-only">working</span>
          <span aria-hidden className="word-roll">
            {["working", "building"].map(rollLetters)}
          </span>{" "}with AI.
        </span>
      </h1>
      <p className="enter mt-6 max-w-[60ch] text-[17px] leading-[1.65] text-[#c6cad3] [text-shadow:0_1px_16px_rgba(8,8,13,0.95)] [animation-delay:80ms]">
        Turn your team&apos;s expertise into reusable workflows for AI agents.
        Assign tasks, guide the work, and review results in one place.
      </p>
    </>
  );
}

const processSteps = [
  {
    title: "Build your process",
    body: "Turn your team's expertise into reusable workflows.",
  },
  {
    title: "Share your workflows",
    body: "Let teammates reuse the workflows you've saved.",
  },
  {
    title: "Make it better",
    body: "Bring what you learn into the next run.",
  },
];

export function HeroProcess() {
  return (
    <ol aria-label="How your team works with Convoy" className="enter mt-12 grid divide-y divide-white/10 border-t border-white/10 [text-shadow:0_1px_16px_rgba(8,8,13,0.95)] [animation-delay:200ms] md:mt-14 md:grid-cols-3 md:divide-x md:divide-y-0 md:py-7">
      {processSteps.map((step) => (
        <li key={step.title} className="min-w-0 py-5 md:px-8 md:py-0 md:first:pl-0 md:last:pr-0">
          <h2 className="text-[17px] font-[510] tracking-[-0.015em] text-[#f2f3f5]">
            {step.title}
          </h2>
          <p className="mt-2 max-w-[30ch] text-[14px] leading-relaxed text-[#c6cad3]">
            {step.body}
          </p>
        </li>
      ))}
    </ol>
  );
}
