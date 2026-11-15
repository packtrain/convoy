"use client";

// https://enhanced-button.vercel.app/
import * as React from "react";
import { Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/custom/spinner";

/** Effects layered on `ui/button`; variants and sizes come from there. */
const buttonEffectVariants = cva("", {
  variants: {
    effect: {
      expandIcon: "group gap-0 relative",
    },
  },
});

interface IconProps {
  icon: React.ElementType;
  iconPlacement: "left" | "right";
}

interface IconRefProps {
  icon?: never;
  iconPlacement?: undefined;
}

export interface ButtonExtProps
  extends Omit<React.ComponentProps<typeof Button>, "ref">,
    VariantProps<typeof buttonEffectVariants> {
  busy?: boolean;
}

export type ButtonIconProps = IconProps | IconRefProps;

function ButtonBusyLoader() {
  return <Spinner />;
}

const ButtonExt = React.forwardRef<HTMLButtonElement, ButtonExtProps & ButtonIconProps>(
  ({ className, effect, icon: Icon, iconPlacement, busy = false, ...props }, ref) => {
    const [renderBusy, setRenderBusy] = React.useState(busy);

    React.useEffect(() => {
      if (busy) {
        setRenderBusy(true);
        return;
      }

      if (!renderBusy) {
        return;
      }

      const timeoutId = window.setTimeout(() => {
        setRenderBusy(false);
      }, 180);

      return () => window.clearTimeout(timeoutId);
    }, [busy, renderBusy]);

    return (
      <Button
        className={cn(buttonEffectVariants({ effect }), className)}
        ref={ref}
        disabled={props.disabled || busy}
        {...props}
      >
        {Icon &&
          iconPlacement === "left" &&
          (effect === "expandIcon" ? (
            <div
              className={cn(
                "w-0 translate-x-[0%] pr-0 opacity-0 transition-all duration-200",
                (busy || props.disabled) && "w-5 translate-x-100 pr-2 opacity-100",
                "group-hover:w-5 group-hover:translate-x-100 group-hover:pr-2 group-hover:opacity-100"
              )}
            >
              <Icon />
            </div>
          ) : (
            <Icon />
          ))}
        {!Icon && effect === "expandIcon" && renderBusy && (
          <div className={cn("w-4.5 translate-x-0 pr-1.5 transition-all duration-200", busy ? "opacity-100" : "opacity-0")}>
            <ButtonBusyLoader />
          </div>
        )}
        <Slottable>{props.children}</Slottable>
        {Icon &&
          iconPlacement === "right" &&
          (effect === "expandIcon" ? (
            <div
              className={cn(
                "w-0 translate-x-full pl-0 opacity-0 transition-all duration-200",
                renderBusy && "w-4.5 translate-x-0 pl-1",
                busy && "opacity-100",
                renderBusy && !busy && "opacity-0",
                !renderBusy && "group-hover:w-4.5 group-hover:translate-x-0 group-hover:pl-1 group-hover:opacity-100"
              )}
            >
              {renderBusy ? <ButtonBusyLoader /> : <Icon />}
            </div>
          ) : (
            <Icon />
          ))}
      </Button>
    );
  }
);

ButtonExt.displayName = "ButtonExt";

export { ButtonExt };
