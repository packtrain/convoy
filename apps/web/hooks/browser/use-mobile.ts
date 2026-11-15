import * as React from "react"

const MOBILE_BREAKPOINT = 768

// Synchronous check for lazy state initializers, where useIsMobile's
// effect-resolved value arrives a render too late (e.g. "default open on
// desktop" state). Not reactive; pair with useIsMobile for live updates.
export function isDesktopViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth >= MOBILE_BREAKPOINT
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false)

  React.useEffect(() => {
    if (!window.matchMedia) {
      const onResize = () => {
        setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
      }

      onResize()
      window.addEventListener("resize", onResize)
      return () => window.removeEventListener("resize", onResize)
    }

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
