// What each kind of portal access allows. This is the one place that decides, and the server calls
// it on every request: the browser's idea of what a person may do is never trusted.
//
// Access is per person and per business. Four levels:
//   administrator  business details and (if the practice allows) who else has access
//   standard       published documents, uploads, requests and messages for the business
//   restricted     only the documents, requests and messages specifically assigned to them
//   signatory      only the documents they have been named to sign
//
// Signing is not a level. It needs a signing request that names the person, whatever their level:
// being an administrator gives no authority to sign anything.

const LEVELS = ["administrator", "standard", "restricted", "signatory"];
const LEVEL_LABEL = { administrator: "Administrator", standard: "Standard", restricted: "Restricted", signatory: "Signatory" };

// action -> which levels may do it, and whether that is everything in the business ("all")
// or only what is assigned to them ("assigned").
const MATRIX = {
  "business.summary": { administrator: "all", standard: "all", restricted: "all", signatory: "all" },
  "business.details": { administrator: "all", standard: "all" },
  "business.requestChange": { administrator: "all" },
  "documents.view": { administrator: "all", standard: "all", restricted: "assigned", signatory: "assigned" },
  "documents.approve": { administrator: "all", standard: "all", restricted: "assigned", signatory: "assigned" },
  "documents.upload": { administrator: "all", standard: "all", restricted: "assigned" },
  "requests.respond": { administrator: "all", standard: "all", restricted: "assigned" },
  "messages.use": { administrator: "all", standard: "all", restricted: "assigned" },
  "signing.sign": { administrator: "assigned", standard: "assigned", restricted: "assigned", signatory: "assigned" },
  "access.manage": { administrator: "all" }, // and only when the practice allows it (see decide)
};

/**
 * { ok, scope } for a person's access to a business doing an action.
 * `access` is their access record; `policy.adminsManageAccess` says if administrators may manage people.
 */
function decide(access, action, policy = {}) {
  if (!access || access.status !== "active") return { ok: false, reason: "no-access" };
  const rule = MATRIX[action];
  if (!rule) return { ok: false, reason: "unknown-action" };
  const scope = rule[access.level];
  if (!scope) return { ok: false, reason: "level" };
  if (action === "access.manage" && !policy.adminsManageAccess) return { ok: false, reason: "practice-policy" };
  return { ok: true, scope };
}

/** Can they see this particular item? `item.assignedTo` is a list of portal user ids. */
function canSee(access, action, userId, item = {}) {
  const d = decide(access, action);
  if (!d.ok) return false;
  if (d.scope === "all") return true;
  return Array.isArray(item.assignedTo) && item.assignedTo.includes(userId);
}

module.exports = { LEVELS, LEVEL_LABEL, MATRIX, decide, canSee };
