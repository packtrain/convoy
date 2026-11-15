import type { Id } from "@/convex/_generated/dataModel";
import { TaskLabelChip, TaskLabelPicker } from "@/components/blocks/tasks/task-label-picker";
import type { ProjectLabelSummary } from "@/lib/tasks/types";
import { EmptyValue } from "../badges";

interface LabelCellProps {
  projectId?: Id<"projects">;
  labelId: Id<"projectLabels"> | null;
  /** Shared project labels (rank order) resolved at table level — never per-cell queries. */
  labels: readonly ProjectLabelSummary[];
  labelsById: Map<string, ProjectLabelSummary>;
  onLabelChange: (labelId: Id<"projectLabels"> | null) => void;
  isEditable?: boolean;
}

/** Interactive Label cell: trigger covers the cell and never opens the sidebar. */
export function LabelCell({ projectId, labelId, labels, labelsById, onLabelChange, isEditable = true }: LabelCellProps) {
  const label = labelId ? (labelsById.get(String(labelId)) ?? null) : null;

  if (!isEditable) {
    return (
      <div className="w-full h-9 flex items-center overflow-hidden px-2">
        {label ? <TaskLabelChip label={label} /> : <EmptyValue />}
      </div>
    );
  }

  return (
    <TaskLabelPicker
      projectId={projectId}
      labels={labels}
      value={labelId}
      onChange={onLabelChange}
      align="start"
      trigger={
        <button
          type="button"
          className="cursor-pointer w-full h-9 flex items-center overflow-hidden px-2 focus:outline-none"
          title={label ? `Label: ${label.name}` : "Set label"}
          onClick={(e) => e.stopPropagation()}
        >
          {label ? (
            <TaskLabelChip label={label} />
          ) : (
            <>
              <EmptyValue />
              <span className="sr-only">Set label</span>
            </>
          )}
        </button>
      }
    />
  );
}
