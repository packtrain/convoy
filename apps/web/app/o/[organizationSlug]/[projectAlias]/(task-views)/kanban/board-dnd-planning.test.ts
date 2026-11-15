import { describe, expect, test } from "vitest";
import { LexoRank } from "lexorank";
import {
  boardCardDropId,
  boardCardIntoDropId,
  boardColumnBodyDropId,
  boardColumnTopDropId,
  boardTaskDragId,
  getBoardMoveUpdates,
  isPointWithinRect,
  parseBoardDropId,
  parseBoardTaskDragId,
  planBoardColumnReorder,
  planBoardDrop,
  planBoardKeyboardTarget,
  type BoardDropColumn,
  type BoardKeyboardZone,
} from "./board-dnd-planning";

function makeColumn(
  id: string,
  taskIds: string[],
  dropTarget?: BoardDropColumn["dropTarget"]
): BoardDropColumn {
  return {
    id,
    cards: taskIds.map((taskId) => ({ task: { _id: taskId } })),
    ...(dropTarget ? { dropTarget } : {}),
  };
}

describe("board dnd ids", () => {
  test("round-trips task drag ids", () => {
    expect(parseBoardTaskDragId(boardTaskDragId("task-1"))).toBe("task-1");
  });

  test("rejects non-drag ids", () => {
    expect(parseBoardTaskDragId("card:task-1:before")).toBeNull();
  });

  test("round-trips card drop ids", () => {
    expect(parseBoardDropId(boardCardDropId("task-1", "before"))).toEqual({
      type: "card",
      targetTaskId: "task-1",
      position: "before",
    });
    expect(parseBoardDropId(boardCardDropId("task-1", "after"))).toEqual({
      type: "card",
      targetTaskId: "task-1",
      position: "after",
    });
  });

  test("round-trips column drop ids with colons in the column id", () => {
    expect(parseBoardDropId(boardColumnTopDropId("assignee:user-1"))).toEqual({
      type: "group-top",
      columnId: "assignee:user-1",
    });
    expect(parseBoardDropId(boardColumnBodyDropId("assignee:user-1"))).toEqual({
      type: "group-bottom",
      columnId: "assignee:user-1",
    });
  });

  test("round-trips card-into drop ids", () => {
    expect(parseBoardDropId(boardCardIntoDropId("task-1"))).toEqual({
      type: "card-into",
      targetTaskId: "task-1",
    });
  });

  test("rejects unknown drop ids", () => {
    expect(parseBoardDropId("task:task-1")).toBeNull();
    expect(parseBoardDropId("card:task-1:middle")).toBeNull();
    expect(parseBoardDropId("something-else")).toBeNull();
  });
});

describe("isPointWithinRect", () => {
  test("detects points inside and outside a rect", () => {
    const rect = { top: 100, left: 50, width: 200, height: 80 };

    expect(isPointWithinRect({ x: 150, y: 140 }, rect)).toBe(true);
    expect(isPointWithinRect({ x: 50, y: 100 }, rect)).toBe(true);
    expect(isPointWithinRect({ x: 250, y: 180 }, rect)).toBe(true);
    expect(isPointWithinRect({ x: 49, y: 140 }, rect)).toBe(false);
    expect(isPointWithinRect({ x: 150, y: 181 }, rect)).toBe(false);
  });
});

