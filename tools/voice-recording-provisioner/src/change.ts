// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import {
  CAPTURE_LABELS, RECORDING_FIELDS, RECORDING_FIELD_LABELS, RecordingField, RecordingSettings, START_LABELS
} from "../../voice-workstream-builder/src/recordingSettings";
import { ChannelChange, ChannelRow, SettingChange } from "./model";

// Works out, per selected channel, what a change would actually do — before anything is written.
// Channels that already have the target settings are left alone.

export function applyChange(settings: RecordingSettings, change: SettingChange): RecordingSettings {
  const next: RecordingSettings = { ...settings };
  RECORDING_FIELDS.forEach((field) => {
    if (change[field] !== undefined) (next as Record<RecordingField, unknown>)[field] = change[field];
  });
  // With transcript and recording off, the start mode means nothing and reads back as the default.
  if (next.capture === "none") next.start = "automatic";
  return next;
}

export function planChanges(channels: ChannelRow[], change: SettingChange): ChannelChange[] {
  return channels.map((channel) => {
    const before = channel.settings;
    const after = applyChange(before, change);
    const changedFields = RECORDING_FIELDS.filter((f) => before[f] !== after[f]);
    return { channel, before, after, changedFields, status: changedFields.length ? "change" : "noChange" };
  });
}

export function isEmptyChange(change: SettingChange): boolean {
  return RECORDING_FIELDS.every((f) => change[f] === undefined);
}

function valueLabel(field: RecordingField, value: unknown): string {
  if (field === "capture") return CAPTURE_LABELS[value as keyof typeof CAPTURE_LABELS];
  if (field === "start") return START_LABELS[value as keyof typeof START_LABELS];
  return value ? "Yes" : "No";
}

export function describeChange(change: SettingChange): string[] {
  return RECORDING_FIELDS.filter((f) => change[f] !== undefined).map((f) => `${RECORDING_FIELD_LABELS[f]}: ${valueLabel(f, change[f])}`);
}

export function describeFieldChange(change: ChannelChange, field: RecordingField): string {
  return `${RECORDING_FIELD_LABELS[field]}: ${valueLabel(field, change.before[field])} → ${valueLabel(field, change.after[field])}`;
}
