// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// What the page address can ask for: ?focus=<name>, ?health=1 and ?tour=1. Dataverse hands a Site Map
// subarea's parameters to the web resource as one "data" value, so data=focus%3DSales%26health%3D1
// works too, and a plain data=<name> still means focus.

export interface UrlOptions {
  focus?: string;
  health: boolean;
  tour: boolean;
}

const isOn = (value: string | null | undefined) => value !== null && value !== undefined && !/^(0|false|no|off)$/i.test(value.trim());

export function readUrlOptions(search: string): UrlOptions {
  const params = new URLSearchParams(search);
  const data = params.get("data") ?? "";
  const inner = data.includes("=") ? new URLSearchParams(data) : undefined;
  const focus = (params.get("focus") ?? inner?.get("focus") ?? (inner ? undefined : data))?.trim();
  return { focus: focus || undefined, health: isOn(params.get("health")) || isOn(inner?.get("health")), tour: isOn(params.get("tour")) || isOn(inner?.get("tour")) };
}
