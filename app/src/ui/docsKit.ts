// Documents: the data layer for the screens. Reads branding, templates, versions and generated
// documents from the planner's lists, and does the saving: branding to Settings, templates and their
// earlier versions to their lists, and a generated document to OneDrive and the Documents list.
// Nothing here draws anything; the pure parts live in lib/doc*.ts.
import { useCallback, useMemo } from "react";
import { BrandingSet, SETTING_KEY, brandOf, cleanBranding, readBranding, Branding } from "../lib/docBranding";
import { Category, DocTemplate, TemplateVersion, asCategory, decodeBody, encodeBody, library, saveEdit as applyEdit, STARTERS } from "../lib/docTemplates";
import { DocContent, DocLayout, allRuns } from "../lib/docModel";
import { LETTERS_FOLDER, clientFolder } from "../lib/comms";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { loadPdfLib, renderPdf } from "../lib/docPdf";
import { FieldContext, fillContent, resolveValues } from "../lib/docFields";
import { todayIso } from "../lib/domain";
import { useData, useIndex } from "./data";

const bool = (v: unknown) => v === true || v === "true" || v === 1;

export function templateFromRow(r: Row): DocTemplate {
  const body = decodeBody(String(r.Body || ""));
  return {
    id: String(r.Key), name: String(r.Title || "Untitled template"), category: asCategory(String(r.Category || "")), description: String(r.Description || ""),
    content: body.content, layout: body.layout, version: Number(r.Version) || 1, archived: bool(r.Archived), isDefault: bool(r.IsDefault),
    brandingId: r.BrandingId ? String(r.BrandingId) : undefined, updated: r.Updated ? String(r.Updated) : undefined,
  };
}
export function versionFromRow(r: Row): TemplateVersion {
  const body = decodeBody(String(r.Body || ""));
  return { templateId: String(r.TemplateKey), version: Number(r.Version) || 1, name: String(r.Title || ""), content: body.content, layout: body.layout, saved: String(r.Saved || "") };
}

export type DocRecord = {
  row: Row;
  key: string; clientKey: string; jobKey: string; templateKey: string; templateVersion: number; templateName: string; category: string;
  title: string; reference: string; created: string; createdBy: string; fileUrl: string; fileName: string; pages: number; status: string; sentOn: string; sentTo: string;
};
export const docFromRow = (r: Row): DocRecord => ({
  row: r, key: String(r.Key), clientKey: String(r.ClientKey || ""), jobKey: String(r.JobKey || ""), templateKey: String(r.TemplateKey || ""), templateVersion: Number(r.TemplateVersion) || 0,
  templateName: String(r.TemplateName || ""), category: String(r.Category || ""), title: String(r.Title || ""), reference: String(r.Reference || ""), created: String(r.Created || ""),
  createdBy: String(r.CreatedBy || ""), fileUrl: String(r.FileUrl || ""), fileName: String(r.FileName || ""), pages: Number(r.Pages) || 0, status: String(r.Status || ""), sentOn: String(r.SentOn || ""), sentTo: String(r.SentTo || ""),
});

/** Largest body a list row will hold comfortably. */
export const MAX_BODY = 60000;
export class TooBig extends Error {}

