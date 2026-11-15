"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  DndContext,
  DragStartEvent,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
} from "@dnd-kit/core";
import { LexoRank } from "lexorank";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

// Simplified Todo type for testing
interface SimpleTodo {
  id: string;
  name: string;
  status: "To Do" | "In Progress" | "Done";
  rank: string;
}

// Generate mock data
function generateMockTodos(count: number): SimpleTodo[] {
  const statuses: SimpleTodo["status"][] = ["To Do", "In Progress", "Done"];
  let rank = LexoRank.middle();

  return Array.from({ length: count }, (_, i) => {
    const todo: SimpleTodo = {
      id: `todo-${i + 1}`,
      name: `Task ${i + 1} - Lorem ipsum dolor sit amet`,
      status: statuses[i % 3],
      rank: rank.toString(),
    };
    rank = rank.genNext();
    return todo;
  });
}

const columnHelper = createColumnHelper<SimpleTodo>();

const ROW_HEIGHT = 44;
const SCROLL_ZONE = 80;
const SCROLL_SPEED = 15;

// Draggable + Droppable row component
function DraggableRow({
  id,
  virtualStart,
  height,
  children,
  isDragActive,
}: {
  id: string;
  virtualStart: number;
  height: number;
  children: React.ReactNode;
  isDragActive: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id });

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });

  // Combine refs
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef]
  );

  return (
    <div
      ref={setRefs}
      style={{
        height,
        transform: `translateY(${virtualStart}px)`,
      }}
      className={cn(
        "group flex items-center border-b border-neutral-100 hover:bg-neutral-50 absolute left-0 right-0 bg-white",
        isDragging && "opacity-30",
        isOver && isDragActive && !isDragging && "border-t-2 border-t-blue-500"
      )}
    >
      <div className="w-8 p-2 shrink-0">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1"
        >
          <GripVertical className="h-4 w-4 text-neutral-400 opacity-0 group-hover:opacity-100" />
        </button>
      </div>
      {children}
    </div>
  );
}

