/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, test, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskAttachment } from "@/lib/tasks/types";
import { TaskArtifactsSection } from "./task-artifacts-section";
import { downloadFile } from "@/lib/tasks/files";
import { RESOURCE_DRAG_MIME } from "@/lib/tasks/resource-drag";

const navigationMocks = vi.hoisted(() => ({
  params: { organizationSlug: "acme", projectAlias: "OS" } as Record<
    string,
    string
  > | null,
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigationMocks.params,
  usePathname: () => "/o/acme/OS",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/components/blocks/tasks/attachment-lightbox", () => ({
  AttachmentLightbox: ({
    open,
    slides,
    initialIndex,
    onClose,
    onDownload,
  }: {
    open: boolean;
    slides: Array<{ fileName: string; type?: string }>;
    initialIndex: number;
    onClose: () => void;
    onDownload: (index: number) => void;
  }) =>
    open ? (
      <div>
        <h2>Attachment preview</h2>
        <div data-testid="slide-count">{slides.length}</div>
        <div data-testid="initial-index">{initialIndex}</div>
        <div data-testid="selected-slide">{slides[initialIndex]?.fileName}</div>
        <div data-testid="selected-slide-type">
          {slides[initialIndex]?.type ?? "image"}
        </div>
        <button type="button" onClick={() => onDownload(initialIndex)}>
          Download slide
        </button>
        <button type="button" onClick={onClose}>
          Close preview
        </button>
      </div>
    ) : null,
}));

vi.mock("@/lib/tasks/files", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tasks/files")>(
    "@/lib/tasks/files"
  );
  return {
    ...actual,
    downloadFile: vi.fn().mockResolvedValue(true),
  };
});

function artifactId(value: string): Id<"taskArtifacts"> {
  return value as Id<"taskArtifacts">;
}

const baseAttachment: TaskAttachment = {
  _id: "attachment_1",
  taskId: "task_1",
  storageId: "storage_1",
  fileName: "notes.pdf",
  fileSize: 1234,
  contentType: "application/pdf",
  uploadedBy: "user_1",
  uploadedAt: 1000,
  url: "https://example.com/notes.pdf",
};

const baseImageAttachment: TaskAttachment = {
  ...baseAttachment,
  _id: "attachment_image_1",
  storageId: "storage_image_1",
  fileName: "preview.png",
  contentType: "image/png",
  url: "https://example.com/preview.png",
};

const secondImageAttachment: TaskAttachment = {
  ...baseAttachment,
  _id: "attachment_image_2",
  storageId: "storage_image_2",
  fileName: "second-preview.png",
  contentType: "image/png",
  url: "https://example.com/second-preview.png",
};

const videoAttachment: TaskAttachment = {
  ...baseAttachment,
  _id: "attachment_video_1",
  storageId: "storage_video_1",
  fileName: "demo.mp4",
  contentType: "video/mp4",
  url: "https://example.com/demo.mp4",
};