export function useDocs() {
  const { data, store, create, update, remove, saveSetting, user } = useData();
  const set = useMemo(() => readBranding(data.settings), [data.settings]);
  const templates = useMemo(() => data.docTemplates.map(templateFromRow), [data.docTemplates]);
  const versions = useMemo(() => data.docVersions.map(versionFromRow), [data.docVersions]);
  const documents = useMemo(() => data.documents.map(docFromRow).sort((a, b) => b.created.localeCompare(a.created)), [data.documents]);
  const all = useMemo(() => library(templates), [templates]);
  const find = useCallback((id: string) => all.find((t) => t.id === id) || templates.find((t) => t.id === id), [all, templates]);
  const ready = store.hasList("DocTemplates") && store.hasList("Documents");

  const saveBranding = useCallback((next: BrandingSet) => saveSetting(SETTING_KEY, { ...next, profiles: next.profiles.map((p) => cleanBranding(p)) }), [saveSetting]);

  const rowFor = (t: DocTemplate): Row => ({
    Key: t.id, Title: t.name, Category: t.category, Description: t.description, Version: t.version, Archived: t.archived, IsDefault: t.isDefault,
    BrandingId: t.brandingId || "", Updated: t.updated || new Date().toISOString(), Body: encodeBody({ content: t.content, layout: t.layout }),
  });
  const checkSize = (t: DocTemplate) => {
    if (encodeBody({ content: t.content, layout: t.layout }).length > MAX_BODY) throw new TooBig("This template is too large to save (usually because of pictures). Remove or shrink an image and try again.");
  };

  /** Saves a template: new ones are created, edited ones keep the old version when the content or layout changed. */
  const saveTemplate = useCallback(async (t: DocTemplate, edit?: Partial<DocTemplate>): Promise<DocTemplate> => {
    const existing = data.docTemplates.find((r) => r.Key === t.id);
    if (!existing) {
      const fresh = { ...t, ...(edit || {}), starter: undefined };
      checkSize(fresh);
      await create("DocTemplates", rowFor(fresh));
      return fresh;
    }
    const { next, keep } = applyEdit(templateFromRow(existing), (edit || t) as never);
    checkSize(next);
    if (keep) {
      await create("DocVersions", { Key: newKey("V"), Title: keep.name, TemplateKey: keep.templateId, Version: keep.version, Saved: keep.saved, Body: encodeBody({ content: keep.content, layout: keep.layout }) });
    }
    await update("DocTemplates", existing, rowFor(next));
    return next;
  }, [data.docTemplates, create, update]);

  const patchTemplate = useCallback(async (id: string, patch: Row) => {
    const existing = data.docTemplates.find((r) => r.Key === id);
    if (existing) await update("DocTemplates", existing, patch);
  }, [data.docTemplates, update]);

  const makeDefault = useCallback(async (t: DocTemplate) => {
    for (const r of data.docTemplates) {
      const x = templateFromRow(r);
      if (x.category === t.category && x.isDefault && x.id !== t.id) await update("DocTemplates", r, { IsDefault: false });
    }
    await patchTemplate(t.id, { IsDefault: true });
  }, [data.docTemplates, update, patchTemplate]);

  return { set, brand: (id?: string) => brandOf(set, id), templates, versions, documents, all, find, ready, saveBranding, saveTemplate, patchTemplate, makeDefault, removeTemplate: (id: string) => { const r = data.docTemplates.find((x) => x.Key === id); return r ? remove("DocTemplates", r) : Promise.resolve(); }, user, store, create, update, data };
}

export type MadeDoc = {
  bytes: Uint8Array; pages: number; fileName: string;
};
const safeName = (s: string) => s.replace(/[\\/:*?"<>|#%{}~&]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
export function documentFileName(title: string, date: string, ref: string) {
  return `${date} ${safeName(title) || "Document"}${ref ? ` ${ref}` : ""}.pdf`.replace(/\s+/g, " ");
}

/** Lays out the finished document (merge fields already filled in) as a PDF. */
export async function makePdf(input: { content: DocContent; layout: DocLayout; branding: Branding; title: string; reference: string; author?: string }): Promise<{ bytes: Uint8Array; pages: number }> {
  const lib = await loadPdfLib();
  const bytes = await renderPdf(lib, input);
  const pages = (await lib.PDFDocument.load(bytes)).getPageCount();
  return { bytes, pages };
}

/** A copy of the content to keep with the document: pictures are dropped if it would otherwise be too big for a list row. */
export function snapshotOf(content: DocContent, layout: DocLayout, extra: Record<string, unknown>): string {
  let s = JSON.stringify({ content, layout, ...extra });
  if (s.length > MAX_BODY) {
    const thin = { ...content, blocks: content.blocks.map((b) => (b.type === "img" ? { ...b, src: "" } : b)) };
    s = JSON.stringify({ content: thin, layout, ...extra, imagesDropped: true });
  }
  return s.length > MAX_BODY ? JSON.stringify({ layout, ...extra, tooLarge: true, text: allRuns(content).map((r) => r.t).join("").slice(0, 20000) }) : s;
}

export { LETTERS_FOLDER, clientFolder, STARTERS };
export type { Category };

/** Builds the context the merge fields read from: the client, the job, the practice and today. */
export function useFieldCtx() {
  const { data } = useData();
  const idx = useIndex();
  return useCallback((clientKey: string, jobKey: string, branding: Branding, reference: string): FieldContext => {
    const client = data.clients.find((c) => c.Key === clientKey);
    const job = data.jobs.find((j) => j.Key === jobKey);
    const serviceName = job ? idx.serviceName.get(String(job.ServiceKey || "")) || job.Title || "" : "";
    return { client, job, serviceName, branding, today: todayIso(), reference };
  }, [data.clients, data.jobs, idx.serviceName]);
}

/** The next document reference: DOC-2026-0001, counting this year's documents. */
export function nextReference(documents: { reference: string }[], year = new Date().getFullYear()): string {
  const prefix = `DOC-${year}-`;
  const used = documents.map((d) => (d.reference.startsWith(prefix) ? Number(d.reference.slice(prefix.length)) || 0 : 0));
  return `${prefix}${String(Math.max(0, ...used) + 1).padStart(4, "0")}`;
}

export { fillContent, resolveValues };
