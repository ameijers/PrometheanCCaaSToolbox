// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Every table, column, relationship and option value this tool writes, read from the live
// academyexperiment environment's metadata and from the advanced queues the admin center created
// there (see IMPLEMENTATION_STATUS.md, "Step 0"). Nothing here is guessed.

export const QUEUE_TABLE = "queue";
export const QUEUE_ENTITY_SET = "queues";

// N:N between queue and systemuser; intersect table queuemembership. Both navigation properties have
// this same name. The platform's Omnichannel reference-data sync plug-in listens to Associate.
export const MEMBERSHIP_RELATIONSHIP = "queuemembership_association";

export const OPERATING_HOURS_NAV = "msdyn_operatinghourid";

// msdyn_queuetype
export const QUEUE_TYPES = { Voice: 192350002, Messaging: 192350000, Record: 192350001 } as const;
export type QueueType = keyof typeof QUEUE_TYPES;

// msdyn_assignmentstrategy, with the admin center's names. "Least active" is stored as Longest Idle,
// "Highest capacity" as Omnichannel Assignment and "Advanced round robin" as Round Robin — the same
// names the platform's own msdyn_CreateQueue API uses. Custom assignment (assignment rulesets) and
// No assignment aren't offered.
export const ASSIGNMENT_METHODS = {
  "Least active": 192350003,
  "Highest capacity": 192350000,
  "Advanced round robin": 192350001
} as const;
export type AssignmentMethod = keyof typeof ASSIGNMENT_METHODS;

// queueviewtype
export const VISIBILITY = { Private: 1, Public: 0 } as const;
export type Visibility = keyof typeof VISIBILITY;
