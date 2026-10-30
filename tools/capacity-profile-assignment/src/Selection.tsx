// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useMemo, useState } from "react";
import { Plan } from "../../shared/src/model";
import { CapacityCatalog, profileLabel } from "./model";
import { CapacityWriter, buildSelectionPlan, checkUser } from "./plan";

// The main way in: tick users and capacity profiles and review. Every selected user gets every selected
// profile; the plan is built the same way as from a CSV row.

export function makeSelection(writer: CapacityWriter): React.ComponentType<{ catalog: CapacityCatalog; onReview: (plan: Plan) => void }> {
  return function Selection({ catalog, onReview }) {
    const [userFilter, setUserFilter] = useState("");
    const [onlyWithout, setOnlyWithout] = useState(false);
    const [users, setUsers] = useState<Set<string>>(new Set());
    const [profiles, setProfiles] = useState<Set<string>>(new Set());

    const profileName = useMemo(() => new Map(catalog.profiles.map((p) => [p.id, p.name])), [catalog]);

    const userRows = useMemo(() => catalog.users
      .filter((u) => !u.disabled && u.interactive)
      .map((u) => {
        const check = checkUser(u, catalog);
        const resource = check.ok ? catalog.resources.find((r) => r.id === check.resourceId) : undefined;
        const current = (resource?.profileIds ?? []).map((p) => profileName.get(p) ?? "?").sort();
        return { user: u, selectable: check.ok, reason: check.ok ? "" : "Not a bookable resource — run User Setup first", current };
      })
      .sort((a, b) => Number(b.selectable) - Number(a.selectable) || a.user.fullName.localeCompare(b.user.fullName)), [catalog, profileName]);

    const profileRows = useMemo(() => catalog.profiles.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name)), [catalog]);

    const match = (text: string, filter: string) => text.toLowerCase().includes(filter.trim().toLowerCase());
    const visibleUsers = userRows.filter((r) => match(`${r.user.fullName} ${r.user.signIn} ${r.user.businessUnitName}`, userFilter) && (!onlyWithout || (r.selectable && !r.current.length)));

    function toggle(set: Set<string>, id: string, apply: (s: Set<string>) => void) {
      const next = new Set(set);
      if (next.has(id)) next.delete(id); else next.add(id);
      apply(next);
    }
    function selectVisibleUsers(on: boolean) {
      const next = new Set(users);
      visibleUsers.filter((r) => r.selectable).forEach((r) => (on ? next.add(r.user.id) : next.delete(r.user.id)));
      setUsers(next);
    }

    function review() {
      const picked = profileRows.filter((p) => profiles.has(p.id));
      const ordered = userRows.filter((r) => users.has(r.user.id)).map((r) => r.user.id);
      onReview(buildSelectionPlan(ordered, picked, catalog, writer));
    }

    const ready = users.size > 0 && profiles.size > 0;
    return <>
      <section className="panel-grid">
        <div className="panel">
          <p className="eyebrow">Step 1 · Users</p>
          <div className="section-heading"><h2>Select users</h2><span className="pick-count">{users.size} selected</span></div>
          <p className="muted">Only users that are <strong>bookable resources</strong> can get capacity profiles. Others are shown greyed out: set them up with User Setup first.</p>
          <div className="pick-tools">
            <input className="pick-search" type="search" placeholder="Search name, sign-in or business unit" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} aria-label="Search users" />
            <button className="button ghost" onClick={() => selectVisibleUsers(true)}>Select shown</button>
            <button className="button ghost" onClick={() => selectVisibleUsers(false)}>Clear shown</button>
          </div>
          <label className="muted pick-option">
            <input type="checkbox" checked={onlyWithout} onChange={(e) => setOnlyWithout(e.target.checked)} /> Only users without a capacity profile
          </label>
          <ul className="pick-list">
            {visibleUsers.map((r) => <li key={r.user.id} className={`${r.selectable ? "" : "disabled"} ${users.has(r.user.id) ? "selected" : ""}`}>
              <label>
                <input type="checkbox" disabled={!r.selectable} checked={users.has(r.user.id)} onChange={() => toggle(users, r.user.id, setUsers)} />
                <span className="pick-main">
                  <strong>{r.user.fullName}</strong>
                  <small>{r.user.signIn}{r.user.businessUnitName ? ` · ${r.user.businessUnitName}` : ""}</small>
                  <small className="pick-current">{r.selectable ? (r.current.length ? `Profiles: ${r.current.join(", ")}` : "No capacity profile yet") : r.reason}</small>
                </span>
              </label>
            </li>)}
            {!visibleUsers.length && <li className="pick-empty">No users match.</li>}
          </ul>
        </div>
        <div className="panel">
          <p className="eyebrow">Step 2 · Capacity profiles</p>
          <div className="section-heading"><h2>Select capacity profiles</h2><span className="pick-count">{profiles.size} selected</span></div>
          <p className="muted">Every selected user gets every selected profile. Profiles a user already has are left alone, and no profile is ever removed.</p>
          <ul className="pick-list">
            {profileRows.map((p) => <li key={p.id} className={profiles.has(p.id) ? "selected" : ""}>
              <label>
                <input type="checkbox" checked={profiles.has(p.id)} onChange={() => toggle(profiles, p.id, setProfiles)} />
                <span className="pick-main">
                  <strong>{profileLabel(p)}</strong>
                  {p.uniqueName && <small>{p.uniqueName}</small>}
                </span>
              </label>
            </li>)}
            {!profileRows.length && <li className="pick-empty">There are no active capacity profiles in this environment.</li>}
          </ul>
        </div>
      </section>
      <div className="pick-footer">
        <span className="muted">{ready ? `${profiles.size} capacity profile${profiles.size === 1 ? "" : "s"} for ${users.size} user${users.size === 1 ? "" : "s"}.` : "Select at least one user and one capacity profile."}</span>
        <button className="button primary" disabled={!ready} onClick={review}>Review plan</button>
      </div>
    </>;
  };
}
