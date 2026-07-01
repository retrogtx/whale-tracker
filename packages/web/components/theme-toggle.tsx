"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="border-border bg-secondary text-foreground hover:border-gold/50 hover:text-gold flex size-9 items-center justify-center rounded-full border transition-colors"
    >
      {mounted && !isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </button>
  );
}
