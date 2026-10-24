// Job checklists: reading them from the planner's lists and the saving that goes with each action. Every write
// checks the rules in lib/checklist.ts first (who may do it, dependencies, mandatory items), checks nobody else has
// changed the same row since it was read, then writes the row and an audit line. The screens only call these.
import { useCallback, useMemo } from "react";
import * as C from "../lib/checklist";
import { allItems, Answer, Item, ReviewNote, Template } from "../lib/checklist";
import {
  Checklist, checklistFromRow, factsOfChecklist, isStale, itemFromRow, itemPatch, itemRow, logRow, noteFromRow, notePatch, practiceId, signPatch, templateFromRow, templateRow,
} from "../lib/checklistRows";
import { STARTERS, suits } from "../lib/checklistStarters";
import { newKey } from "../lib/planning";
import { ListKey, Row } from "../lib/schema";
import { todayIso } from "../lib/domain";
import { MAIL_SCOPE, mailAllowed, outlookDraft } from "./commsKit";
import { useData, useIndex } from "./data";

export { MAIL_SCOPE, mailAllowed };

/** The rules said no (wrong role, dependency not met, …). The message is for the person. */
export class Refused extends Error {}
/** Someone else changed the same record after this screen read it. */
export class Conflict extends Error {}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function useChecklists() {
  const { data, store, user, update, updateMany, create, createMany, saveSetting, attachChecklist, reload } = useData();
  const idx = useIndex();
  const me = user || "";
  const config = useMemo(() => C.readConfig(data.settings), [data.settings]);
  const pid = practiceId(data.settings);
  const templates = useMemo(() => data.checklistTemplates.map(templateFromRow), [data.checklistTemplates]);
  const checklists = useMemo(() => data.checklists.map(checklistFromRow), [data.checklists]);
  const items = useMemo(() => data.checklistItems.map(itemFromRow), [data.checklistItems]);
  const notes = useMemo(() => data.checklistNotes.map(noteFromRow), [data.checklistNotes]);
  const ready = store.hasList("Checklists") && store.hasList("ChecklistItems") && store.hasList("ChecklistTemplates");
  const byJob = useMemo(() => new Map(checklists.map((c) => [c.jobKey, c])), [checklists]);

  /** Stops a change from silently overwriting someone else's: the row must still be as it was when it was read. */
  const fresh = useCallback(async (list: ListKey, row: Row) => {
    let now: Row;
    try { now = await store.readItem(list, row._id!); } catch { throw new Conflict("This record was removed or can't be read any more. Reload and try again."); }
    if (isStale(now, row)) throw new Conflict("Someone else changed this just now. Reload to see their change, then try again.");
  }, [store]);

  const audit = useCallback((cl: { key: string; jobKey: string; clientKey: string }, action: string, o: { itemKey?: string; detail?: string } = {}) =>
    create("ChecklistLog", logRow({ checklistKey: cl.key, jobKey: cl.jobKey, clientKey: cl.clientKey, itemKey: o.itemKey, at: new Date().toISOString(), actor: me, action, detail: o.detail, pid })), [create, me, pid]);

  const checklistOf = (item: Item) => {
    const cl = checklists.find((c) => c.key === item.checklistKey);
    if (!cl) throw new Conflict("The checklist for this item is no longer there. Reload.");
    return cl;
  };
  const itemsOf = (clKey: string) => items.filter((i) => i.checklistKey === clKey);
  const notesOf = (clKey: string) => notes.filter((n) => n.checklistKey === clKey);
  const now = () => new Date().toISOString();

  const expect = (r: C.Change | C.Verdict): C.Change => {
    if ("patch" in r) return r;
    throw new Refused(r.reason || "That isn't allowed.");
  };

  /** One item changed: rules, freshness, row, audit line. */
  const writeItem = useCallback(async (item: Item, r: C.Change | C.Verdict, extra?: { detail?: string }) => {
    const ch = expect(r);
    const row = data.checklistItems.find((x) => x.Key === item.key);
    if (!row) throw new Conflict("This item is no longer on the checklist. Reload.");
    await fresh("ChecklistItems", row);
    await update("ChecklistItems", row, itemPatch(ch.patch));
    const cl = checklists.find((c) => c.key === item.checklistKey);
    if (cl) await audit(cl, ch.entry.action, { itemKey: item.key, detail: [item.title, extra?.detail ?? ch.entry.detail].filter(Boolean).join(": ") });
  }, [data.checklistItems, fresh, update, audit, checklists]); // eslint-disable-line react-hooks/exhaustive-deps

