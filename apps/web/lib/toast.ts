import { toast as sonnerToast } from "sonner";
import { getErrorMessage } from "@/lib/errors";

type BusyToastMessage = Parameters<typeof sonnerToast.loading>[0];
type BusyToastId = ReturnType<typeof sonnerToast.loading>;
type SonnerBusyToastOptions = NonNullable<Parameters<typeof sonnerToast.loading>[1]>;

type BusyToastOptions = SonnerBusyToastOptions & {
  errorMessage?: string;
  onError?: (error: unknown, toastId: BusyToastId) => void;
};

type BusyToastTask<T> = (toastId: BusyToastId) => T | Promise<T>;

interface BusyToastHandle {
  id: BusyToastId;
  then<T>(task: BusyToastTask<T>): Promise<T | undefined>;
}

export const toast = Object.assign(sonnerToast, {
  busy(message: BusyToastMessage, options?: BusyToastOptions): BusyToastHandle {
    const {
      errorMessage = "Something went wrong",
      onError,
      ...toastOptions
    } = options ?? {};
    const toastId = sonnerToast.loading(message, {
      duration: Infinity,
      ...toastOptions,
    });

    return {
      id: toastId,
      async then<T>(task: BusyToastTask<T>): Promise<T | undefined> {
        try {
          const result = await task(toastId);
          sonnerToast.dismiss(toastId);
          return result;
        } catch (error) {
          if (onError) {
            onError(error, toastId);
            return undefined;
          }

          const description =
            getErrorMessage(error, String(error));
          sonnerToast.error(errorMessage, {
            description,
            id: toastId,
          });
          return undefined;
        }
      },
    };
  },
});
