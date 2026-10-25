// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useState } from "react";

// Full screen for a 3D tool. It goes to the frame the model-driven app shows the page in (same
// origin, so the page can reach it), which hides the app's menu and header; on its own the page goes
// full screen itself. Shared by Environment 3D Explorer and 3D Contact Center.

export function fullscreenTarget(): HTMLElement {
  try {
    const frame = window.frameElement as HTMLElement | null;
    if (frame?.ownerDocument) return frame;
  } catch { /* another origin: use the page */ }
  return document.documentElement;
}

export function useFullscreen(): { fullscreen: boolean; error: string; toggle(): Promise<void> } {
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState("");

  const toggle = useCallback(async () => {
    const target = fullscreenTarget();
    const doc = target.ownerDocument;
    setError("");
    try {
      if (doc.fullscreenElement || document.fullscreenElement) await (doc.fullscreenElement ? doc : document).exitFullscreen();
      else await target.requestFullscreen();
    } catch {
      // The app's page may refuse; the page itself can still fill the screen inside its frame's window.
      try { if (target !== document.documentElement) { await document.documentElement.requestFullscreen(); return; } } catch { /* refused too */ }
      setError("The browser didn't allow full screen here.");
    }
  }, []);

  useEffect(() => {
    const docs = [...new Set([document, fullscreenTarget().ownerDocument])];
    const update = () => setFullscreen(docs.some((d) => !!d.fullscreenElement));
    docs.forEach((d) => d.addEventListener("fullscreenchange", update));
    return () => docs.forEach((d) => d.removeEventListener("fullscreenchange", update));
  }, []);

  return { fullscreen, error, toggle };
}
