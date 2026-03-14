"use client";

import { useEffect } from "react";
import { applyTheme, getStoredTheme } from "@/lib/theme";

export function ThemeInitializer() {
  useEffect(() => {
    applyTheme(getStoredTheme());

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange() {
      if (getStoredTheme() === "system") {
        applyTheme("system");
      }
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return null;
}
