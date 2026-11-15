/**
* The two questions a host asks about a shared thread (OS-1575,
* `docs/specs/cli-thread-sharing.md`). They look like negations and deliberately are not — they
* disagree while `cli.threads.get` is loading, each erring safely: `threadCanWrite` gates
* *firing* a mutation, so an unresolved thread is not-writable (an owner's write is deferred,
* never skipped), while `threadIsReadOnly` gates *hiding* UI, so it is owned (guessing "viewer"
* would strip an owner's composer for a frame on every open).
*/
type ThreadOwnership = { isOwner?: boolean } | null | undefined;

/** True only once the thread has resolved and the caller owns it. */
export function threadCanWrite(thread: ThreadOwnership): boolean {
  return thread?.isOwner === true;
}

/** True only once the thread has resolved and the caller does *not* own it. */
export function threadIsReadOnly(thread: ThreadOwnership): boolean {
  return thread?.isOwner === false;
}
