import { useEffect, useState } from "react";

// Reports whether the viewport's HEIGHT is too short to fit a desktop-
// sized menu without scrolling — primarily iPad landscape (~768 tall),
// laptop browsers with lots of chrome, and any phone-in-landscape
// orientation that doesn't already trip useIsCompact (which only
// looks at width). Components combine this with useIsCompact to pick
// the right size for their hero image / card heights.
export function useIsShort(threshold = 880): boolean {
  const [short, setShort] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight < threshold : false,
  );
  useEffect(() => {
    const onResize = () => setShort(window.innerHeight < threshold);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [threshold]);
  return short;
}
