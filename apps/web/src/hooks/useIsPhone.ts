import { useEffect, useState } from "react";

/**
 * Viewport width hook for responsive chart/table switching.
 * Returns true if viewport width is less than 768px (md breakpoint).
 */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );

  useEffect(() => {
    const handleResize = () => {
      setIsPhone(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return isPhone;
}
