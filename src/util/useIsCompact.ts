import { useEffect, useState } from "react";

// Reports whether the viewport is below a phone-sized breakpoint.
// Inline-styled components can't use CSS media queries, so menu / HUD
// components branch on this in JS to switch to a compact layout.
export function useIsCompact(threshold = 720): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < threshold : false
  );
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < threshold);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [threshold]);
  return compact;
}
