import * as React from "react";
import { useMemo, useState } from "react";
import { Plan } from "../../shared/src/model";
import { SKILL_TYPE, SkillCatalog, SkillRequest, ratingLabel } from "./model";
import { buildSelectionPlan, checkUser, SkillWriter } from "./plan";

// The second way in: tick users and skills (each with a rating, or none) and review. Every selected user
// gets every selected skill; the plan is built the same way as from a CSV row.

const NO_RATING = "";

export function makeSelection(writer: SkillWriter): React.ComponentType<{ catalog: SkillCatalog; onReview: (plan: Plan) => void }> {
  return function Selection({ catalog, onReview }) {
    const [userFilter, setUserFilter] = useState("");
    const [skillFilter, setSkillFilter] = useState("");
    const [users, setUsers] = useState<Set<string>>(new Set());
    const [skills, setSkills] = useState<Map<string, string>>(new Map()); // skill id → rating id ("" = none)

    const skillName = useMemo(() => new Map(catalog.skills.map((s) => [s.id, s.name])), [catalog]);
    const ratingById = useMemo(() => new Map(catalog.ratings.map((r) => [r.id, r])), [catalog]);

    const userRows = useMemo(() => catalog.users
      .filter((u) => !u.disabled && u.interactive)
      .map((u) => {
        const check = checkUser(u, catalog);
        const resource = check.ok ? catalog.resources.find((r) => r.id === check.resourceId) : undefined;
        const current = (resource?.assignments ?? []).map((a) => `${skillName.get(a.skillId) ?? "?"}${a.ratingId ? ` (${ratingById.get(a.ratingId)?.name ?? "?"})` : ""}`).sort();
        return { user: u, selectable: check.ok, reason: check.ok ? "" : "Not a bookable resource — run User Setup first", current };
      })
      .sort((a, b) => Number(b.selectable) - Number(a.selectable) || a.user.fullName.localeCompare(b.user.fullName)), [catalog, skillName, ratingById]);

    const skillRows = useMemo(() => catalog.skills.filter((s) => s.type === SKILL_TYPE && s.active).sort((a, b) => a.name.localeCompare(b.name)), [catalog]);

    const match = (text: string, filter: string) => text.toLowerCase().includes(filter.trim().toLowerCase());
    const visibleUsers = userRows.filter((r) => match(`${r.user.fullName} ${r.user.signIn} ${r.user.businessUnitName}`, userFilter));
    const visibleSkills = skillRows.filter((s) => match(s.name, skillFilter));

    function toggleUser(id: string) {
      const next = new Set(users);
      if (next.has(id)) next.delete(id); else next.add(id);
      setUsers(next);
    }
    function selectVisibleUsers(on: boolean) {
      const next = new Set(users);
      visibleUsers.filter((r) => r.selectable).forEach((r) => (on ? next.add(r.user.id) : next.delete(r.user.id)));
      setUsers(next);
    }
    function toggleSkill(id: string) {
      const next = new Map(skills);
      if (next.has(id)) next.delete(id); else next.set(id, NO_RATING);
      setSkills(next);
    }
    function setRating(id: string, ratingId: string) {
      setSkills(new Map(skills).set(id, ratingId));
    }

    function review() {
      const requests: SkillRequest[] = skillRows.filter((s) => skills.has(s.id)).map((s) => ({ skill: s, rating: ratingById.get(skills.get(s.id)!) }));
      const ordered = userRows.filter((r) => users.has(r.user.id)).map((r) => r.user.id);
      onReview(buildSelectionPlan(ordered, requests, catalog, writer));
    }

    const ready = users.size > 0 && skills.size > 0;
    return <>
      <section className="panel-grid">
        <div className="panel">
          <p className="eyebrow">Step 1 · Users</p>
          <div className="section-heading"><h2>Select users</h2><span className="pick-count">{users.size} selected</span></div>
          <p className="muted">Only users that are <strong>bookable resources</strong> can get skills. Others are shown greyed out: set them up with User Setup first.</p>
          <div className="pick-tools">
            <input className="pick-search" type="search" placeholder="Search name, sign-in or business unit" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} aria-label="Search users" />
            <button className="button ghost" onClick={() => selectVisibleUsers(true)}>Select shown</button>
            <button className="button ghost" onClick={() => selectVisibleUsers(false)}>Clear shown</button>
          </div>
          <ul className="pick-list">
            {visibleUsers.map((r) => <li key={r.user.id} className={`${r.selectable ? "" : "disabled"} ${users.has(r.user.id) ? "selected" : ""}`}>
              <label>
                <input type="checkbox" disabled={!r.selectable} checked={users.has(r.user.id)} onChange={() => toggleUser(r.user.id)} />
                <span className="pick-main">
                  <strong>{r.user.fullName}</strong>
                  <small>{r.user.signIn}{r.user.businessUnitName ? ` · ${r.user.businessUnitName}` : ""}</small>
                  <small className="pick-current">{r.selectable ? (r.current.length ? `Skills: ${r.current.join(", ")}` : "No skills yet") : r.reason}</small>
                </span>
              </label>
            </li>)}
            {!visibleUsers.length && <li className="pick-empty">No users match.</li>}
          </ul>
        </div>
        <div className="panel">
          <p className="eyebrow">Step 2 · Skills</p>
          <div className="section-heading"><h2>Select skills and ratings</h2><span className="pick-count">{skills.size} selected</span></div>
          <p className="muted">Every selected user gets every selected skill. A user who already has the skill gets the rating you pick here; with <em>no rating</em>, an existing skill keeps its rating. Skills are never removed.</p>
          <div className="pick-tools">
            <input className="pick-search" type="search" placeholder="Search skills" value={skillFilter} onChange={(e) => setSkillFilter(e.target.value)} aria-label="Search skills" />
          </div>
          <ul className="pick-list">
            {visibleSkills.map((s) => <li key={s.id} className={skills.has(s.id) ? "selected" : ""}>
              <label>
                <input type="checkbox" checked={skills.has(s.id)} onChange={() => toggleSkill(s.id)} />
                <span className="pick-main"><strong>{s.name}</strong></span>
              </label>
              {skills.has(s.id) && <select className="pick-rating" value={skills.get(s.id)} onChange={(e) => setRating(s.id, e.target.value)} aria-label={`Rating for ${s.name}`}>
                <option value={NO_RATING}>No rating</option>
                {catalog.ratings.map((r) => <option key={r.id} value={r.id}>{ratingLabel(r)}{new Set(catalog.ratings.map((x) => x.modelName)).size > 1 ? ` — ${r.modelName}` : ""}</option>)}
              </select>}
            </li>)}
            {!visibleSkills.length && <li className="pick-empty">{skillRows.length ? "No skills match." : "There are no active skills in this environment."}</li>}
          </ul>
        </div>
      </section>
      <div className="pick-footer">
        <span className="muted">{ready ? `${skills.size} skill${skills.size === 1 ? "" : "s"} for ${users.size} user${users.size === 1 ? "" : "s"}.` : "Select at least one user and one skill."}</span>
        <button className="button primary" disabled={!ready} onClick={review}>Review plan</button>
      </div>
    </>;
  };
}
