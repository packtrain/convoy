"use client";

import { useState, useMemo, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import {
  DndContext,
  closestCenter,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  MeasuringStrategy,
  MeasuringFrequency,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

// Sortable row component
function SortableRow({
  row,
  children,
}: {
  row: { id: string; original: SimpleTodo };
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.original.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={cn(
        "group border-b border-neutral-100 hover:bg-neutral-50",
        isDragging && "opacity-50 bg-neutral-100"
      )}
    >
      <td className="w-8 p-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1"
        >
          <GripVertical className="h-4 w-4 text-neutral-400 opacity-0 group-hover:opacity-100" />
        </button>
      </td>
      {children}
    </tr>
  );
}

export default function TanstackTableDndPlayground() {
  const [todoCount, setTodoCount] = useState(100);
  const [todos, setTodos] = useState<SimpleTodo[]>(() =>
    generateMockTodos(todoCount)
  );
  const [activeId, setActiveId] = useState<string | null>(null);

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
    }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
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
        const before = currentTodos[newIndex > oldIndex ? newIndex : newIndex - 1];
        const after = currentTodos[newIndex > oldIndex ? newIndex + 1 : newIndex];
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
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
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
              className={cn(
                "px-2 py-1 text-xs rounded-full",
                colors[status]
              )}
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

  const todoIds = useMemo(() => todos.map((t) => t.id), [todos]);
  const activeTodo = activeId ? todos.find((t) => t.id === activeId) : null;

  return (
    <div className="min-h-screen bg-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">
          TanStack Table + dnd-kit Performance Test
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
          </select>
          <span className="text-sm text-neutral-500">
            Open DevTools &gt; Performance to profile
          </span>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          measuring={{
            droppable: {
              strategy: MeasuringStrategy.WhileDragging,
              frequency: MeasuringFrequency.Optimized,
            },
          }}
        >
          <SortableContext
            items={todoIds}
            strategy={verticalListSortingStrategy}
          >
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full border-collapse">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr
                      key={headerGroup.id}
                      className="border-b border-neutral-200 bg-neutral-50"
                    >
                      <th className="w-8 p-2" />
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          className="text-left text-xs font-medium text-neutral-500 p-3"
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <SortableRow key={row.id} row={row}>
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="p-3">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </td>
                      ))}
                    </SortableRow>
                  ))}
                </tbody>
              </table>
            </div>
          </SortableContext>

          <DragOverlay
            dropAnimation={{
              duration: 200,
              easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
            }}
          >
            {activeTodo ? (
              <div className="bg-white border border-neutral-200 shadow-lg rounded px-3 py-2 flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-neutral-400" />
                <span className="text-sm">{activeTodo.name}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
