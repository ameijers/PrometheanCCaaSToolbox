import { ResolvedQueue } from "./model";
import { ASSIGNMENT_METHODS, OPERATING_HOURS_NAV, QUEUE_TYPES, VISIBILITY } from "./queueSchema";

// The exact JSON sent to Dataverse to create one advanced queue. The platform's queue plug-ins add the
// rest (the queue's assignment input decision contract), as they do for the admin center.
export function queuePayload(q: ResolvedQueue): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: q.name,
    msdyn_isomnichannelqueue: true,
    msdyn_queuetype: QUEUE_TYPES[q.type],
    msdyn_assignmentstrategy: ASSIGNMENT_METHODS[q.assignmentMethod],
    msdyn_priority: q.priority,
    queueviewtype: VISIBILITY[q.visibility]
  };
  if (q.description) payload.description = q.description;
  if (q.refs.operatingHours) payload[`${OPERATING_HOURS_NAV}@odata.bind`] = `/msdyn_operatinghours(${q.refs.operatingHours})`;
  return payload;
}
