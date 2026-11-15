import {
  cloneElement,
  createContext,
  useContext,
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

const DrawerMockContext = createContext<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
} | null>(null);

export function Drawer({
  open,
  onOpenChange,
  direction,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  direction?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  return (
    <DrawerMockContext.Provider value={{ open, onOpenChange }}>
      <div data-testid="drawer-root" data-direction={direction}>
        {children}
        {open ? (
          <button type="button" onClick={() => onOpenChange(false)}>
            Dismiss drawer
          </button>
        ) : null}
      </div>
    </DrawerMockContext.Provider>
  );
}

export function DrawerTrigger({
  children,
}: {
  asChild?: boolean;
  children: ReactElement<{ onClick?: (event: MouseEvent) => void }>;
}) {
  const drawer = useContext(DrawerMockContext);

  return cloneElement(children, {
    onClick: (event: MouseEvent) => {
      children.props.onClick?.(event);
      drawer?.onOpenChange(true);
    },
  });
}

export function DrawerContent({
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const drawer = useContext(DrawerMockContext);

  return drawer?.open ? <div {...props}>{children}</div> : null;
}

export function DrawerDescription(
  props: HTMLAttributes<HTMLParagraphElement>
) {
  return <p {...props} />;
}

export function DrawerHeader(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}

export function DrawerTitle(props: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 {...props} />;
}
