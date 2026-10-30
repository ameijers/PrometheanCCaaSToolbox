// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Every tool on the home page, in the groups and order of the app's Site Map. `key` is the deploy key
// (deploy.config.json); the page opens pct_/tools/<key>/index.html. tests/home.test.ts checks that this
// list and deploy.config.json name the same tools.

export type GroupId = "tools" | "3d" | "creation" | "provisioning" | "security";

export interface Group { id: GroupId; name: string; summary: string; }

export interface ToolCard {
  key: string;
  name: string;
  group: GroupId;
  description: string;
  writes: boolean;
  isNew?: boolean;
}

export const GROUPS: Group[] = [
  { id: "tools", name: "Diagnose", summary: "Read-only tools to understand routing and find problems." },
  { id: "3d", name: "See it in 3D", summary: "Your whole contact center as a 3D picture you can walk through." },
  { id: "creation", name: "Create in bulk", summary: "Create workstreams, queues, profiles, rules and voicemail from a CSV." },
  { id: "provisioning", name: "Change and assign in bulk", summary: "Change settings and assign queues, skills and profiles to many records at once." },
  { id: "security", name: "Onboard agents", summary: "Business units, teams and users: from synced user to bookable resource." }
];

export const TOOLS: ToolCard[] = [
  { key: "routingtester", name: "Visual Routing Tester", group: "tools", writes: false, description: "See a workstream's routing as a diagram and simulate a call to find out which rules fire and where it ends up." },
  { key: "contextvariablemonitor", name: "Context Variable Monitor", group: "tools", writes: false, description: "Watch the context variables a real call captures, live, as it moves through the IVR and routing." },
  { key: "agentreadiness", name: "Agent Readiness Checker", group: "tools", writes: false, description: "Why isn't this agent getting calls? Checks every prerequisite, with plain-language evidence and fixes." },
  { key: "artifactfinder", name: "Environment Artifact Finder", group: "tools", writes: false, description: "Find configuration you can clean up: unused records, broken references and things that can never work." },

  { key: "contactcenter3d", name: "3D Contact Center", group: "3d", writes: false, description: "Your environment as a campus of buildings: doors, lobbies, rooms and desks, with live callers and a guided tour." },
  { key: "explorer3d", name: "3D Explorer", group: "3d", writes: false, description: "Every record as a 3D cloud, from phone numbers to skills. Click one to light up what's in front and behind." },

  { key: "voicebuilder", name: "Voice Workstream Builder", group: "creation", writes: true, description: "Create voice workstreams and their voice channels from a CSV, with or without a phone number." },
  { key: "queuebuilder", name: "Queue Builder", group: "creation", writes: true, description: "Create advanced queues from a CSV: type, assignment method, priority, operating hours and members." },
  { key: "profilebuilder", name: "Profile Builder", group: "creation", writes: true, description: "Create outbound profiles from a CSV: phone number, outbound queue, caller ID and behaviors." },
  { key: "assignmentmethodcopier", name: "Queue Assignment Method Copier", group: "creation", writes: true, description: "Copy one queue's custom assignment method to other queues, with a preview and a switch back." },
  { key: "routetoqueuebuilder", name: "Route-to-Queue Builder", group: "creation", writes: true, description: "Add route-to-queue rules to workstreams from a CSV, for example one per IVR menu choice." },
  { key: "voicemailbuilder", name: "Voicemail Builder", group: "creation", writes: true, description: "Set up voicemail for many voice queues: overflow, voicemail queue, workstream and intake rule." },

  { key: "recordingprovisioner", name: "Recording & Transcription", group: "provisioning", writes: true, description: "Set transcript and recording on many voice channels at once, with a preview and a revert." },
  { key: "queuemembership", name: "Queue Membership", group: "provisioning", writes: true, description: "Add users who are bookable resources to one or more queues, from a CSV." },
  { key: "skillassignment", name: "Skill Assignment", group: "provisioning", writes: true, description: "Give users skills with a rating, by selecting users and skills or from a CSV." },
  { key: "capacityassignment", name: "Capacity Profile Assignment", group: "provisioning", writes: true, isNew: true, description: "Give many users one or more capacity profiles at once, by selecting users and profiles or from a CSV." },
  { key: "numberchanger", name: "Phone Number Changer", group: "provisioning", writes: true, description: "Move, swap or replace the phone numbers of voice channels and outbound profiles, with a revert." },

  { key: "businessunitbuilder", name: "Business Units Builder", group: "security", writes: true, description: "Create whole business unit hierarchies from a CSV, shown as a tree before anything is created." },
  { key: "teambuilder", name: "Team Builder", group: "security", writes: true, description: "Create owner and Entra ID group teams with a business unit, administrator and security roles." },
  { key: "usersetup", name: "User Setup", group: "security", writes: true, description: "Give synced users roles and teams, and make them bookable resources with capacity profiles." }
];

export function webResourceName(key: string): string {
  return `pct_/tools/${key}/index.html`;
}

export function matches(tool: ToolCard, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || `${tool.name} ${tool.description}`.toLowerCase().includes(q);
}
