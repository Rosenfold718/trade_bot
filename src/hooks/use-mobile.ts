import * as React from "react"

const MOBILE_BREAKPOINT = 768
const TABLET_BREAKPOINT = 1024
const LARGE_DESKTOP_BREAKPOINT = 1280

export type Breakpoint = 'mobile' | 'tablet' | 'desktop' | 'large'

function getBreakpoint(width: number): Breakpoint {
  if (width < MOBILE_BREAKPOINT) return 'mobile'
  if (width < TABLET_BREAKPOINT) return 'tablet'
  if (width < LARGE_DESKTOP_BREAKPOINT) return 'desktop'
  return 'large'
}

export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = React.useState<Breakpoint | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setBreakpoint(getBreakpoint(window.innerWidth))
    }
    mql.addEventListener("change", onChange)
    setBreakpoint(getBreakpoint(window.innerWidth))
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return breakpoint ?? 'mobile'
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
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

export function useIsTablet() {
  const [isTablet, setIsTablet] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const onChange = () => {
      const w = window.innerWidth
      setIsTablet(w >= MOBILE_BREAKPOINT && w < TABLET_BREAKPOINT)
    }
    const mql = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px) and (max-width: ${TABLET_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", onChange)
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isTablet
}

/** Detect landscape orientation on mobile devices */
export function useIsLandscape() {
  const [isLandscape, setIsLandscape] = React.useState(false)

  React.useEffect(() => {
    const mql = window.matchMedia('(orientation: landscape)')
    const onChange = () => {
      setIsLandscape(window.innerWidth > window.innerHeight)
    }
    mql.addEventListener("change", onChange)
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isLandscape
}