describe("planBoardDrop", () => {
  const columns: BoardDropColumn[] = [
    makeColumn("todo", ["a", "b", "c"], { status: "To Do" }),
    makeColumn("in-progress", ["d", "e"], { status: "In Progress" }),
    makeColumn("blocked", [], { status: "Blocked" }),
    makeColumn("done", ["f"]),
  ];

  test("plans a same-group reorder before a card", () => {
    expect(
      planBoardDrop({
        sourceTaskId: "c",
        dropId: boardCardDropId("a", "before"),
        columns,
      })
    ).toEqual({
      kind: "reorder",
      rankTarget: { targetTaskId: "a", position: "before" },
    });
  });

  test("maps same-group top and bottom drops to the visible edge cards", () => {
    expect(
      planBoardDrop({
        sourceTaskId: "b",
        dropId: boardColumnTopDropId("todo"),
        columns,
      })
    ).toEqual({
      kind: "reorder",
      rankTarget: { targetTaskId: "a", position: "before" },
    });
    expect(
      planBoardDrop({
        sourceTaskId: "b",
        dropId: boardColumnBodyDropId("todo"),
        columns,
      })
    ).toEqual({
      kind: "reorder",
      rankTarget: { targetTaskId: "c", position: "after" },
    });
  });

  test("returns null when dropping a card onto itself", () => {
    expect(
      planBoardDrop({
        sourceTaskId: "a",
        dropId: boardCardDropId("a", "after"),
        columns,
      })
    ).toBeNull();
  });

  test("returns null for visible-order no-ops next to adjacent cards", () => {
    expect(
      planBoardDrop({
        sourceTaskId: "a",
        dropId: boardCardDropId("b", "before"),
        columns,
      })
    ).toBeNull();
    expect(
      planBoardDrop({
        sourceTaskId: "b",
        dropId: boardCardDropId("a", "after"),
        columns,
      })
    ).toBeNull();
  });

  test("returns null when the source is already at the dropped group edge", () => {
    expect(
      planBoardDrop({
        sourceTaskId: "a",
        dropId: boardColumnTopDropId("todo"),
        columns,
      })
    ).toBeNull();
    expect(
      planBoardDrop({
        sourceTaskId: "c",
        dropId: boardColumnBodyDropId("todo"),
        columns,
      })
    ).toBeNull();
  });

  test("plans a cross-group move with a rank target", () => {
    expect(
      planBoardDrop({
        sourceTaskId: "a",
        dropId: boardCardDropId("e", "before"),
        columns,
      })
    ).toEqual({
      kind: "move",
      fieldUpdates: { status: "In Progress" },
      rankTarget: { targetTaskId: "e", position: "before" },
    });
  });

  test("maps cross-group top and bottom drops to the visible edge cards", () => {
    expect(
      planBoardDrop({
        sourceTaskId: "a",
        dropId: boardColumnTopDropId("in-progress"),
        columns,
      })
    ).toEqual({
      kind: "move",
      fieldUpdates: { status: "In Progress" },
      rankTarget: { targetTaskId: "d", position: "before" },
    });
    expect(
      planBoardDrop({
        sourceTaskId: "a",
        dropId: boardColumnBodyDropId("in-progress"),
        columns,
      })
    ).toEqual({
      kind: "move",
      fieldUpdates: { status: "In Progress" },
      rankTarget: { targetTaskId: "e", position: "after" },
    });
  });

  test("drops into an empty group update only the grouping field", () => {
    expect(
      planBoardDrop({
        sourceTaskId: "a",
        dropId: boardColumnBodyDropId("blocked"),
        columns,
      })
    ).toEqual({
      kind: "move",
      fieldUpdates: { status: "Blocked" },
    });
    expect(
      planBoardDrop({
        sourceTaskId: "a",
        dropId: boardColumnTopDropId("blocked"),
        columns,
      })
    ).toEqual({
      kind: "move",
      fieldUpdates: { status: "Blocked" },
    });
  });

  test("returns null for cross-group drops into a non-droppable group", () => {
    expect(
      planBoardDrop({
        sourceTaskId: "a",
        dropId: boardColumnBodyDropId("done"),
        columns,
      })
    ).toBeNull();
    expect(
      planBoardDrop({
        sourceTaskId: "a",
        dropId: boardCardDropId("f", "before"),
        columns,
      })
    ).toBeNull();
  });

  test("still allows same-group reorder inside a non-droppable group", () => {
    const reorderColumns = [
      makeColumn("done", ["f", "g"]),
      makeColumn("todo", ["a"], { status: "To Do" }),
    ];
    expect(
      planBoardDrop({
        sourceTaskId: "g",
        dropId: boardCardDropId("f", "before"),
        columns: reorderColumns,
      })
    ).toEqual({
      kind: "reorder",
      rankTarget: { targetTaskId: "f", position: "before" },
    });
  });

  test("plans make-subtask for center drops onto another card", () => {
    // Same column and cross-column targets both work, including cards in
    // non-droppable groups (reparenting does not touch the grouping field).
    expect(
      planBoardDrop({ sourceTaskId: "a", dropId: boardCardIntoDropId("b"), columns })
    ).toEqual({ kind: "make-subtask", parentTaskId: "b" });
    expect(
      planBoardDrop({ sourceTaskId: "a", dropId: boardCardIntoDropId("e"), columns })
    ).toEqual({ kind: "make-subtask", parentTaskId: "e" });
    expect(
      planBoardDrop({ sourceTaskId: "a", dropId: boardCardIntoDropId("f"), columns })
    ).toEqual({ kind: "make-subtask", parentTaskId: "f" });
  });

  test("returns null for center drops onto self or unknown cards", () => {
    expect(
      planBoardDrop({ sourceTaskId: "a", dropId: boardCardIntoDropId("a"), columns })
    ).toBeNull();
    expect(
      planBoardDrop({ sourceTaskId: "a", dropId: boardCardIntoDropId("missing"), columns })
    ).toBeNull();
  });

  test("returns null for unknown sources, targets, and drop ids", () => {
    expect(
      planBoardDrop({ sourceTaskId: "missing", dropId: boardCardDropId("a", "before"), columns })
    ).toBeNull();
    expect(
      planBoardDrop({ sourceTaskId: "a", dropId: boardCardDropId("missing", "before"), columns })
    ).toBeNull();
    expect(
      planBoardDrop({ sourceTaskId: "a", dropId: boardColumnBodyDropId("missing"), columns })
    ).toBeNull();
    expect(planBoardDrop({ sourceTaskId: "a", dropId: "nonsense", columns })).toBeNull();
  });
});