describe("TaskArtifactsSection", () => {
  afterEach(() => {
    navigationMocks.params = { organizationSlug: "acme", projectAlias: "OS" };
    vi.clearAllMocks();
    cleanup();
  });

  test("renders empty state", () => {
    render(
      <TaskArtifactsSection
        attachments={[]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={[]}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
        onCreateArtifact={vi.fn()}
      />
    );

    expect(screen.getByText(/drop files here/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /create an artifact/i })).toBeDefined();
  });

  test("highlights selected artifact and handles click", () => {
    const onSelectArtifact = vi.fn();
    const artifacts = [
      { _id: artifactId("artifact_1"), name: "Plan", createdAt: 1000 },
      { _id: artifactId("artifact_2"), name: "Review", createdAt: 2000 },
    ];

    render(
      <TaskArtifactsSection
        attachments={[]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={artifacts}
        selectedArtifactId={"artifact_2"}
        onSelectArtifact={onSelectArtifact}
        onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
        onCreateArtifact={vi.fn()}
      />
    );

    const reviewLink = screen.getByRole("link", { name: /review/i });
    expect(reviewLink.closest('[data-slot="pill"]')?.className).toContain(
      "bg-muted"
    );

    const planLink = screen.getByRole("link", { name: /plan/i });
    fireEvent.click(planLink);

    expect(onSelectArtifact).toHaveBeenCalledWith("artifact_1");
  });

  // The pill is a link to the full page so middle click / ⌘-click work; a plain
  // click opens the panel instead (docs/specs/task-artifacts.md).
  test("links the pill to the artifact page and leaves modified clicks alone", () => {
    const onSelectArtifact = vi.fn();

    render(
      <TaskArtifactsSection
        attachments={[]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={[{ _id: artifactId("artifact_1"), name: "Plan", createdAt: 1000 }]}
        selectedArtifactId={null}
        onSelectArtifact={onSelectArtifact}
        onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
        onCreateArtifact={vi.fn()}
      />
    );

    const link = screen.getByRole("link", { name: /plan/i });
    expect(link.getAttribute("href")).toBe("/o/acme/OS/artifacts/artifact_1");
    // The pill's hover styling keys off `a[data-slot=pill-content]`.
    expect(link.getAttribute("data-slot")).toBe("pill-content");

    fireEvent.click(link, { metaKey: true });
    expect(onSelectArtifact).not.toHaveBeenCalled();
  });

  test("right-click menu opens the artifact page and copies its ID", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <TaskArtifactsSection
        attachments={[]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={[{ _id: artifactId("artifact_1"), name: "Plan", createdAt: 1000 }]}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
        onCreateArtifact={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByRole("link", { name: /plan/i }));

    const openItem = await screen.findByRole("menuitem", {
      name: "Open in new page",
    });
    expect(openItem.getAttribute("href")).toBe("/o/acme/OS/artifacts/artifact_1");
    expect(openItem.getAttribute("target")).toBe("_blank");

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy ID" }));

    expect(writeText).toHaveBeenCalledWith("artifact_1");
  });

  test("renders a non-link pill without project route params", () => {
    navigationMocks.params = null;
    const onSelectArtifact = vi.fn();

    render(
      <TaskArtifactsSection
        attachments={[]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={[{ _id: artifactId("artifact_1"), name: "Plan", createdAt: 1000 }]}
        selectedArtifactId={null}
        onSelectArtifact={onSelectArtifact}
        onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
        onCreateArtifact={vi.fn()}
      />
    );

    expect(screen.queryByRole("link", { name: /plan/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /plan/i }));

    expect(onSelectArtifact).toHaveBeenCalledWith("artifact_1");
  });

  // Archived tasks are read-only, not unreadable: the panel still opens
  // (docs/specs/task-artifacts.md).
  test("opens an artifact when disabled, without mutation controls", () => {
    const onSelectArtifact = vi.fn();

    render(
      <TaskArtifactsSection
        attachments={[]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={[{ _id: artifactId("artifact_1"), name: "Plan", createdAt: 1000 }]}
        selectedArtifactId={null}
        onSelectArtifact={onSelectArtifact}
        onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
        onCreateArtifact={vi.fn()}
        disabled
      />
    );

    fireEvent.click(screen.getByRole("link", { name: /plan/i }));

    expect(onSelectArtifact).toHaveBeenCalledWith("artifact_1");
    expect(screen.queryByRole("button", { name: "Delete artifact" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create document" })).toBeNull();
  });

  test("an empty disabled section offers no drop or create hint", () => {
    render(
      <TaskArtifactsSection
        attachments={[]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={[]}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        onDeleteArtifact={vi.fn()}
        onCreateArtifact={vi.fn()}
        disabled
      />
    );

    expect(screen.getByText("No resources")).toBeTruthy();
    expect(screen.queryByText(/Drop files here/)).toBeNull();
  });

  test("deletes artifact with confirmation without selecting it", () => {
    const onSelectArtifact = vi.fn();
    const onDeleteArtifact = vi.fn().mockResolvedValue(undefined);
    const artifacts = [
      { _id: artifactId("artifact_1"), name: "Plan", createdAt: 1000 },
      { _id: artifactId("artifact_2"), name: "Review", createdAt: 2000 },
    ];

    render(
      <TaskArtifactsSection
        attachments={[]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={artifacts}
        selectedArtifactId={null}
        onSelectArtifact={onSelectArtifact}
        onDeleteArtifact={onDeleteArtifact}
        onCreateArtifact={vi.fn()}
      />
    );

    const deleteButtons = screen.getAllByRole("button", { name: "Delete artifact" });
    fireEvent.click(deleteButtons[0]);
    expect(screen.getByRole("heading", { name: /delete artifact/i })).toBeDefined();
    expect(onDeleteArtifact).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDeleteArtifact).toHaveBeenCalledWith("artifact_1");
    expect(onSelectArtifact).not.toHaveBeenCalled();
  });

  test("shows the full artifact name on hover (OS-1982)", () => {
    const name = "A very long artifact name that the pill truncates";

    render(
      <TaskArtifactsSection
        attachments={[]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={[{ _id: artifactId("artifact_1"), name, createdAt: 1000 }]}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
        onCreateArtifact={vi.fn()}
      />
    );

    expect(screen.getByText(name).getAttribute("title")).toBe(name);
  });

  test("renders artifacts in creation order (oldest to newest)", () => {
    const artifacts = [
      { _id: artifactId("artifact_new"), name: "Newest", createdAt: 3000 },
      { _id: artifactId("artifact_old"), name: "Oldest", createdAt: 1000 },
      { _id: artifactId("artifact_mid"), name: "Middle", createdAt: 2000 },
    ];

    render(
      <TaskArtifactsSection
        attachments={[]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={artifacts}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
        onCreateArtifact={vi.fn()}
      />
    );

    const artifactPills = screen
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(artifactPills[0]).toContain("Oldest");
    expect(artifactPills[1]).toContain("Middle");
    expect(artifactPills[2]).toContain("Newest");
  });

  test("clicking non-previewable attachment opens preview-unavailable dialog before download", () => {
    render(
      <TaskArtifactsSection
        attachments={[baseAttachment]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={[]}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
        onCreateArtifact={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^notes\.pdf$/i }));

    expect(screen.getByRole("heading", { name: /preview unavailable/i })).toBeDefined();
    expect(downloadFile).not.toHaveBeenCalled();
  });

  test("clicking image attachment opens a gallery on the clicked image", () => {
    render(
      <TaskArtifactsSection
        attachments={[baseImageAttachment, baseAttachment, secondImageAttachment]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={[]}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
        onCreateArtifact={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /^second-preview\.png$/i })
    );

    expect(
      screen.getByRole("heading", { name: /attachment preview/i })
    ).toBeDefined();
    expect(screen.getByTestId("slide-count").textContent).toBe("2");
    expect(screen.getByTestId("initial-index").textContent).toBe("1");
    expect(screen.getByTestId("selected-slide").textContent).toBe(
      "second-preview.png"
    );
    expect(screen.queryByRole("heading", { name: /preview unavailable/i })).toBeNull();
    expect(downloadFile).not.toHaveBeenCalled();
  });

  test("clicking video attachment opens the preview instead of the download dialog", () => {
    render(
      <TaskArtifactsSection
        attachments={[baseImageAttachment, baseAttachment, videoAttachment]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={[]}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
        onCreateArtifact={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^demo\.mp4$/i }));

    expect(
      screen.getByRole("heading", { name: /attachment preview/i })
    ).toBeDefined();
    expect(screen.getByTestId("slide-count").textContent).toBe("2");
    expect(screen.getByTestId("initial-index").textContent).toBe("1");
    expect(screen.getByTestId("selected-slide").textContent).toBe("demo.mp4");
    expect(screen.getByTestId("selected-slide-type").textContent).toBe("video");
    expect(screen.queryByRole("heading", { name: /preview unavailable/i })).toBeNull();
    expect(downloadFile).not.toHaveBeenCalled();
  });

  test("downloads attachment from the preview lightbox", () => {
    render(
      <TaskArtifactsSection
        attachments={[baseImageAttachment, secondImageAttachment]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={[]}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
        onCreateArtifact={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /^second-preview\.png$/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /download slide/i }));

    expect(downloadFile).toHaveBeenCalledWith(
      "https://example.com/second-preview.png",
      "second-preview.png"
    );
  });

  test("confirms attachment download from dialog", () => {
    render(
      <TaskArtifactsSection
        attachments={[baseAttachment]}
        uploading={[]}
        onDeleteAttachment={vi.fn()}
        onAttachFilesClick={vi.fn()}
        artifacts={[]}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
        onCreateArtifact={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^notes\.pdf$/i }));
    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    expect(downloadFile).toHaveBeenCalledWith(
      "https://example.com/notes.pdf",
      "notes.pdf"
    );
  });

  test("deletes attachment with confirmation", () => {
    const onDeleteAttachment = vi.fn();

    render(
      <TaskArtifactsSection
        attachments={[baseAttachment]}
        uploading={[]}
        onDeleteAttachment={onDeleteAttachment}
        onAttachFilesClick={vi.fn()}
        artifacts={[]}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
        onCreateArtifact={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /delete notes\.pdf/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDeleteAttachment).toHaveBeenCalledWith("attachment_1");
  });

  describe("resource drag source (OS-1711)", () => {
    const artifacts = [
      { _id: artifactId("artifact_1"), name: "Plan", createdAt: 1000 },
    ];

    function renderWithDragContext(overrides: { disabled?: boolean } = {}) {
      render(
        <TaskArtifactsSection
          projectId={"project_1" as Id<"projects">}
          taskId={"task_1" as Id<"tasks">}
          attachments={[baseAttachment]}
          uploading={[]}
          onDeleteAttachment={vi.fn()}
          onAttachFilesClick={vi.fn()}
          artifacts={artifacts}
          selectedArtifactId={null}
          onSelectArtifact={vi.fn()}
          onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
          onCreateArtifact={vi.fn()}
          {...overrides}
        />
      );
    }

    function dragPill(name: RegExp, role: "button" | "link" = "link") {
      const store = new Map<string, string>();
      const dataTransfer = {
        setData: (type: string, value: string) => store.set(type, value),
        getData: (type: string) => store.get(type) ?? "",
        get types() {
          return [...store.keys()];
        },
        effectAllowed: "none",
      };
      fireEvent.dragStart(screen.getByRole(role, { name }), { dataTransfer });
      return store;
    }

    test("writes an artifact payload with the project marker", () => {
      renderWithDragContext();

      const store = dragPill(/^Plan/);

      expect(JSON.parse(store.get(RESOURCE_DRAG_MIME) ?? "")).toEqual({
        kind: "artifact",
        projectId: "project_1",
        resourceId: "artifact_1",
        taskId: "task_1",
        name: "Plan",
      });
      expect(store.has("application/x-convoy-resource-project-project_1")).toBe(true);
    });

    test("writes an attachment payload carrying the file name", () => {
      renderWithDragContext();

      const store = dragPill(/^notes\.pdf$/i, "button");

      expect(JSON.parse(store.get(RESOURCE_DRAG_MIME) ?? "")).toEqual({
        kind: "attachment",
        projectId: "project_1",
        resourceId: "attachment_1",
        taskId: "task_1",
        name: "notes.pdf",
      });
    });

    test("archived tasks render non-draggable pills and write nothing", () => {
      renderWithDragContext({ disabled: true });

      expect(screen.getByRole("link", { name: /^Plan/ }).draggable).toBe(false);
      expect(dragPill(/^Plan/).size).toBe(0);
    });

    test("pills are not draggable without project/task context", () => {
      render(
        <TaskArtifactsSection
          attachments={[baseAttachment]}
          uploading={[]}
          onDeleteAttachment={vi.fn()}
          onAttachFilesClick={vi.fn()}
          artifacts={artifacts}
          selectedArtifactId={null}
          onSelectArtifact={vi.fn()}
          onDeleteArtifact={vi.fn().mockResolvedValue(undefined)}
          onCreateArtifact={vi.fn()}
        />
      );

      expect(screen.getByRole("link", { name: /^Plan/ }).draggable).toBe(false);
      expect(dragPill(/^Plan/).size).toBe(0);
    });
  });
});
