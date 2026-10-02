// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

export interface User { id: string; fullName: string; signIn: string; email?: string; disabled: boolean; interactive: boolean; businessUnitName: string; }

// An active skill assignment on a bookable resource (bookableresourcecharacteristic).
export interface Assignment { id: string; skillId: string; ratingId?: string; }
export interface Resource { id: string; userId: string; active: boolean; assignments: Assignment[]; }

export interface Skill { id: string; name: string; active: boolean; type: number; }
export interface RatingValue { id: string; name: string; value: number; modelName: string; }

export interface SkillCatalog {
  users: User[];
  resources: Resource[];
  skills: Skill[];          // every characteristic; only type Skill can be assigned
  ratings: RatingValue[];   // values of the active rating models
}

// characteristic.characteristictype
export const SKILL_TYPE = 1;

// One requested skill: by id once resolved, with an optional rating.
export interface SkillRequest { skill: Skill; rating?: RatingValue; }

export function ratingLabel(r: RatingValue | undefined): string {
  return r ? `${r.name} (${r.value})` : "no rating";
}
