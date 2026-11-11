// Who may see a task. Personal tasks are private to their owner. This is a rule on the data, applied wherever tasks are read or written, and by every
// report and portal feed (they must call `visibleTo`, never filter by hand).
//
// HONEST LIMIT: the app reads SharePoint straight from the browser with each person's own sign-in, so a rule applied in the app cannot stop someone who
// has SharePoint rights to the list itself from opening it. To make privacy real, personal tasks must live where only their owner has rights: a separate
// SharePoint list per practice ("PersonalTasks", same columns) whose items the server grants to the owner alone, or the API. Phase 2 must make that
// decision before any personal task is stored. Until then, no personal task is written anywhere.
import { Row } from "../schema";
import { WorkTask, readTask } from "./model";

export type Viewer = { user: string; /** may see all shared work (owner or manager) */ seesAllShared: boolean; /** sign-in of a client contact in the portal, if this is the portal */ portalContact?: string };
const same = (a: string, b: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export function canSee(t: WorkTask, v: Viewer): boolean {
  if (t.privacy === "private" || t.area === "personal") return same(t.owner, v.user) || same(t.createdBy, v.user); // nobody else, whatever their role
  if (v.portalContact !== undefined) return false; // the portal has its own, narrower rule (portalVisible)
  return true;
}
export const visibleTo = (rows: Row[], v: Viewer): Row[] => rows.filter((r) => canSee(readTask(r), v));

/** The portal: only an action explicitly shared with the client, for that client, that is not private, and only the fields a client should read. */
export function portalVisible(t: WorkTask, clientKey: string, sharedWithClient: boolean): boolean {
  return sharedWithClient && t.privacy === "shared" && t.area !== "personal" && !!clientKey && t.clientKey === clientKey && (t.ownerType === "contact" || t.ownerType === "external");
}
export const portalView = (t: WorkTask) => ({ key: t.key, title: t.title, description: t.description, status: t.status, dueDate: t.dueDate }); // never owner notes, internal target, time, tags

/** Reports on practice work, time, billing and productivity must not include personal work. */
export const countsTowardPractice = (t: WorkTask) => t.area !== "personal" && t.privacy !== "private";
