import { GUIDE_ATTENTION_KINDS, GUIDE_MAX_QUESTIONS, GUIDE_MAX_STEPS, type GuideAttentionKind, type GuideStep } from "../../../lib/contracts/github";

// Guide submit rules (docs/specs/github-integration.md → Guides → Requesting and running).

const MAX_TITLE = 200;
const MAX_EXPLANATION = 4000;
const MAX_NOTE = 500;
/** Under Convex's 1 MiB document limit, with room for the row's other fields. */
const MAX_STEPS_BYTES = 800_000;
/** A Guide missing 2,000 files gets this many lines, then a count. */
const MAX_ERRORS = 50;

/** The changed files at the Guide's revision, as GitHub lists them. */
export type GuideRevision = {
  headSha: string;
  files: { path: string; sha?: string }[];
  /** False when GitHub listed fewer files than the PR changes. */
  complete: boolean;
};

export type GuideValidation = { ok: true; steps: GuideStep[] } | { ok: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const KINDS = new Set<unknown>(GUIDE_ATTENTION_KINDS);
const isKind = (value: unknown): value is GuideAttentionKind => KINDS.has(value);
const KIND_LIST = `${GUIDE_ATTENTION_KINDS.slice(0, -1).join(", ")}, or ${GUIDE_ATTENTION_KINDS.at(-1)}`;

/**
 * Checks a submitted Guide against its revision: its shape, 1 to 8 steps,
 * every changed file in exactly one step. The steps come from the agent as
 * JSON, so nothing about them is trusted. Returns every error at once, each
 * naming its step and path, so the agent can fix them in one pass.
 */
export function validateGuide(input: { headSha: string; steps: unknown[] }, revision: GuideRevision): GuideValidation {
  const errors: string[] = [];
  if (input.headSha !== revision.headSha) {
    errors.push(`This guide is for commit ${revision.headSha}, but the submit names ${input.headSha}. Check out ${revision.headSha} and write the guide for it.`);
  }
  if (input.steps.length < 1 || input.steps.length > GUIDE_MAX_STEPS) {
    errors.push(`A guide has 1 to ${GUIDE_MAX_STEPS} steps; this one has ${input.steps.length}.`);
  }
  const changed = new Map(revision.files.map((file) => [file.path, file.sha]));
  const owner = new Map<string, number>();
  const text = (label: string, value: unknown, max: number) => {
    if (typeof value !== "string") {
      errors.push(`${label} must be text.`);
      return "";
    }
    const trimmed = value.trim();
    if (!trimmed) errors.push(`${label} is empty.`);
    else if (trimmed.length > max) errors.push(`${label} is longer than ${max} characters.`);
    return trimmed;
  };
  const steps: GuideStep[] = [];
  input.steps.forEach((step, index) => {
    const label = `Step ${index + 1}`;
    if (!isRecord(step)) {
      errors.push(`${label} must be an object with a title, an explanation, and files.`);
      return;
    }
    const title = text(`${label}'s title`, step.title, MAX_TITLE);
    const explanation = text(`${label}'s explanation`, step.explanation, MAX_EXPLANATION);
    let attention: GuideStep["attention"];
    if (step.attention !== undefined && step.attention !== null) {
      const kind = isRecord(step.attention) ? step.attention.kind : undefined;
      if (!isKind(kind)) errors.push(`${label}'s attention kind must be ${KIND_LIST}.`);
      else attention = { kind, note: text(`${label}'s attention note`, (step.attention as Record<string, unknown>).note, MAX_NOTE) };
    }
    const rawQuestions = step.questions ?? [];
    let questions: string[] = [];
    if (!Array.isArray(rawQuestions)) errors.push(`${label}'s questions must be a list of text.`);
    else if (rawQuestions.length > GUIDE_MAX_QUESTIONS) errors.push(`${label} has ${rawQuestions.length} questions; the limit is ${GUIDE_MAX_QUESTIONS}.`);
    else questions = rawQuestions.map((question, at) => text(`${label}'s question ${at + 1}`, question, MAX_NOTE));
    const rawFiles = Array.isArray(step.files) ? step.files : [];
    if (step.files !== undefined && !Array.isArray(step.files)) errors.push(`${label}'s files must be a list of objects with a path.`);
    else if (rawFiles.length === 0) errors.push(`${label} has no files.`);
    const files: GuideStep["files"] = [];
    rawFiles.forEach((file, at) => {
      if (!isRecord(file) || typeof file.path !== "string" || !file.path.trim()) {
        errors.push(`${label}'s file ${at + 1} must be an object with a path.`);
        return;
      }
      const path = file.path.trim();
      const earlier = owner.get(path);
      if (earlier === index) errors.push(`${label} lists ${path} twice.`);
      else if (earlier !== undefined) errors.push(`${path} is in step ${earlier + 1} and step ${index + 1}. Put it in one step.`);
      else owner.set(path, index);
      // A path GitHub did not list may be one of the files it left out.
      if (!changed.has(path) && revision.complete) errors.push(`${label} lists ${path}, which this pull request does not change.`);
      const note = file.note === undefined || file.note === null ? undefined : text(`The note on ${path} in ${label.toLowerCase()}`, file.note, MAX_NOTE);
      const sha = changed.get(path);
      files.push({ path, ...(note ? { note } : {}), ...(sha ? { sha } : {}) });
    });
    steps.push({ title, explanation, ...(attention ? { attention } : {}), files, questions });
  });
  for (const path of changed.keys()) {
    if (!owner.has(path)) errors.push(`${path} is not in any step. Every changed file belongs to exactly one step.`);
  }
  if (new TextEncoder().encode(JSON.stringify(steps)).byteLength > MAX_STEPS_BYTES) {
    errors.push("The guide is too large to store. Shorten the explanations and notes.");
  }
  if (errors.length > MAX_ERRORS) {
    return { ok: false, errors: [...errors.slice(0, MAX_ERRORS), `…and ${errors.length - MAX_ERRORS} more.`] };
  }
  return errors.length ? { ok: false, errors } : { ok: true, steps };
}
