"use client";

import { useState, useRef, useEffect } from "react";

const INTERVAL_MS = 30; // тик каждые 30мс (~33fps)
const CHARS_PER_TICK = 15; // символов за тик = ~500 симв/сек

/**
 * Буферизует стримящийся текст и выводит его с фиксированной скоростью,
 * сглаживая рывки неравномерных чанков от API.
 *
 * @param fullText  - полный накопленный текст (растёт во время стриминга)
 * @param active    - true пока идёт стриминг; после false догоняет и останавливается
 */
export function useTypewriter(fullText: string, active: boolean): string {
  const [displayed, setDisplayed] = useState(() => (active ? "" : fullText));

  // Рефы — чтобы интервал читал актуальные значения без перезапуска
  const fullTextRef = useRef(fullText);
  const activeRef = useRef(active);
  const displayedLengthRef = useRef(active ? 0 : fullText.length);

  useEffect(() => {
    fullTextRef.current = fullText;
  }, [fullText]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    // Историческое сообщение — useState уже инициализирован с fullText
    if (!active) return;

    const tick = () => {
      const current = displayedLengthRef.current;
      const target = fullTextRef.current.length;

      if (current >= target) {
        if (!activeRef.current) clearInterval(id);
        return;
      }

      const next = Math.min(target, current + CHARS_PER_TICK);
      displayedLengthRef.current = next;
      setDisplayed(fullTextRef.current.slice(0, next));
    };

    const id = setInterval(tick, INTERVAL_MS);

    // При возврате на вкладку — догоняем весь накопленный текст сразу
    const onVisible = () => {
      if (!document.hidden) {
        displayedLengthRef.current = fullTextRef.current.length;
        setDisplayed(fullTextRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return displayed;
}