describe("two-axis cells", () => {
  const cell = (
    id: string,
    taskIds: string[],
    row: [string, BoardDropColumn["dropTarget"]],
    column: [string, BoardDropColumn["dropTarget"]]
  ): BoardDropColumn => ({
    ...makeColumn(id, taskIds),
    axes: [
      { groupId: row[0], dropTarget: row[1] },
      { groupId: column[0], dropTarget: column[1] },
    ],
  });
  const planning = { status: "Planning" as const };
  const sectionA = { sectionId: "section-a" as never };
  const sectionB = { sectionId: "section-b" as never };
  const done = { status: "Done" as const };

  test("a row change keeps the column field, so a multi-status bucket keeps its actual status", () => {
    const source = cell("a|planning", ["task-1"], ["a", sectionA], ["planning", planning]);
    const target = cell("b|planning", ["task-2"], ["b", sectionB], ["planning", planning]);
    expect(
      planBoardDrop({
        sourceTaskId: "task-1",
        dropId: boardCardDropId("task-2", "after"),
        columns: [source, target],
      })
    ).toEqual({
      kind: "move",
      fieldUpdates: sectionB,
      rankTarget: { targetTaskId: "task-2", position: "after" },
    });
  });

  test("a diagonal drop writes both axes", () => {
    const source = cell("a|planning", ["task-1"], ["a", sectionA], ["planning", planning]);
    const target = cell("b|done", [], ["b", sectionB], ["done", done]);
    expect(getBoardMoveUpdates(source, target)).toEqual({ ...sectionB, ...done });
  });

  test("a changed axis without a payload refuses the drop; an unchanged one does not matter", () => {
    const source = cell("stale|planning", ["task-1"], ["stale", undefined], ["planning", planning]);
    const sameRow = cell("stale|done", [], ["stale", undefined], ["done", done]);
    const otherRow = cell("stale2|planning", [], ["stale2", undefined], ["planning", planning]);
    expect(getBoardMoveUpdates(source, sameRow)).toEqual(done);
    expect(getBoardMoveUpdates(source, otherRow)).toBeUndefined();
    expect(
      planBoardDrop({
        sourceTaskId: "task-1",
        dropId: boardColumnBodyDropId("stale2|planning"),
        columns: [source, sameRow, otherRow],
      })
    ).toBeNull();
  });
});