  const writeChecklist = useCallback(async (cl: Checklist, patch: Row) => {
    await fresh("Checklists", cl.row);
    await update("Checklists", cl.row, { ...patch, Rev: cl.rev + 1, Updated: now() });
  }, [fresh, update]);

  /* ----- items ----- */
  const act = {
    complete: (item: Item) => { const cl = checklistOf(item); if (item.review === "approve" && cl.status !== "approved") return approve(cl); return writeItem(item, C.complete(item, itemsOf(cl.key).filter((i) => !i.gone), config, me, now(), { preparedBy: cl.sign.preparedBy, status: cl.status })); },
    start: (item: Item) => writeItem(item, C.setStatus(item, "doing", me, now())),
    block: (item: Item, reason: string) => writeItem(item, C.setStatus(item, "blocked", me, now(), reason)),
    unblock: (item: Item) => writeItem(item, C.setStatus(item, "todo", me, now(), "")),
    notApplicable: (item: Item, reason: string) => writeItem(item, C.markNa(item, config, me, now(), reason)),
    reopen: (item: Item, reason: string) => writeItem(item, C.reopen(item, config, me, now(), reason)),
    assign: (item: Item, to: string) => writeItem(item, C.assign(item, to, config, me, now())),
    confirm: (item: Item, applies: boolean) => writeItem(item, C.confirmItem(item, applies, me, now())),
    /** Notes, due date and time estimate: saved without a history line. */
    edit: async (item: Item, p: { notes?: string; due?: string; hours?: number }) => {
      const row = data.checklistItems.find((x) => x.Key === item.key);
      if (!row) throw new Conflict("This item is no longer on the checklist. Reload.");
      await fresh("ChecklistItems", row);
      await update("ChecklistItems", row, itemPatch({ ...p, rev: item.rev + 1 }));
    },
  };

