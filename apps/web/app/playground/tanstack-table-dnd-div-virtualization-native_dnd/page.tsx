"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
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
const SCROLL_ZONE = 80; // pixels from edge to trigger scroll
const SCROLL_SPEED = 15; // pixels per frame

export default function TanstackTableDndPlayground() {
  const [todoCount, setTodoCount] = useState(100);
  const [todos, setTodos] = useState<SimpleTodo[]>(() =>
    generateMockTodos(todoCount)
  );
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragImageRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  // Regenerate todos when count changes
  const handleCountChange = (newCount: number) => {
    setTodoCount(newCount);
    setTodos(generateMockTodos(newCount));
  };

  const handleDragStart = useCallback(
    (e: React.DragEvent, id: string) => {
      setDraggedId(id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);

      // Custom drag image
      if (dragImageRef.current) {
        const todo = todos.find((t) => t.id === id);
        if (todo && dragImageRef.current) {
          dragImageRef.current.textContent = todo.name;
          e.dataTransfer.setDragImage(dragImageRef.current, 0, 0);
        }
      }
    },
    [todos]
  );

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverId(id);
  }, []);

  // Auto-scroll when dragging near edges
  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const container = parentRef.current;
    if (!container || !draggedId) return;

    const rect = container.getBoundingClientRect();
    const y = e.clientY - rect.top;

    // Check if near top or bottom edge
    if (y < SCROLL_ZONE) {
      // Scroll up - faster when closer to edge
      const intensity = 1 - y / SCROLL_ZONE;
      const scrollBy = -SCROLL_SPEED * intensity;
      container.scrollTop += scrollBy;
    } else if (y > rect.height - SCROLL_ZONE) {
      // Scroll down - faster when closer to edge
      const intensity = 1 - (rect.height - y) / SCROLL_ZONE;
      const scrollBy = SCROLL_SPEED * intensity;
      container.scrollTop += scrollBy;
    }
  }, [draggedId]);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setOverId(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");

    if (!sourceId || sourceId === targetId) {
      setDraggedId(null);
      setOverId(null);
      return;
    }

    setTodos((currentTodos) => {
      const oldIndex = currentTodos.findIndex((t) => t.id === sourceId);
      const newIndex = currentTodos.findIndex((t) => t.id === targetId);

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

    setDraggedId(null);
    setOverId(null);
  }, []);

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

  return (
    <div className="min-h-screen bg-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">
          TanStack Table + Virtual + Native DnD
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
            Virtualized - only visible rows render
          </span>
        </div>

        {/* Hidden drag image element */}
        <div
          ref={dragImageRef}
          className="fixed -top-[1000px] bg-white border border-neutral-200 shadow-lg rounded px-3 py-2 text-sm"
        />

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
            onDragOver={handleContainerDragOver}
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
                const isDragging = draggedId === todo.id;
                const isOver = overId === todo.id && draggedId !== todo.id;

                return (
                  <div
                    key={row.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, todo.id)}
                    onDragOver={(e) => handleDragOver(e, todo.id)}
                    onDragEnd={handleDragEnd}
                    onDrop={(e) => handleDrop(e, todo.id)}
                    className={cn(
                      "group flex items-center border-b border-neutral-100 hover:bg-neutral-50 absolute left-0 right-0",
                      isDragging && "opacity-50 bg-neutral-100",
                      isOver && "border-t-2 border-t-blue-500"
                    )}
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div className="w-8 p-2 shrink-0 cursor-grab active:cursor-grabbing">
                      <GripVertical className="h-4 w-4 text-neutral-400 opacity-0 group-hover:opacity-100" />
                    </div>
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
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
