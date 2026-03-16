"use client";

import { useState, useRef, useEffect } from "react";

const INTERVAL_MS = 30; // тик каждые 30мс (~33fps)
const CHARS_PER_TICK = 3; // символов за тик = ~100 симв/сек

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

  fullTextRef.current = fullText;
  activeRef.current = active;

  useEffect(() => {
    // Историческое сообщение — показываем сразу
    if (!active) {
      setDisplayed(fullText);
      return;
    }

    const id = setInterval(() => {
      const current = displayedLengthRef.current;
      const target = fullTextRef.current.length;

      if (current >= target) {
        // Догнали: если стриминг завершён — чистим интервал
        if (!activeRef.current) clearInterval(id);
        return;
      }

      const next = Math.min(target, current + CHARS_PER_TICK);
      displayedLengthRef.current = next;
      setDisplayed(fullTextRef.current.slice(0, next));
    }, INTERVAL_MS);

    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return displayed;
}
