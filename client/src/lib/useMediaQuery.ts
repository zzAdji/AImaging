import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** < 768 px — phones & small devices: IA-only minimal shell */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

/** < 1024 px — small tablets: compact chrome */
export function useIsCompact(): boolean {
  return useMediaQuery("(max-width: 1023px)");
}