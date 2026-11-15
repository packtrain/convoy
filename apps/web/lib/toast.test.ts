import { beforeEach, describe, expect, test, vi } from "vitest";
import { toast } from "@/lib/toast";

const sonnerToastMocks = vi.hoisted(() => ({
  dismiss: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(() => "toast-1"),
}));

vi.mock("sonner", () => ({
  toast: sonnerToastMocks,
}));

describe("toast.busy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sonnerToastMocks.loading.mockReturnValue("toast-1");
  });

  test("shows a persistent loading toast and dismisses it after successful work", async () => {
    const result = await toast
      .busy("Uploading image...", { description: "image.png" })
      .then(async (toastId) => {
        expect(toastId).toBe("toast-1");
        return "uploaded";
      });

    expect(result).toBe("uploaded");
    expect(sonnerToastMocks.loading).toHaveBeenCalledWith("Uploading image...", {
      description: "image.png",
      duration: Infinity,
    });
    expect(sonnerToastMocks.dismiss).toHaveBeenCalledWith("toast-1");
    expect(sonnerToastMocks.error).not.toHaveBeenCalled();
  });

  test("replaces the loading toast with an error toast after failed work", async () => {
    await toast
      .busy("Uploading image...", { errorMessage: "Image upload failed" })
      .then(async () => {
        throw new Error("File is too large");
      });

    expect(sonnerToastMocks.dismiss).not.toHaveBeenCalled();
    expect(sonnerToastMocks.error).toHaveBeenCalledWith("Image upload failed", {
      description: "File is too large",
      id: "toast-1",
    });
  });

  test("allows callers to override error handling", async () => {
    const error = new Error("Network unavailable");
    const onError = vi.fn();

    await toast.busy("Uploading image...", { onError }).then(async () => {
      throw error;
    });

    expect(onError).toHaveBeenCalledWith(error, "toast-1");
    expect(sonnerToastMocks.error).not.toHaveBeenCalled();
  });
});
