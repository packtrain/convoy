"use client";

import { formatDistanceToNow } from "date-fns";
import { formatAbsoluteTime } from "@/lib/format-relative-time";
import { Activity } from "lucide-react";
import {
  describeActivity,
  isRenderableActivity,
} from "@/components/blocks/activity/activity-item";
import type { ActivityLog } from "@/lib/tasks/types";

/**
 * Consecutive activity rows on one vertical rail, icon per row (OS-1589).
 *
 * The wording comes from `describeActivity` — the same catalog the avatar-attributed
 * activity log renders — so the two can't drift. The difference is placement: this hoists
 * each row's glyph into the rail gutter and attributes per row, not per group.
 */
export function TimelineActivityGroup({ activities }: { activities: ActivityLog[] }) {
  // Retired events render as nothing, so drop them before drawing the rail: a
  // group of only those would otherwise leave a bare vertical line behind.
  const renderable = activities.filter(isRenderableActivity);
  if (renderable.length === 0) return null;

  return (
    <div className="relative py-1 pl-8">
      {/*
        The line is inset from the first and last icon rather than spanning the
        whole block, so it reads as connecting the rows instead of running off
        into the rows above and below.
      */}
      <span aria-hidden className="absolute left-[13px] top-4 bottom-4 w-px bg-border" />
      {renderable.map((activity) => (
        <TimelineActivityRow key={activity._id} activity={activity} />
      ))}
    </div>
  );
}

function TimelineActivityRow({ activity }: { activity: ActivityLog }) {
  const { icon, text } = describeActivity(activity);

  return (
    <div className="flex items-start gap-2 py-1.5">
      {/*
        Absolute with no `top`: `left-1` pins the glyph to the *group's* gutter
        (the rail is the nearest positioned ancestor) while `top: auto` keeps
        its static position, so it lands at this row's own height. Do not make
        this row `relative` — the glyph would then anchor to the row and land
        outside the gutter.

        `bg-background` is load-bearing: the glyph sits on top of the rail line
        and masks it, which is what makes the line read as segmented between
        rows instead of striking through each icon.
      */}
      {/*
        `left-1` + `size-5` define the rail column the rest of the stream aligns
        to — the thread card and the composer triggers both offset themselves
        onto it. Changing either means updating `rail-geometry.ts`, whose test
        asserts the derived values.
      */}
      <span className="absolute left-1 flex size-5 items-center justify-center bg-background text-muted-foreground">
        {/*
          Value-change events (status, priority, type) put their glyph in the
          text as a badge, so the gutter would otherwise be empty and the row
          would lose the rail's alignment. A neutral glyph keeps the column.
        */}
        {icon ?? <Activity className="h-3.5 w-3.5" />}
      </span>
      <p className="flex flex-wrap items-center gap-1.5 text-sm leading-5 text-muted-foreground">
        <span className="text-foreground">{activity.userName}</span>
        {text}
        <span className="whitespace-nowrap text-xs" title={formatAbsoluteTime(activity.createdAt)}>
          · {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
        </span>
      </p>
    </div>
  );
}
