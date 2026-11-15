"use client";

import { File, PatchDiff } from "@pierre/diffs/react";
import { usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { patchFor, type ChangedFile } from "./fixtures";

export default function DiffView({
  file,
  style,
  wrap,
  whole,
}: {
  file: ChangedFile;
  style: "split" | "unified";
  wrap: boolean;
  whole: boolean;
}) {
  const options = usePatchDiffOptions(style, wrap);
  if (whole)
    return (
      <File
        file={{ name: file.path, contents: file.kind === "deleted" ? file.before : file.after }}
        options={options}
      />
    );
  return <PatchDiff patch={patchFor(file)} options={options} />;
}