export default function TanstackTableDndPlayground() {
  const [todoCount, setTodoCount] = useState(100);
  const [todos, setTodos] = useState<SimpleTodo[]>(() =>
    generateMockTodos(todoCount)
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollIntervalRef = useRef<number | null>(null);

  // Track cursor position for custom drag overlay
  useEffect(() => {
    if (!activeId) return;

    const handlePointerMove = (e: PointerEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [activeId]);

  // Regenerate todos when count changes
  const handleCountChange = (newCount: number) => {
    setTodoCount(newCount);
    setTodos(generateMockTodos(newCount));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Auto-scroll during drag
  const startAutoScroll = useCallback(() => {
    if (scrollIntervalRef.current) return;

    let lastY = 0;
    const onPointerMove = (e: PointerEvent) => {
      lastY = e.clientY;
    };
    window.addEventListener("pointermove", onPointerMove);

    scrollIntervalRef.current = window.setInterval(() => {
      const container = parentRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const y = lastY - rect.top;

      if (y > 0 && y < SCROLL_ZONE) {
        const intensity = 1 - y / SCROLL_ZONE;
        container.scrollTop -= SCROLL_SPEED * intensity;
      } else if (y > rect.height - SCROLL_ZONE && y < rect.height) {
        const intensity = 1 - (rect.height - y) / SCROLL_ZONE;
        container.scrollTop += SCROLL_SPEED * intensity;
      }
    }, 16);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveId(event.active.id as string);
      startAutoScroll();
    },
    [startAutoScroll]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      stopAutoScroll();
      setActiveId(null);

      if (!over || active.id === over.id) return;

      setTodos((currentTodos) => {
        const oldIndex = currentTodos.findIndex((t) => t.id === active.id);
        const newIndex = currentTodos.findIndex((t) => t.id === over.id);

        if (oldIndex === -1 || newIndex === -1) return currentTodos;

        // Calculate new rank
        let newRank: string;
        if (newIndex === 0) {
          newRank = LexoRank.parse(currentTodos[0].rank).genPrev().toString();
        } else if (newIndex === currentTodos.length - 1) {
          newRank = LexoRank.parse(currentTodos[currentTodos.length - 1].rank)
            .genNext()
            .toString();
        } else {
          const before =
            currentTodos[newIndex > oldIndex ? newIndex : newIndex - 1];
          const after =
            currentTodos[newIndex > oldIndex ? newIndex + 1 : newIndex];
          newRank = LexoRank.parse(before.rank)
            .between(LexoRank.parse(after.rank))
            .toString();
        }

        // Create new array with updated item
        const newTodos = [...currentTodos];
        const [movedItem] = newTodos.splice(oldIndex, 1);
        newTodos.splice(newIndex, 0, { ...movedItem, rank: newRank });

        return newTodos;
      });
    },
    [stopAutoScroll]
  );

  const handleDragCancel = useCallback(() => {
    stopAutoScroll();
    setActiveId(null);
  }, [stopAutoScroll]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: () => (
          <span>
            Task <span className="text-neutral-400">{todos.length}</span>
          </span>
        ),
        cell: ({ getValue }) => (
          <span className="text-sm text-neutral-900">{getValue()}</span>
        ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => {
          const status = getValue();
          const colors = {
            "To Do": "bg-neutral-100 text-neutral-700",
            "In Progress": "bg-blue-100 text-blue-700",
            Done: "bg-green-100 text-green-700",
          };
          return (
            <span
              className={cn("px-2 py-1 text-xs rounded-full", colors[status])}
            >
              {status}
            </span>
          );
        },
      }),
    ],
    [todos.length]
  );

  const table = useReactTable({
    data: todos,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  const { rows } = table.getRowModel();

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const activeTodo = activeId ? todos.find((t) => t.id === activeId) : null;

  return (
    <div className="min-h-screen bg-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">
          TanStack Table + Virtual + dnd-kit (v2)
        </h1>

        <div className="mb-6 flex items-center gap-4">
          <label className="text-sm font-medium">Number of todos:</label>
          <select
            value={todoCount}
            onChange={(e) => handleCountChange(Number(e.target.value))}
            className="border rounded px-3 py-1.5 text-sm"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
            <option value={5000}>5000</option>
            <option value={10000}>10000</option>
          </select>
          <span className="text-sm text-neutral-500">
            Virtualized with dnd-kit + auto-scroll
          </span>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="border rounded-lg overflow-hidden">
            {/* Header */}
            {table.getHeaderGroups().map((headerGroup) => (
              <div
                key={headerGroup.id}
                className="flex items-center border-b border-neutral-200 bg-neutral-50"
              >
                <div className="w-8 p-2 shrink-0" />
                {headerGroup.headers.map((header) => (
                  <div
                    key={header.id}
                    className={cn(
                      "text-left text-xs font-medium text-neutral-500 p-3",
                      header.id === "name" && "flex-1",
                      header.id === "status" && "w-32"
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </div>
                ))}
              </div>
            ))}

            {/* Virtualized Body */}
            <div
              ref={parentRef}
              className="overflow-auto"
              style={{ height: "600px" }}
            >
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  const todo = row.original;

                  return (
                    <DraggableRow
                      key={row.id}
                      id={todo.id}
                      virtualStart={virtualRow.start}
                      height={virtualRow.size}
                      isDragActive={!!activeId}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <div
                          key={cell.id}
                          className={cn(
                            "p-3",
                            cell.column.id === "name" && "flex-1",
                            cell.column.id === "status" && "w-32"
                          )}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </div>
                      ))}
                    </DraggableRow>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Custom drag overlay that follows cursor */}
          {activeTodo && (
            <div
              className="fixed pointer-events-none z-50 bg-white border border-neutral-200 shadow-lg rounded px-3 py-2 flex items-center gap-2"
              style={{
                left: cursorPos.x + 12,
                top: cursorPos.y + 12,
              }}
            >
              <GripVertical className="h-4 w-4 text-neutral-400" />
              <span className="text-sm">{activeTodo.name}</span>
            </div>
          )}
        </DndContext>
      </div>
    </div>
  );
}
