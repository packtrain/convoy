interface EffectiveSidebarWidthArgs {
  containerWidthPx: number;
  requestedSidebarWidthPx: number;
  minArtifactWidthPx: number;
}

/**
 * Width the task-details panel actually gets when an artifact panel is open:
 * the requested width, capped so the artifact keeps a minimum visible width.
 * Keep aligned with the `--task-sidebar-effective-width` CSS formula in
 * `app/o/[organizationSlug]/[projectAlias]/(task-views)/use-project-task-detail-surface.tsx`.
 */
export function getEffectiveSidebarWidthPx({
  containerWidthPx,
  requestedSidebarWidthPx,
  minArtifactWidthPx,
}: EffectiveSidebarWidthArgs): number {
  const safeContainerWidthPx = Math.max(0, containerWidthPx);
  const safeRequestedSidebarWidthPx = Math.max(0, requestedSidebarWidthPx);
  const safeMinArtifactWidthPx = Math.max(0, minArtifactWidthPx);
  const maxSidebarWidthPx = Math.max(0, safeContainerWidthPx - safeMinArtifactWidthPx);

  return Math.min(safeRequestedSidebarWidthPx, maxSidebarWidthPx);
}
