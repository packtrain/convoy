import { useState, useCallback } from "react";
import type { TitledDialogProps } from "@/components/ui/dialog";

export interface UseDialogReturn {
  title?: string;
  description?: string;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  props: {
    open: boolean;
    onClose: () => void;
  };
}

export function useDialog({ title, description, ...props }: TitledDialogProps = {}): UseDialogReturn {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return {
    title,
    description,
    isOpen,
    open,
    close,

    // For compatibility with shadcn Dialog
    props: {
      open: isOpen,
      onClose: close,
      ...props,
    },
  };
}

export interface UseDialogReturnWithData<T> extends Omit<UseDialogReturn, "open"> {
  data: T | undefined;
  open: (data?: T) => void;
}

export function useDialogWithData<T>(): UseDialogReturnWithData<T> {
  const [isOpen, setIsOpen] = useState(false);
  const [activeData, setActiveData] = useState<T | undefined>(undefined);

  const open = useCallback((data?: T) => {
    setIsOpen(true);
    setActiveData(data);
  }, []);
  const close = useCallback(() => {
    setIsOpen(false);
    setActiveData(undefined);
  }, []);

  return {
    isOpen,
    open,
    close,
    data: activeData,
    // For compatibility with shadcn Dialog
    props: {
      open: isOpen,
      onClose: close,
    },
  };
}