  /** A task for one checklist step, only when the person asks for it. */
  const makeTask = useCallback(async (item: Item) => {
    const cl = checklistOf(item);
    if (item.history.some((h) => h.action === "Task created")) throw new Refused("A task has already been made for this item.");
    const job = data.jobs.find((j) => j.Key === cl.jobKey);
    const client = data.clients.find((c) => c.Key === cl.clientKey);
    const taskKey = newKey("T");
    await create("Tasks", { Key: taskKey, Title: `${item.title}${client ? ` (${client.Title})` : ""}`, ClientKey: cl.clientKey, ClientName: client?.Title || "", Status: "Open", DueDate: item.due || String(job?.Deadline || ""), PlannedDate: "", EstimateHours: item.hours || 0.25, Notes: `From the checklist: ${cl.templateName}${job ? `, ${idx.serviceName.get(String(job.ServiceKey)) || ""}` : ""}.` });
    await writeItem(item, { patch: { history: [...item.history, { at: now(), by: me, action: "Task created", detail: taskKey }].slice(-40), rev: item.rev + 1 }, entry: { at: now(), by: me, action: "Task created", detail: taskKey } });
    return taskKey;
  }, [data.jobs, data.clients, create, writeItem, me, idx.serviceName, checklists]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ----- the checklist ----- */
  const answer = useCallback(async (cl: Checklist, attr: string, value: Answer) => {
    if (!C.ATTRS.some((a) => a.key === attr && a.kind !== "choice")) throw new Refused("Unknown question.");
    const answers = { ...cl.answers, [attr]: value };
    const client = data.clients.find((c) => c.Key === cl.clientKey);
    const fixed = data.paperLines.filter((l) => l.ClientKey === cl.clientKey && l.PeriodEnd === cl.period && l.SectionKey === "fixed").length;
    const facts = factsOfChecklist(client, answers, fixed);
    const changes = C.reapply(itemsOf(cl.key), facts, now(), me);
    await writeChecklist(cl, { Answers: JSON.stringify(answers) });
    const rows = changes.map((c) => ({ row: data.checklistItems.find((r) => r.Key === c.key)!, patch: itemPatch(c.patch) })).filter((c) => c.row);
    if (rows.length) await updateMany("ChecklistItems", rows);
    await audit(cl, "Question answered", { detail: `${C.ATTRS.find((a) => a.key === attr)?.label}: ${value}${changes.length ? `, ${changes.length} item${changes.length === 1 ? "" : "s"} updated` : ""}` });
  }, [data.clients, data.paperLines, data.checklistItems, items, config, me, writeChecklist, updateMany, audit]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useCallback(async (cl: Checklist) => {
    const r = C.submitForReview(itemsOf(cl.key).filter((i) => !i.gone), me, now());
    if (!("sign" in r)) throw new Refused(r.reason);
    await writeChecklist(cl, { Status: "review", ...signPatch(r.sign), ReviewedBy: "", ReviewedOn: "", ApprovedBy: "", ApprovedOn: "" });
    await audit(cl, "Submitted for review");
  }, [items, me, writeChecklist, audit]); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = useCallback(async (cl: Checklist) => {
    const r = C.approve(itemsOf(cl.key).filter((i) => !i.gone), config, me, now(), cl.sign, C.openNoteCount(notesOf(cl.key)));
    if (!("sign" in r)) throw new Refused(r.reason);
    await writeChecklist(cl, { Status: "approved", ...signPatch(r.sign) });
    await audit(cl, "Checklist approved");
    // the final-approval step itself is now done
    const mine = itemsOf(cl.key).filter((i) => !i.gone);
    for (const it of mine.filter((i) => i.review === "approve" && i.status !== "done" && i.status !== "na")) {
      const done = C.complete(it, mine, config, me, now(), { preparedBy: cl.sign.preparedBy, status: "review" });
      if ("patch" in done) await writeItem(it, done);
    }
  }, [items, notes, config, me, writeChecklist, audit, writeItem]); // eslint-disable-line react-hooks/exhaustive-deps

  const reopenChecklist = useCallback(async (cl: Checklist, why: string) => {
    if (!C.can(config, me, "reopen")) throw new Refused("Only a reviewer, manager or partner can reopen an approved checklist.");
    await writeChecklist(cl, { Status: "active", ReviewedBy: "", ReviewedOn: "", ApprovedBy: "", ApprovedOn: "" });
    await audit(cl, "Checklist reopened", { detail: why });
  }, [config, me, writeChecklist, audit]);

  /** Asks the client for what the listed steps need. An Outlook draft is made when asked (it is never sent from here),
   *  each step records the request, and the client's timeline gets an open "information requested" line. */
  const requestInfo = useCallback(async (cl: Checklist, list: Item[], o: { to: string; subject: string; body: string; draft: boolean }) => {
    if (!list.length) throw new Refused("Choose at least one item.");
    if (o.draft) {
      if (!mailAllowed()) throw new Refused("Outlook hasn't been allowed yet. Allow it, or copy the request instead.");
      if (!o.to.trim()) throw new Refused("Add the client's email address.");
      await outlookDraft(store.graph, { to: o.to, subject: o.subject, body: o.body });
    }
    const at = now();
    for (const item of list) {
      const entry = { at, by: me, action: "Information requested", detail: item.needsClient };
      await writeItem(item, { patch: { history: [...item.history, entry].slice(-40), rev: item.rev + 1 }, entry }, { detail: item.needsClient });
    }
    if (store.hasList("Activities")) {
      const k = newKey("A");
      await create("Activities", { Key: k, ClientKey: cl.clientKey, JobKey: cl.jobKey, Type: "info-requested", Title: `Information requested: ${list.map((i) => i.needsClient).join("; ").slice(0, 160)}`, Summary: `From the job checklist (${list.length} item${list.length === 1 ? "" : "s"})`, At: at, Actor: me, Source: "checklist", SourceKey: list.map((i) => i.key).join(","), EventKey: k, Status: "Open", Visibility: "normal", Created: at });
    }
  }, [store, me, writeItem, create]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The information for a step has come in. Nothing is marked completed: the accounting check still has to be done. */
  const infoReceived = useCallback(async (item: Item) => {
    const entry = { at: now(), by: me, action: "Information received", detail: item.needsClient };
    await writeItem(item, { patch: { history: [...item.history, entry].slice(-40), rev: item.rev + 1 }, entry }, { detail: item.needsClient });
    for (const a of data.activities.filter((x) => x.Type === "info-requested" && x.Status === "Open" && String(x.SourceKey || "").split(",").includes(item.key))) {
      const keys = String(a.SourceKey).split(",").filter((k) => k !== item.key && !items.find((i) => i.key === k && C.infoReceived(i)));
      if (!keys.length) await update("Activities", a, { Status: "Received" });
    }
  }, [writeItem, me, data.activities, items, update]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Completing a job with mandatory items still open: only an authorised person, with a reason, and it is recorded. */
  const overrideCompletion = useCallback(async (clKey: string, reason: string, blockers: string[]) => {
    const cl = checklists.find((c) => c.key === clKey);
    if (!cl) return;
    if (!C.can(config, me, "override")) throw new Refused("Only an authorised person can complete a job with checklist items still open.");
    if (!reason.trim()) throw new Refused("A reason is needed to complete the job with checklist items still open.");
    await audit(cl, "Mandatory override", { detail: `Job completed with open items (${blockers.join("; ").slice(0, 600)}). Reason: ${reason.trim()}` });
  }, [checklists, config, me, audit]);

  /* ----- review notes ----- */
  const noteAct = {
    raise: async (cl: Checklist, item: Item | undefined, text: string) => {
      const v = C.raiseNote(text, config, me);
      if (!v.ok) throw new Refused(v.reason);
      const key = newKey("RN");
      await create("ChecklistNotes", { Key: key, ChecklistKey: cl.key, ItemKey: item?.key || "", Text: text.trim().slice(0, 2000), RaisedBy: me, RaisedOn: now(), Status: "open", History: JSON.stringify([{ at: now(), by: me, action: "Raised", detail: text.trim().slice(0, 300) }]), Rev: 1, PracticeId: pid });
      await audit(cl, "Review note raised", { itemKey: item?.key, detail: `${item?.title || "Whole checklist"}: ${text.trim().slice(0, 200)}` });
    },
    respond: async (n: ReviewNote, text: string) => noteWrite(n, C.respondNote(n, text, me, now()), "Marked ready for re-review", text),
    resolve: async (n: ReviewNote) => noteWrite(n, C.resolveNote(n, config, me, now()), "Review note resolved"),
    reopen: async (n: ReviewNote, why: string) => noteWrite(n, C.reopenNote(n, config, me, now(), why), "Review note reopened", why),
  };
  const noteWrite = async (n: ReviewNote, r: { patch: Partial<ReviewNote> } | C.Verdict, action: string, detail = "") => {
    if (!("patch" in r)) throw new Refused(r.reason);
    const row = data.checklistNotes.find((x) => x.Key === n.key);
    if (!row) throw new Conflict("This review note is no longer there. Reload.");
    await fresh("ChecklistNotes", row);
    await update("ChecklistNotes", row, notePatch(r.patch));
    const cl = checklists.find((c) => c.key === n.checklistKey);
    if (cl) await audit(cl, action, { itemKey: n.itemKey, detail });
  };

  /* ----- working papers ----- */
  /** Completes items whose working paper is marked Done (and, for review steps, reviewed). Called when the checklist is opened. */
  const syncPapers = useCallback(async (cl: Checklist) => {
    if (cl.status === "approved") return 0;
    const mine = itemsOf(cl.key).filter((i) => !i.gone);
    let n = 0;
    for (const hit of C.paperCompletions(mine, data.papers, cl.clientKey, cl.period)) {
      const r = C.complete(hit.item, mine, config, hit.by, hit.on || now(), { preparedBy: cl.sign.preparedBy, status: cl.status });
      if (!("patch" in r)) continue; // not allowed (e.g. reviewer not on the list): leave it for a person
      const row = data.checklistItems.find((x) => x.Key === hit.item.key);
      if (!row) continue;
      try {
        await fresh("ChecklistItems", row);
        await update("ChecklistItems", row, itemPatch({ ...r.patch, history: [...hit.item.history, { at: now(), by: hit.by, action: "Completed from working papers", detail: `${hit.item.paper?.section} marked Done` }].slice(-40) }));
        await audit(cl, "Completed from working papers", { itemKey: hit.item.key, detail: `${hit.item.title} (paper marked Done by ${hit.by})` });
        n++;
      } catch { /* someone else got there first, or a save failed: the next visit tries again */ }
    }
    return n;
  }, [items, data.papers, data.checklistItems, config, fresh, update, audit]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ----- updating to a newer template ----- */
  const preview = (cl: Checklist, t: Template) => C.diffTemplate(itemsOf(cl.key), t);
  const applyUpdate = useCallback(async (cl: Checklist, t: Template) => {
    if (!C.can(config, me, "template")) throw new Refused("Only a manager or partner can apply a template update.");
    const client = data.clients.find((c) => c.Key === cl.clientKey);
    const fixed = data.paperLines.filter((l) => l.ClientKey === cl.clientKey && l.PeriodEnd === cl.period && l.SectionKey === "fixed").length;
    const out = C.applyDiff(itemsOf(cl.key), t, factsOfChecklist(client, cl.answers, fixed), { now: now(), by: me, checklistKey: cl.key });
    await writeChecklist(cl, { TemplateKey: t.id, TemplateVersion: t.version, TemplateName: t.name });
    const rows = out.patch.map((c) => ({ row: data.checklistItems.find((r) => r.Key === c.key)!, patch: itemPatch(c.patch) })).filter((c) => c.row);
    if (rows.length) await updateMany("ChecklistItems", rows);
    if (out.create.length) await createMany("ChecklistItems", out.create.map((i) => itemRow(i, { key: `${cl.key}-${i.itemId}`, checklistKey: cl.key, jobKey: cl.jobKey, pid })));
    await audit(cl, "Template updated", { detail: `${t.name} version ${t.version}: ${out.create.length} added, ${out.patch.length} changed` });
  }, [config, me, data.clients, data.paperLines, data.checklistItems, items, writeChecklist, updateMany, createMany, audit, pid]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ----- templates ----- */
  const needTemplateRights = () => { if (!C.can(config, me, "template")) throw new Refused("Only a manager or partner can change checklist templates."); };

  const saveTemplate = useCallback(async (t: Template, edit?: Partial<Template>): Promise<Template> => {
    needTemplateRights();
    const problems = C.validateTemplate({ ...t, ...(edit || {}) });
    if (problems.length) throw new Refused(problems[0]);
    const existing = data.checklistTemplates.find((r) => r.Key === t.id);
    if (!existing) {
      const fresh0 = { ...t, ...(edit || {}), version: 1, hours: C.templateHours({ sections: (edit?.sections || t.sections) }), created: now(), updated: now() };
      if (C.encodeSections(fresh0.sections).length > C.MAX_BODY) throw new Refused("This template is too large to save. Remove some text or items.");
      await create("ChecklistTemplates", templateRow(fresh0, pid));
      return fresh0;
    }
    const { next, keep } = C.saveEdit(templateFromRow(existing), { ...(edit || t), id: t.id }, now());
    if (C.encodeSections(next.sections).length > C.MAX_BODY) throw new Refused("This template is too large to save. Remove some text or items.");
    const live = await store.readItem("ChecklistTemplates", existing._id!).catch(() => undefined);
    if (!live || String(live.Updated || "") !== String(existing.Updated || "")) throw new Conflict("Someone else changed this template just now. Reload to see their change, then try again.");
    if (keep && store.hasList("ChecklistVersions")) await create("ChecklistVersions", { Key: newKey("CV"), TemplateKey: keep.id, Version: keep.version, Saved: now(), Body: C.encodeSections(keep.sections), PracticeId: pid });
    await update("ChecklistTemplates", existing, templateRow(next, pid));
    return next;
  }, [data.checklistTemplates, create, update, fresh, store, pid, config, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchTemplate = useCallback(async (id: string, patch: Row) => {
    needTemplateRights();
    const row = data.checklistTemplates.find((r) => r.Key === id);
    if (row) await update("ChecklistTemplates", row, { ...patch, Updated: now() });
  }, [data.checklistTemplates, update, config, me]); // eslint-disable-line react-hooks/exhaustive-deps

  /** One default per job type and starting condition: setting a new one clears the old. */
  const makeDefault = useCallback(async (t: Template) => {
    needTemplateRights();
    for (const r of data.checklistTemplates) {
      const x = templateFromRow(r);
      if (x.id !== t.id && x.jobType === t.jobType && x.isDefault && !!x.when?.length === !!t.when?.length) await update("ChecklistTemplates", r, { IsDefault: false });
    }
    await patchTemplate(t.id, { IsDefault: true, Active: true });
  }, [data.checklistTemplates, update, patchTemplate, config, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const duplicate = useCallback(async (t: Template, name?: string) => {
    needTemplateRights();
    const copy: Template = { ...t, id: newKey("CT"), name: name || `${t.name} (copy)`, isDefault: false, version: 1, starter: undefined, created: now(), updated: now(), sections: t.sections.map((s) => ({ ...s, id: C.newId("s"), items: s.items.map((i) => ({ ...i })) })) };
    await create("ChecklistTemplates", templateRow(copy, pid));
    return copy;
  }, [create, pid, config, me]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Saves the starter templates as the practice's own, each for the job type whose name fits. */
  const installStarters = useCallback(async () => {
    needTemplateRights();
    const made: string[] = [], skipped: string[] = [];
    for (const s of STARTERS) {
      const svc = data.services.find((x) => suits(s, String(x.Title || "")) && (!s.when || /accounts/i.test(String(x.Title))));
      if (!svc) { skipped.push(s.name); continue; }
      if (templates.some((t) => t.starter === s.starter && t.jobType === svc.Key)) continue;
      const { match: _m, ...rest } = s;
      const hasDefault = templates.some((t) => t.jobType === svc.Key && t.isDefault && !!t.when?.length === !!s.when?.length);
      await create("ChecklistTemplates", templateRow({ ...rest, id: newKey("CT"), jobType: String(svc.Key), version: 1, active: true, isDefault: !hasDefault, created: now(), updated: now() }, pid));
      made.push(s.name);
    }
    return { made, skipped };
  }, [data.services, templates, create, pid, config, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const importText = useCallback(async (text: string, jobType: string) => {
    needTemplateRights();
    const r = C.importTemplates(text);
    if (r.error) throw new Refused(r.error);
    for (const t of r.templates) {
      const full: Template = { ...t, id: newKey("CT"), jobType: t.jobType && data.services.some((s) => s.Key === t.jobType) ? t.jobType : jobType, version: 1, active: true, isDefault: false, created: now(), updated: now() };
      const bad = C.validateTemplate(full);
      if (bad.length) throw new Refused(`"${t.name}": ${bad[0]}`);
      await create("ChecklistTemplates", templateRow(full, pid));
    }
    return r.templates.length;
  }, [create, data.services, pid, config, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromChecklist = useCallback(async (cl: Checklist, name: string) => {
    needTemplateRights();
    const made = C.templateFromItems(itemsOf(cl.key), name, cl.jobType);
    const full: Template = { ...made, id: newKey("CT"), version: 1, active: true, isDefault: false, created: now(), updated: now() };
    await create("ChecklistTemplates", templateRow(full, pid));
    return full;
  }, [items, create, pid, config, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveConfig = useCallback(async (next: C.Config) => {
    const first = !C.hasStaff(config);
    if (!first && !C.can(config, me, "template")) throw new Refused("Only a manager or partner can change these settings.");
    await saveSetting(C.CONFIG_KEY, next);
  }, [config, me, saveSetting]);

  return {
    config, me, pid, templates, checklists, items, notes, ready, byJob, itemsOf, notesOf, act, noteAct, makeTask, overrideCompletion, requestInfo, infoReceived, answer, submit, approve, reopenChecklist, syncPapers, preview, applyUpdate,
    saveTemplate, patchTemplate, makeDefault, duplicate, installStarters, importText, fromChecklist, saveConfig, attach: attachChecklist, reload, today: todayIso(),
    log: (clKey: string) => data.checklistLog.filter((l) => l.ChecklistKey === clKey).sort((a, b) => String(b.At).localeCompare(String(a.At))),
    versions: (tKey: string) => data.checklistVersions.filter((v) => v.TemplateKey === tKey).sort((a, b) => num(b.Version) - num(a.Version)),
  };
}

export { allItems };
