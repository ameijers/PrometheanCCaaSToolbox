// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The guided tour: a script of steps that plays by itself, on the sample data, to show what a 3D tool
// can do (and to record a video of it). Each step sets the scene when it starts (camera, selection,
// tabs, live activity…) and shows a caption; the bar on top pauses, steps back and forth, or ends it.
// Shared by the 3D Explorer and the 3D Contact Center.

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Graph } from "./model";
import { extendRide } from "./ride";

export interface TourStep {
  title: string;
  text: string;
  // How long the step shows, in seconds.
  seconds: number;
  // Show the left panel during this step (it's hidden otherwise, for a clean picture).
  panel?: boolean;
  // Sets the scene when the step starts; may return what to undo when it ends (e.g. stop an animation).
  run?(): void | (() => void);
}

export interface Tour {
  active: boolean;
  index: number;
  step?: TourStep;
  count: number;
  playing: boolean;
  start(): void;
  stop(): void;
  next(): void;
  previous(): void;
  togglePlaying(): void;
}

// Steps are read when a step starts, so they may use what the page knows at that moment.
// onEnd: put the page back the way it was.
export function useTour(steps: TourStep[], onEnd: () => void): Tour {
  const [index, setIndex] = useState<number | undefined>(undefined);
  const [playing, setPlaying] = useState(true);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useEffect(() => {
    if (index === undefined) return;
    const undo = stepsRef.current[index]?.run?.();
    return () => { if (typeof undo === "function") undo(); };
  }, [index]);

  const indexRef = useRef(index);
  indexRef.current = index;
  const stop = useCallback(() => {
    if (indexRef.current === undefined) return;
    indexRef.current = undefined;
    setIndex(undefined);
    onEndRef.current();
  }, []);
  const next = useCallback(() => {
    const i = indexRef.current;
    if (i === undefined) return;
    if (i + 1 >= stepsRef.current.length) { stop(); return; }
    indexRef.current = i + 1;
    setIndex(i + 1);
  }, [stop]);
  const previous = useCallback(() => {
    const i = indexRef.current;
    if (i === undefined || i === 0) return;
    indexRef.current = i - 1;
    setIndex(i - 1);
  }, []);

  // Esc ends the tour.
  useEffect(() => {
    if (index === undefined) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") stop(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index === undefined, stop]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    active: index !== undefined,
    index: index ?? 0,
    step: index === undefined ? undefined : steps[index],
    count: steps.length,
    playing,
    start: () => { setPlaying(true); setIndex(0); },
    stop,
    next,
    previous,
    togglePlaying: () => setPlaying((p) => !p)
  };
}

// The caption and controls, on top of the scene. It keeps its own clock, so the page doesn't redraw
// while a step plays; when a step's time is up it moves on.
export function TourBar({ tour }: { tour: Tour }): React.ReactElement | null {
  const [elapsed, setElapsed] = useState(0);
  const { step, index, playing, next } = tour;
  useEffect(() => { setElapsed(0); }, [index, step]);
  useEffect(() => {
    if (!step || !playing) return;
    const timer = setInterval(() => setElapsed((e) => e + 100), 100);
    return () => clearInterval(timer);
  }, [step, playing]);
  useEffect(() => { if (step && elapsed >= step.seconds * 1000) next(); }, [elapsed, step, next]);
  if (!step) return null;
  return (
    <div className="tour" role="region" aria-label="Guided tour">
      <div className="tour-progress" aria-hidden="true">
        {Array.from({ length: tour.count }, (_, i) => (
          <span key={i} className="tour-segment"><span style={{ width: i < index ? "100%" : i === index ? `${Math.min(100, (elapsed / (step.seconds * 1000)) * 100)}%` : "0%" }} /></span>
        ))}
      </div>
      <div className="tour-caption">
        <p className="tour-title">{step.title}</p>
        <p className="tour-text">{step.text}</p>
      </div>
      <div className="tour-controls">
        <span className="tour-count">{index + 1} / {tour.count}</span>
        <button onClick={tour.previous} disabled={index === 0} aria-label="Previous step">‹</button>
        <button onClick={tour.togglePlaying} aria-label={playing ? "Pause the tour" : "Play the tour"}>{playing ? "❚❚" : "▶"}</button>
        <button onClick={tour.next} aria-label="Next step">›</button>
        <button onClick={tour.stop} aria-label="End the tour">✕</button>
      </div>
    </div>
  );
}

// A whole route for following a call, decided up front so it plays without stopping at a fork: from
// start, at each fork the option named in prefer (else a queue or agent, else the first), until it
// reaches an agent. shown: only records the tool can show.
export function plannedRide(graph: Graph, start: string, prefer: string[] = [], shown: (key: string) => boolean = () => true): { path: string[]; options: [] } {
  const nodeKind = new Map(graph.nodes.map((n) => [n.key, n.kind]));
  let route = extendRide(graph, [start]);
  for (let i = 0; i < 12; i++) {
    if (nodeKind.get(route.path[route.path.length - 1]) === "agent") break;
    const options = route.options.filter((o) => shown(o.key));
    if (!options.length) break;
    const wanted = prefer.map((p) => p.toLowerCase());
    const pick = options.find((o) => wanted.includes(o.name.toLowerCase())) ?? options.find((o) => o.kind === "queue" || o.kind === "agent") ?? options[0];
    route = extendRide(graph, [...route.path, pick.key]);
  }
  return { path: route.path.filter(shown), options: [] };
}

// Whether the page was opened to play the tour (?tour=1, also inside ?data=).
export function tourAsked(): boolean {
  const params = new URLSearchParams(window.location.search);
  const v = params.get("tour") ?? new URLSearchParams(params.get("data") ?? "").get("tour");
  return v !== null && !/^(0|false|no|off)$/i.test(v);
}
