import type {
  NormalizedChunkRow,
  EventStoreState,
  DeltaPage,
} from "./types";
import { compareChunkOrder } from "@/convex/cli/lib/chunks/chunkOrder";

function dedupKey(row: NormalizedChunkRow): string {
  return `${row.messageId}:${row.chunkOrder}`;
}

function cursorFromRows(
  rows: NormalizedChunkRow[]
): EventStoreState["cursor"] {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  return {
    createdAt: last.createdAt,
    messageId: last.messageId,
    chunkOrder: last.chunkOrder,
  };
}

/** Build initial store state from a full snapshot of chunk rows. */
export function initFromSnapshot(rows: NormalizedChunkRow[]): EventStoreState {
  const dedupKeys = new Set<string>();
  const deduped: NormalizedChunkRow[] = [];

  for (const row of rows) {
    const key = dedupKey(row);
    if (!dedupKeys.has(key)) {
      dedupKeys.add(key);
      deduped.push(row);
    }
  }

  deduped.sort(compareChunkOrder);

  return {
    rows: deduped,
    dedupKeys,
    cursor: cursorFromRows(deduped),
  };
}

/** Merge a delta page into the existing store state. */
export function applyDeltaPage(
  state: EventStoreState,
  deltaPage: DeltaPage
): {
  state: EventStoreState;
  appliedRows: NormalizedChunkRow[];
  appliedCount: number;
} {
  const newRows: NormalizedChunkRow[] = [];
  const newKeys = new Set(state.dedupKeys);

  for (const row of deltaPage.page) {
    const key = dedupKey(row);
    if (!newKeys.has(key)) {
      newKeys.add(key);
      newRows.push(row);
    }
  }

  if (newRows.length === 0) {
    return {
      state: {
        ...state,
        dedupKeys: newKeys,
        cursor: deltaPage.nextCursor ?? state.cursor,
      },
      appliedRows: [],
      appliedCount: 0,
    };
  }

  newRows.sort(compareChunkOrder);

  // Append-only optimization: if all new rows sort after the last existing row,
  // skip the full sort and just append.
  const lastExisting = state.rows[state.rows.length - 1];
  const canAppend =
    !lastExisting || newRows.every((r) => compareChunkOrder(r, lastExisting) > 0);

  let merged: NormalizedChunkRow[];
  if (canAppend) {
    merged = [...state.rows, ...newRows];
  } else {
    merged = [...state.rows, ...newRows];
    merged.sort(compareChunkOrder);
  }

  return {
    state: {
      rows: merged,
      dedupKeys: newKeys,
      cursor: deltaPage.nextCursor ?? cursorFromRows(merged),
    },
    appliedRows: newRows,
    appliedCount: newRows.length,
  };
}
