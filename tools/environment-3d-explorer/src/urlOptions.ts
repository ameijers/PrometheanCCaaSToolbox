// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// What the page address can ask for: ?focus=<name>, ?health=1, ?ride=1, ?live=1 and ?depth=<1-3>. Dataverse hands a Site Map
// subarea's parameters to the web resource as one "data" value, so data=focus%3DSales%26health%3D1
// works too, and a plain data=<name> still means focus.

export interface UrlOptions {
  focus?: string;
  health: boolean;
  ride: boolean;
  live: boolean;
  // Layer distance, 1 to 3; undefined when not asked for.
  depth?: number;
}

const isOn = (value: string | null | undefined) => value !== null && value !== undefined && !/^(0|false|no|off)$/i.test(value.trim());

export function readUrlOptions(search: string): UrlOptions {
  const params = new URLSearchParams(search);
  const data = params.get("data") ?? "";
  const inner = data.includes("=") ? new URLSearchParams(data) : undefined;
  const focus = (params.get("focus") ?? inner?.get("focus") ?? (inner ? undefined : data))?.trim();
  const depth = Number(params.get("depth") ?? inner?.get("depth"));
  return { depth: Number.isFinite(depth) && depth > 0 ? Math.min(3, Math.max(1, depth)) : undefined, focus: focus || undefined, health: isOn(params.get("health")) || isOn(inner?.get("health")), ride: isOn(params.get("ride")) || isOn(inner?.get("ride")), live: isOn(params.get("live")) || isOn(inner?.get("live")) };
}
