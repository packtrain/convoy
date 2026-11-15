/**
 * Fluent batch join for enriching rows with related documents. Replaces the
 * `Promise.all(items.map(async ...))` + null-filter pattern with a declarative
 * chain that dedupes keys and calls the loader once.
 *
 * ```ts
 * // Inner join — rows whose related doc is missing are dropped
 * const organizations = await join(memberships)
 *   .on((m) => m.organizationId)
 *   .with((ids) => getActiveOrganizationsByIds(ctx, ids))
 *   .select((membership, org) => ({ ...org, role: membership.role }));
 *
 * // Left join — keeps every row; `related` is null when missing
 * const invitations = await join(pendingInvitations)
 *   .on((inv) => inv.invitedBy)
 *   .with((ids) => getUsersByIds(ctx, ids))
 *   .selectAll((inv, inviter) => ({ ...inv, inviterName: inviter?.name ?? null }));
 * ```
 *
 * Loader contract: `.with()` receives the deduped keys (first-seen order) and
 * must return an array aligned by index, with `null`/`undefined` for misses —
 * the shape repo helpers like `getActiveOrganizationsByIds` already produce.
 */
export function join<T>(items: readonly T[]): JoinSource<T> {
  return new JoinSource(items);
}

class JoinSource<T> {
  constructor(private readonly items: readonly T[]) {}

  /** Extracts the foreign key from each row. `null`/`undefined` keys mean "no match". */
  on<K>(key: (item: T) => K | null | undefined): JoinOn<T, K> {
    return new JoinOn(this.items, key);
  }
}

class JoinOn<T, K> {
  constructor(
    private readonly items: readonly T[],
    private readonly key: (item: T) => K | null | undefined
  ) {}

  /**
   * Batch loader for the related documents. Called once with the deduped keys;
   * must return results aligned by index (`null`/`undefined` for misses).
   */
  with<R>(load: (keys: K[]) => Promise<readonly (R | null | undefined)[]>): JoinWith<T, K, R> {
    return new JoinWith(this.items, this.key, load);
  }
}

class JoinWith<T, K, R> {
  constructor(
    private readonly items: readonly T[],
    private readonly key: (item: T) => K | null | undefined,
    private readonly load: (keys: K[]) => Promise<readonly (R | null | undefined)[]>
  ) {}

  /** Inner join — rows whose related doc is missing are dropped. */
  async select<S>(project: (item: T, related: NonNullable<R>) => S): Promise<Awaited<S>[]> {
    const rows = await this.resolve();
    return Promise.all(
      rows
        .filter((row): row is { item: T; related: NonNullable<R> } => row.related !== null)
        .map((row) => project(row.item, row.related))
    );
  }

  /** Left join — keeps every row; `related` is `null` when missing. */
  async selectAll<S>(project: (item: T, related: NonNullable<R> | null) => S): Promise<Awaited<S>[]> {
    const rows = await this.resolve();
    return Promise.all(rows.map((row) => project(row.item, row.related)));
  }

  private async resolve(): Promise<Array<{ item: T; related: NonNullable<R> | null }>> {
    if (this.items.length === 0) {
      return [];
    }

    const keyed = this.items.map((item) => ({ item, key: this.key(item) }));

    const uniqueKeys: K[] = [];
    const seen = new Set<K>();
    for (const { key } of keyed) {
      if (key === null || key === undefined || seen.has(key)) continue;
      seen.add(key);
      uniqueKeys.push(key);
    }

    const loaded = uniqueKeys.length === 0 ? [] : await this.load(uniqueKeys);
    if (loaded.length !== uniqueKeys.length) {
      throw new Error(`join: loader returned ${loaded.length} results for ${uniqueKeys.length} keys; results must align with keys`);
    }

    const relatedByKey = new Map<K, NonNullable<R>>();
    uniqueKeys.forEach((key, index) => {
      const related = loaded[index];
      if (related !== null && related !== undefined) {
        relatedByKey.set(key, related);
      }
    });

    return keyed.map(({ item, key }) => ({
      item,
      related: key === null || key === undefined ? null : (relatedByKey.get(key) ?? null),
    }));
  }
}
