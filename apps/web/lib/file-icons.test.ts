import { describe, expect, test } from "vitest";
import { fileIconSrc, folderIconSrc } from "./file-icons";

describe("file icons", () => {
  test("maps names case-insensitively and falls back to the default file icon", () => {
    expect(fileIconSrc("App.TSX")).toBe("/file-icons/file_type_reactts.svg");
    expect(fileIconSrc("Dockerfile")).toBe("/file-icons/file_type_docker.svg");
    expect(fileIconSrc("weird.xyz")).toBe("/file-icons/default_file.svg");
  });

  test("uses the last segment of a joined folder and the opened variant", () => {
    expect(folderIconSrc("apps/web/src", false)).toBe("/file-icons/folder_type_src.svg");
    expect(folderIconSrc("apps/web/src", true)).toBe("/file-icons/folder_type_src_opened.svg");
    expect(folderIconSrc("whatever", false)).toBe("/file-icons/default_folder.svg");
  });
});