describe("planBoardColumnReorder", () => {
  const rankA = LexoRank.middle();
  const rankB = rankA.genNext();
  const rankC = rankB.genNext();
  const orderedRanks = [
    { id: "a", rank: rankA.toString() },
    { id: "b", rank: rankB.toString() },
    { id: "c", rank: rankC.toString() },
  ];

  test("moving right lands between the target and its right neighbor", () => {
    const plan = planBoardColumnReorder({
      orderedRanks,
      draggedLabelId: "a",
      targetLabelId: "b",
      side: "right",
    });

    expect(plan).not.toBeNull();
    expect(LexoRank.parse(plan!.rank).compareTo(rankB)).toBeGreaterThan(0);
    expect(LexoRank.parse(plan!.rank).compareTo(rankC)).toBeLessThan(0);
  });

  test("moving left lands before the target", () => {
    const plan = planBoardColumnReorder({
      orderedRanks,
      draggedLabelId: "c",
      targetLabelId: "a",
      side: "left",
    });

    expect(plan).not.toBeNull();
    expect(LexoRank.parse(plan!.rank).compareTo(rankA)).toBeLessThan(0);
  });

  test("dropping around the leading No label column means the start of the list", () => {
    const plan = planBoardColumnReorder({
      orderedRanks,
      draggedLabelId: "c",
      targetLabelId: null,
      side: "right",
    });

    expect(plan).not.toBeNull();
    expect(LexoRank.parse(plan!.rank).compareTo(rankA)).toBeLessThan(0);
  });

  test("no-op drops and unknown ids return null", () => {
    // Dropping on the immediate right neighbor's left side keeps the position.
    expect(
      planBoardColumnReorder({ orderedRanks, draggedLabelId: "a", targetLabelId: "b", side: "left" })
    ).toBeNull();
    expect(
      planBoardColumnReorder({ orderedRanks, draggedLabelId: "missing", targetLabelId: "b", side: "left" })
    ).toBeNull();
    expect(
      planBoardColumnReorder({ orderedRanks, draggedLabelId: "a", targetLabelId: "missing", side: "left" })
    ).toBeNull();
  });
});

describe("planBoardKeyboardTarget", () => {
  // Two 100px-wide columns; column "todo" holds cards a (0-40) and b (50-90).
  const zones: BoardKeyboardZone[] = [
    { id: boardColumnBodyDropId("todo"), rect: { left: 0, top: 0, width: 100, height: 400 } },
    { id: boardColumnTopDropId("todo"), rect: { left: 0, top: 0, width: 100, height: 10 } },
    { id: boardCardDropId("a", "before"), rect: { left: 0, top: 10, width: 100, height: 20 } },
    { id: boardCardDropId("a", "after"), rect: { left: 0, top: 30, width: 100, height: 20 } },
    { id: boardCardDropId("b", "before"), rect: { left: 0, top: 50, width: 100, height: 20 } },
    { id: boardCardDropId("b", "after"), rect: { left: 0, top: 70, width: 100, height: 20 } },
    { id: boardCardIntoDropId("b"), rect: { left: 0, top: 60, width: 100, height: 20 } },
    { id: boardColumnBodyDropId("done"), rect: { left: 120, top: 0, width: 100, height: 400 } },
  ];

  test("down moves to the next card's after zone in the same column", () => {
    expect(planBoardKeyboardTarget({ direction: "down", center: { x: 50, y: 20 }, zones })).toEqual({
      x: 50,
      y: 40,
    });
    expect(planBoardKeyboardTarget({ direction: "down", center: { x: 50, y: 40 }, zones })).toEqual({
      x: 50,
      y: 80,
    });
  });

  test("up moves to the previous before zone and stops at the top", () => {
    expect(planBoardKeyboardTarget({ direction: "up", center: { x: 50, y: 80 }, zones })).toEqual({
      x: 50,
      y: 60,
    });
    expect(planBoardKeyboardTarget({ direction: "up", center: { x: 50, y: 20 }, zones })).toBeNull();
  });

  test("right moves into the next column, into its body when it has no cards", () => {
    const target = planBoardKeyboardTarget({ direction: "right", center: { x: 50, y: 40 }, zones });

    expect(target?.x).toBe(170);
    expect(target?.y).toBeGreaterThan(10);
    expect(planBoardKeyboardTarget({ direction: "right", center: { x: 170, y: 40 }, zones })).toBeNull();
  });

  test("left lands on the nearest card edge of the previous column", () => {
    expect(planBoardKeyboardTarget({ direction: "left", center: { x: 170, y: 58 }, zones })).toEqual({
      x: 50,
      y: 60,
    });
  });
});
