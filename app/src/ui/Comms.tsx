// Letters and emails to clients. Write with AI (from a short brief), change with AI or by
// hand, then make a Word letter in your letterhead (saved to OneDrive) or put an email in
// your Outlook drafts. Every letter and email is kept on the client's record.
import { ReactNode, forwardRef, useEffect, useRef, useState } from "react";
import { addScope } from "../lib/auth";
import { AiError, AiStatus } from "../lib/ai";
import { CommsTabs, MAIL_SCOPE, downloadFile, isDemo, mailAllowed, useAi, useCommsPrefs } from "./commsKit";
import { MeetingPage, MeetingsList } from "./Meetings";
import { MailPage } from "./MailPage";
import { DocumentsPage } from "./Documents";
import { PaymentReminders } from "./TaxPayments";
import { paymentsForAi, TaxPayment } from "../lib/taxPayments";
import {
  CHANGE_STARTERS, CommKind, CommStatus, CommsPrefs, EMAIL_STARTERS, LETTERS_FOLDER, LETTER_STARTERS, STATUS_TEXT, addressLines,
  aiContext, clientFolder, emailGreeting, letterFileName, letterheadPath, longDate, oneLine, parseLetter, salutationFor, signOffFor, toBase64,
} from "../lib/comms";
import { DOCX_TYPE, Letter, checkLetterhead, letterDocx, NotWordFile } from "../lib/docx";
import { Client, Job, fmtDate, todayIso } from "../lib/domain";
import { Row } from "../lib/schema";
import { stageLabel } from "../lib/stages";
import { plainText, toHtml } from "../lib/richText";
import { newKey } from "../lib/planning";
import { svcClass } from "../lib/serviceColour";
import { Icon, go, href, useRoute } from "./bits";
import { useData, useIndex } from "./data";

// the letterhead is fetched once a visit (per upload)
let letterheadCache: { uploaded: string; bytes: Uint8Array } | null = null;
async function getLetterhead(graph: { download: (p: string) => Promise<Uint8Array> }, prefs: CommsPrefs): Promise<Uint8Array | null> {
  if (!prefs.letterhead) return null;
  if (letterheadCache?.uploaded === prefs.letterhead.uploaded) return letterheadCache.bytes;
  const bytes = await graph.download(letterheadPath());
  letterheadCache = { uploaded: prefs.letterhead.uploaded, bytes };
  return bytes;
}

const kindName = (k: CommKind) => (k === "letter" ? "Letter" : "Email");

// ------------------------------------------------------------------ the list

export function CommsPage() {
  const { parts, query } = useRoute();
  if (parts[1] === "payments") return <PaymentReminders />;
  if (parts[1] === "mail") return <MailPage />;
  if (parts[1] === "documents") return <DocumentsPage />;
  if (parts[1] === "meetings" && parts[2] === "new") {
    return <MeetingPage key={`new-${query.toString()}`} initial={{ clientKey: query.get("client") || "", kind: query.get("kind") || "meeting", jobKey: query.get("job") || "" }} />;
  }
  if (parts[1] === "meetings" && parts[2]) return <MeetingPage key={parts[2]} meetingKey={parts[2]} />;
  if (parts[1] === "meetings") return <MeetingsList />;
  if (parts[1] === "new") {
    return (
      <Composer
        key={`new-${query.toString()}`}
        initial={{
          clientKey: query.get("client") || "", kind: query.get("kind") === "email" ? "email" : "letter", jobKey: query.get("job") || "",
          brief: query.get("brief") || "", subject: query.get("subject") || "", body: query.get("body") || "",
        }}
      />
    );
  }
  if (parts[1]) return <Composer key={parts[1]} commKey={parts[1]} />;
  return (
    <div className="page">
      <CommsTabs current="letters" />
      <div className="page-head">
        <div>
          <h1>Letters and emails</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Write with AI or by hand. Letters go into your letterhead as Word files; emails go into your Outlook drafts.</p>
        </div>
        <NewButtons />
      </div>
      <CommsList />
    </div>
  );
}

export function NewButtons({ clientKey, jobKey }: { clientKey?: string; jobKey?: string }) {
  const q = (kind: CommKind) => `#/comms/new?kind=${kind}${clientKey ? `&client=${encodeURIComponent(clientKey)}` : ""}${jobKey ? `&job=${encodeURIComponent(jobKey)}` : ""}`;
  return (
    <div className="row-wrap">
      <a className="btn" href={q("email")}><Icon name="mail" />New email</a>
      <a className="btn primary" href={q("letter")}><Icon name="letter" />New letter</a>
    </div>
  );
}

export function CommsList({ clientKey }: { clientKey?: string }) {
  const { data } = useData();
  const idx = useIndex();
  const [kind, setKind] = useState<"all" | CommKind>("all");
  const [drafts, setDrafts] = useState(false);
  const [search, setSearch] = useState("");
  const rows = data.comms
    .filter((c) => !clientKey || c.ClientKey === clientKey)
    .filter((c) => kind === "all" || c.Kind === kind)
    .filter((c) => !drafts || (c.Status || "draft") === "draft")
    .filter((c) => !search || `${c.Subject || ""} ${idx.clientByKey.get(String(c.ClientKey))?.Title || ""} ${c.Body || ""}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => String(b.Updated || b.Created || "").localeCompare(String(a.Updated || a.Created || "")));
  const total = data.comms.filter((c) => !clientKey || c.ClientKey === clientKey).length;

  return (
    <section className="card" aria-label="Letters and emails">
      <div className="card-head comms-filters">
        <div className="seg" role="group" aria-label="Show">
          {(["all", "letter", "email"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{k === "all" ? "All" : k === "letter" ? "Letters" : "Emails"}</button>
          ))}
        </div>
        <label className="row-wrap" style={{ gap: 6, fontSize: 14 }}>
          <input type="checkbox" checked={drafts} onChange={(e) => setDrafts(e.target.checked)} style={{ width: 18, height: 18 }} /> Drafts only
        </label>
        <label className="search" style={{ flex: "1 1 200px", maxWidth: 360 }}>
          <Icon name="search" />
          <span className="sr-only">Search letters and emails</span>
          <input type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      {rows.length ? (
        <ul className="comms-list">
          {rows.map((c) => {
            const client = idx.clientByKey.get(String(c.ClientKey));
            const st = (c.Status || "draft") as CommStatus;
            return (
              <li key={String(c.Key)}>
                <a href={href("comms", String(c.Key))} className="comms-row">
                  <span className={`comms-kind ${c.Kind === "email" ? "email" : "letter"}`} aria-hidden="true"><Icon name={c.Kind === "email" ? "mail" : "letter"} /></span>
                  <span className="stack" style={{ gap: 2, minWidth: 0, flex: "1 1 auto" }}>
                    <strong className="comms-subject">{String(c.Subject || "") || <span className="muted">No subject yet</span>}</strong>
                    <span className="muted comms-meta">
                      {kindName(c.Kind as CommKind)}{!clientKey && client ? ` · ${client.Title}` : ""} · {fmtDate(String(c.Updated || c.Created || "").slice(0, 10))}
                    </span>
                    <span className="comms-snippet">{plainText(String(c.Body || "")).slice(0, 140)}</span>
                  </span>
                  <span className={`chip${st === "draft" ? "" : st === "word" ? " blue" : " green"}`}>{STATUS_TEXT[st] || "Draft"}</span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty" style={{ padding: 24 }}>
          {total ? "Nothing matches." : clientKey ? "No letters or emails for this client yet." : "No letters or emails yet. Start one with New letter or New email."}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ the composer

type Draft = {
  Key: string; ClientKey: string; JobKey: string; Kind: CommKind; Status: CommStatus; Subject: string; Body: string; Brief: string;
  ToEmail: string; Address: string; Salutation: string; SignOff: string; LetterDate: string; Created: string; Updated: string;
  FileUrl: string; FileName: string; OutlookUrl: string;
};
const FIELDS: (keyof Draft)[] = ["ClientKey", "JobKey", "Kind", "Status", "Subject", "Body", "Brief", "ToEmail", "Address", "Salutation", "SignOff", "LetterDate", "FileUrl", "FileName", "OutlookUrl"];

function fromRow(r: Row): Draft {
  const s = (k: string) => String(r[k] ?? "");
  return {
    Key: s("Key"), ClientKey: s("ClientKey"), JobKey: s("JobKey"), Kind: r.Kind === "email" ? "email" : "letter", Status: (s("Status") || "draft") as CommStatus,
    Subject: s("Subject"), Body: s("Body"), Brief: s("Brief"), ToEmail: s("ToEmail"), Address: s("Address"), Salutation: s("Salutation"),
    SignOff: s("SignOff"), LetterDate: s("LetterDate"), Created: s("Created"), Updated: s("Updated"), FileUrl: s("FileUrl"), FileName: s("FileName"),
    OutlookUrl: s("OutlookUrl"),
  };
}

/** Address, "Dear ..." and email address filled in from the client's record. */
function forClient(d: Draft, c: Client | undefined, prefs: CommsPrefs): Draft {
  if (!c) return d;
  const sal = salutationFor(c);
  return { ...d, Address: addressLines(c).join("\n"), Salutation: sal, SignOff: signOffFor(sal, prefs), ToEmail: String(c.Email || "") };
}

type Busy = "" | "write" | "change" | "word" | "outlook" | "save";

function Composer({ commKey, initial }: { commKey?: string; initial?: { clientKey: string; kind: CommKind; jobKey: string; brief?: string; subject?: string; body?: string } }) {
  const { data, store, create, update, remove } = useData();
  const idx = useIndex();
  const prefs = useCommsPrefs();
  const ai = useAi();
  const today = todayIso();
  const existing = commKey ? data.comms.find((c) => c.Key === commKey) : undefined;

  const [draft, setDraft] = useState<Draft>(() => {
    if (existing) return fromRow(existing);
    const base: Draft = {
      Key: newKey("M"), ClientKey: initial?.clientKey || "", JobKey: initial?.jobKey || "", Kind: initial?.kind || "letter", Status: "draft",
      Subject: initial?.subject || "", Body: initial?.body || "", Brief: initial?.brief || "", ToEmail: "", Address: "", Salutation: "", SignOff: prefs.signOff, LetterDate: today,
      Created: new Date().toISOString(), Updated: "", FileUrl: "", FileName: "", OutlookUrl: "",
    };
    return forClient(base, idx.clientByKey.get(base.ClientKey), prefs);
  });
  const [saved, setSaved] = useState(!!existing);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<ReactNode>();
  const [change, setChange] = useState("");
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [history, setHistory] = useState<{ subject: string; body: string; why: string }[]>([]);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(draft);
  latest.current = draft;

  useEffect(() => {
    ai.status(prefs.model || undefined).then(setAiStatus).catch(() => setAiStatus({ configured: false }));
  }, [ai, prefs.model]);

  const client = idx.clientByKey.get(draft.ClientKey);
  const jobs = (idx.jobsByClient.get(draft.ClientKey) || []).filter((j) => j.Status !== "Complete");
  const job = jobs.find((j) => j.Key === draft.JobKey);
  const isLetter = draft.Kind === "letter";

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  /** Save to SharePoint: the first save adds it to the client's record. */
  const persist = async (patch: Partial<Draft> = {}) => {
    const d = { ...latest.current, ...patch, Updated: new Date().toISOString() };
    setDraft(d);
    latest.current = d;
    if (!d.ClientKey) return;
    const row = data.comms.find((c) => c.Key === d.Key);
    const fields: Row = Object.fromEntries(FIELDS.map((k) => [k, d[k]]));
    fields.Updated = d.Updated;
    fields.Title = d.Subject || `${kindName(d.Kind)} to ${client?.Title || ""}`.trim();
    if (row) await update("Communications", row, fields);
    else {
      await create("Communications", { Key: d.Key, Created: d.Created, ...fields });
      setSaved(true);
      // the address bar points at this one now, so a refresh comes back to it
      window.history.replaceState(null, "", `#/comms/${encodeURIComponent(d.Key)}`);
    }
    setDirty(false);
  };

  // save a moment after typing stops
  useEffect(() => {
    if (!dirty || !draft.ClientKey || (!draft.Body.trim() && !draft.Subject.trim() && !saved)) return;
    const t = window.setTimeout(() => void persist().catch(() => setError("Couldn't save. Check your connection; your text is still here.")), 1500);
    return () => window.clearTimeout(t);
  }, [draft, dirty]);

  const context = () =>
    client
      ? aiContext({
          client, jobs, job, today, kind: draft.Kind, salutation: draft.Salutation || salutationFor(client), prefs,
          stageName: (j: Job) => stageLabel(j, idx.stagesByService.get(j.ServiceKey || "") || []),
          serviceName: (k?: string) => idx.serviceName.get(k || "") || "",
          payments: paymentsForAi(data.taxPayments as TaxPayment[], client.Key, today),
        })
      : {};

  const aiError = (e: unknown) => setError(e instanceof AiError ? e.message : "The AI couldn't write that. Try again.");

  const writeIt = async (brief = draft.Brief) => {
    if (!client) return setError("Choose the client first.");
    if (!brief.trim()) return setError("Say in a few words what it's about.");
    if (draft.Body.trim() && !window.confirm("Replace the current text with a new draft? You can undo it afterwards.")) return;
    setBusy("write");
    setError(undefined);
    try {
      const a = await ai.write({ kind: draft.Kind, mode: "draft", brief, context: context(), style: prefs.style || undefined, model: prefs.model || undefined });
      setHistory((h) => [...h, { subject: draft.Subject, body: draft.Body, why: "new draft" }]);
      set({ Brief: brief, Subject: a.subject || draft.Subject, Body: a.body });
    } catch (e) {
      aiError(e);
    } finally {
      setBusy("");
    }
  };

  const changeIt = async (instruction = change) => {
    if (!instruction.trim()) return setError("Say what to change.");
    setBusy("change");
    setError(undefined);
    try {
      const a = await ai.write({
        kind: draft.Kind, mode: "amend", instruction, current: { subject: draft.Subject, body: draft.Body }, context: context(),
        style: prefs.style || undefined, model: prefs.model || undefined,
      });
      setHistory((h) => [...h, { subject: draft.Subject, body: draft.Body, why: instruction }]);
      set({ Subject: a.subject || draft.Subject, Body: a.body });
      setChange("");
    } catch (e) {
      aiError(e);
    } finally {
      setBusy("");
    }
  };

  const undoAi = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    set({ Subject: last.subject, Body: last.body });
  };

  // ---- simple formatting by hand
  const wrapBold = () => {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    if (a === b) return;
    const next = `${value.slice(0, a)}**${value.slice(a, b)}**${value.slice(b)}`;
    set({ Body: next });
    requestAnimationFrame(() => el.setSelectionRange(a + 2, b + 2));
  };
  const makeList = () => {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const start = value.lastIndexOf("\n", a - 1) + 1;
    const endNl = value.indexOf("\n", b);
    const end = endNl < 0 ? value.length : endNl;
    const block = value.slice(start, end).split("\n").map((l) => (l.trim() && !/^\s*- /.test(l) ? `- ${l.trim()}` : l)).join("\n");
    set({ Body: value.slice(0, start) + block + value.slice(end) });
  };

  // ---- a table: rows with tabs between the cells (as pasted from Excel)
  const insertTable = () => {
    const el = bodyRef.current;
    const value = draft.Body;
    const at = el ? el.selectionEnd : value.length;
    const before = value.slice(0, at), after = value.slice(at);
    const table = "Item\t2026\t2025\nFirst line\t0.00\t0.00\nSecond line\t0.00\t0.00";
    const lead = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const trail = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : after ? "\n\n" : "";
    set({ Body: before + lead + table + trail + after });
  };

  // ---- a whole letter pasted in: split into date, address, greeting, subject, body and sign-off
  const usePasted = () => {
    const p = parseLetter(pasted);
    set({
      ...(p.date ? { LetterDate: p.date } : {}),
      ...(p.address ? { Address: p.address } : {}),
      ...(p.salutation ? { Salutation: p.salutation } : {}),
      ...(p.subject ? { Subject: p.subject } : {}),
      ...(p.signOff ? { SignOff: p.signOff } : {}),
      Body: p.body,
    });
    setPasted("");
    setPasting(false);
  };
  const pastedParts = pasting && pasted.trim() ? parseLetter(pasted) : undefined;

  // ---- outputs
  const letter = (): Letter => ({
    date: longDate(draft.LetterDate || today),
    address: draft.Address.split("\n"),
    salutation: draft.Salutation,
    subject: draft.Subject,
    body: draft.Body,
    signOff: draft.SignOff || signOffFor(draft.Salutation, prefs),
    signName: prefs.signName || "[Your name]",
    signTitle: prefs.signTitle || undefined,
  });

  const buildWord = async () => {
    const head = await getLetterhead(store.graph, prefs);
    return letterDocx(letter(), head);
  };

  const makeWord = async () => {
    if (!draft.Body.trim()) return setError("Write the letter first.");
    setBusy("word");
    setError(undefined);
    setNote(undefined);
    try {
      const bytes = await buildWord();
      const name = letterFileName(draft.LetterDate || today, draft.Subject || `Letter to ${client?.Title || ""}`);
      downloadFile(bytes, name, DOCX_TYPE);
      let fileUrl = "";
      try {
        const path = `/me/drive/root:/${encodeURIComponent(LETTERS_FOLDER)}/${encodeURIComponent(clientFolder(client?.Title || "Client"))}/${encodeURIComponent(name)}:/content`;
        const item = await store.graph.put<{ webUrl?: string }>(path, bytes, DOCX_TYPE);
        fileUrl = item.webUrl || "";
      } catch {
        setError("The Word letter downloaded, but couldn't be saved to OneDrive. Try again to save a copy there.");
      }
      await persist({ Status: draft.Status === "outlook" ? "outlook" : "word", FileUrl: fileUrl || draft.FileUrl, FileName: name });
      setNote(<>Word letter made{fileUrl ? <> and saved to OneDrive › {LETTERS_FOLDER} › {clientFolder(client?.Title || "")}</> : null}. It's also in your downloads.</>);
    } catch (e) {
      setError(e instanceof NotWordFile ? `Your letterhead couldn't be used: ${e.message} Upload it again in Settings › Letters and email.` : "Couldn't make the Word letter. Try again.");
    } finally {
      setBusy("");
    }
  };

  const needsMail = !mailAllowed();
  const allowMail = async () => {
    await persist().catch(() => undefined);
    await addScope(MAIL_SCOPE, true); // Microsoft asks you to allow it, then you come back here
  };

  const toOutlook = async () => {
    if (!draft.Body.trim()) return setError(`Write the ${isLetter ? "letter" : "email"} first.`);
    const to = (isLetter ? String(client?.Email || "") : draft.ToEmail).trim();
    setBusy("outlook");
    setError(undefined);
    setNote(undefined);
    try {
      const html = isLetter
        ? toHtml(`${emailGreeting(client!)}\n\nPlease find attached a letter about ${draft.Subject ? draft.Subject.charAt(0).toLowerCase() + draft.Subject.slice(1) : "your affairs"}.\n\nKind regards,\n${(prefs.signName || "").split(" ")[0]}`, prefs.emailSignature)
        : toHtml(draft.Body, prefs.emailSignature);
      const msg = await store.graph.post<{ id: string; webLink?: string }>("/me/messages", {
        subject: oneLine(draft.Subject) || (isLetter ? "Letter" : ""),
        body: { contentType: "HTML", content: html },
        toRecipients: to ? to.split(/[;,]\s*/).filter(Boolean).map((address) => ({ emailAddress: { address } })) : [],
      });
      if (isLetter) {
        const bytes = await buildWord();
        const name = letterFileName(draft.LetterDate || today, draft.Subject || "Letter");
        await store.graph.post(`/me/messages/${encodeURIComponent(msg.id)}/attachments`, {
          "@odata.type": "#microsoft.graph.fileAttachment", name, contentType: DOCX_TYPE, contentBytes: toBase64(bytes),
        });
      }
      await persist({ Status: "outlook", OutlookUrl: msg.webLink || "" });
      setNote(<>In your Outlook drafts{to ? ` to ${to}` : " (add who it's to in Outlook)"}{isLetter ? ", with the letter attached" : ""}. Check it and send it from Outlook.</>);
    } catch (e: any) {
      if (e?.status === 403 || e?.status === 401) setError("Outlook didn't allow it. Use Allow Outlook drafts below, then try again.");
      else setError("Couldn't put it in your Outlook drafts. Try again.");
    } finally {
      setBusy("");
    }
  };

  const del = async () => {
    if (!window.confirm(`Delete this ${isLetter ? "letter" : "email"} from the planner? Word files and Outlook drafts already made stay where they are.`)) return;
    const row = data.comms.find((c) => c.Key === draft.Key);
    if (row) await remove("Communications", row);
    go(client ? `/clients/${encodeURIComponent(client.Key)}/comms` : "/comms");
  };

  if (commKey && !existing && !saved) {
    return (
      <div className="page">
        <div className="card empty" style={{ padding: 24 }}>That letter or email isn't here any more. <a href="#/comms">Back to letters and emails</a></div>
      </div>
    );
  }

  const aiReady = !!aiStatus?.configured;
  const starters = isLetter ? LETTER_STARTERS : EMAIL_STARTERS;

  return (
    <div className="page composer-page">
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <a href={client ? href("clients", client.Key, "comms") : "#/comms"} className="muted" style={{ fontSize: 13 }}>
            ← {client ? `${client.Title}: letters and emails` : "Letters and emails"}
          </a>
          <h1>{saved ? (oneLine(draft.Subject) || `${kindName(draft.Kind)} to ${client?.Title || ""}`) : `New ${isLetter ? "letter" : "email"}`}</h1>
        </div>
        <div className="row-wrap" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }} role="status">
            {dirty ? "Not saved yet" : saved ? `Saved${draft.Updated ? ` ${new Date(draft.Updated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}` : ""}
          </span>
          <span className={`chip${draft.Status === "draft" ? "" : draft.Status === "word" ? " blue" : " green"}`}>{STATUS_TEXT[draft.Status]}</span>
        </div>
      </div>

      <div className="composer">
        <aside className="composer-side">
          <section className="card pad stack" aria-labelledby="who-h">
            <h2 id="who-h" className="composer-h">Who it's to</h2>
            {!saved ? (
              <div className="seg" role="group" aria-label="Letter or email">
                {(["letter", "email"] as CommKind[]).map((k) => (
                  <button key={k} type="button" aria-pressed={draft.Kind === k} onClick={() => set({ Kind: k })}><Icon name={k === "email" ? "mail" : "letter"} />{kindName(k)}</button>
                ))}
              </div>
            ) : null}
            <label>
              Client
              <select className="input" value={draft.ClientKey} disabled={saved}
                onChange={(e) => setDraft((d) => forClient({ ...d, ClientKey: e.target.value, JobKey: "" }, idx.clientByKey.get(e.target.value), prefs))}>
                <option value="">Choose…</option>
                {data.clients.filter((c) => c.Status !== "Archived").map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}
              </select>
            </label>
            {client && (
              <label>
                About a job (optional)
                <select className="input" value={draft.JobKey} onChange={(e) => set({ JobKey: e.target.value })}>
                  <option value="">Not about one job</option>
                  {jobs.map((j) => (
                    <option key={j.Key} value={j.Key}>{idx.serviceName.get(j.ServiceKey || "") || j.Title}{j.PeriodEnd ? ` · to ${fmtDate(j.PeriodEnd)}` : ""}</option>
                  ))}
                </select>
              </label>
            )}
            {job && <span className="muted" style={{ fontSize: 12 }}><span className={`svc-dot ${svcClass(job.ServiceKey)}`} aria-hidden="true" /> The AI is told this job's dates and stage.</span>}
          </section>

          <section className="card pad stack ai-card" aria-labelledby="ai-h">
            <h2 id="ai-h" className="composer-h"><Icon name="spark" />Write with AI</h2>
            {aiStatus && !aiReady && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                AI isn't set up yet. You can still write it yourself. To add AI, see <a href="#/settings/letters">Settings › Letters and email</a>.
              </p>
            )}
            <label>
              What's it about?
              <textarea className="input" rows={3} value={draft.Brief} placeholder={isLetter ? "e.g. Accounts are ready; ask them to check them and sign the approval by the end of the month" : "e.g. Chase the bank statements for March and April"}
                onChange={(e) => set({ Brief: e.target.value })} />
            </label>
            <div className="starter-chips" aria-label="Ideas">
              {starters.map((s) => <button key={s} type="button" className="chip-btn" onClick={() => set({ Brief: s })}>{s}</button>)}
            </div>
            <button type="button" className="btn primary" disabled={!aiReady || !client || busy !== ""} onClick={() => writeIt()}>
              <Icon name="spark" />{busy === "write" ? "Writing…" : draft.Body.trim() ? "Write a new draft" : `Write the ${isLetter ? "letter" : "email"}`}
            </button>

            {draft.Body.trim() && (
              <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--line-2)", paddingTop: 12 }}>
                <label>
                  Change it
                  <input className="input" value={change} placeholder="e.g. Mention the payment is due 31 January" onChange={(e) => setChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && aiReady && busy === "" && changeIt()} />
                </label>
                <div className="starter-chips">
                  {CHANGE_STARTERS.map((s) => <button key={s} type="button" className="chip-btn" disabled={!aiReady || busy !== ""} onClick={() => changeIt(s)}>{s}</button>)}
                </div>
                <div className="row-wrap" style={{ justifyContent: "space-between" }}>
                  <button type="button" className="btn small" disabled={!history.length || busy !== ""} onClick={undoAi}>Undo AI change</button>
                  <button type="button" className="btn small primary" disabled={!aiReady || !change.trim() || busy !== ""} onClick={() => changeIt()}>
                    {busy === "change" ? "Changing…" : "Change"}
                  </button>
                </div>
              </div>
            )}
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              The AI is sent the client's name, contact, address greeting and open work (no tax references). Always read it before it goes out.
            </p>
          </section>
        </aside>

        <section className="composer-doc" aria-label={isLetter ? "The letter" : "The email"}>
          <div className={`docpage ${isLetter ? "letter" : "email"}`}>
            {isLetter ? (
              <>
                <div className="doc-row">
                  <label className="doc-field" style={{ maxWidth: 200 }}>
                    <span>Date</span>
                    <input className="input" type="date" value={draft.LetterDate} onChange={(e) => set({ LetterDate: e.target.value })} />
                  </label>
                </div>
                <label className="doc-field">
                  <span>Address</span>
                  <textarea className="input doc-address" rows={Math.max(3, draft.Address.split("\n").length)} value={draft.Address} onChange={(e) => set({ Address: e.target.value })} />
                </label>
                <label className="doc-field">
                  <span>Greeting</span>
                  <input className="input" value={draft.Salutation} onChange={(e) => set({ Salutation: e.target.value })} />
                </label>
                <label className="doc-field">
                  <span>Subject line (bold on the letter; press Enter for a second line)</span>
                  <textarea className="input doc-subject" rows={Math.max(1, draft.Subject.split("\n").length)} value={draft.Subject} onChange={(e) => set({ Subject: e.target.value })} />
                </label>
              </>
            ) : (
              <>
                <label className="doc-field">
                  <span>To</span>
                  <input className="input" type="email" multiple value={draft.ToEmail} placeholder={client ? "No email on the client's record" : ""} onChange={(e) => set({ ToEmail: e.target.value })} />
                </label>
                <label className="doc-field">
                  <span>Subject</span>
                  <input className="input doc-subject" value={draft.Subject} onChange={(e) => set({ Subject: e.target.value })} />
                </label>
              </>
            )}
            {isLetter && (
              <div className="doc-paste">
                {!pasting ? (
                  <button type="button" className="btn small" onClick={() => setPasting(true)}>Paste a whole letter</button>
                ) : (
                  <div className="stack" style={{ gap: 8 }}>
                    <label className="doc-field">
                      <span>Paste the letter: date, address, "Dear …", subject, then the body. Your name and signature come from the letterhead.</span>
                      <textarea className="input" rows={8} value={pasted} autoFocus onChange={(e) => setPasted(e.target.value)} />
                    </label>
                    {pastedParts && (
                      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                        Found: {[pastedParts.date && "date", pastedParts.address && "address", pastedParts.salutation && "greeting", pastedParts.subject && "subject", pastedParts.body && "body", pastedParts.signOff && "sign-off"].filter(Boolean).join(", ") || "nothing yet"}
                        {!pastedParts.salutation && pastedParts.body ? ' (no "Dear …" line, so it will all go in the body)' : ""}
                      </p>
                    )}
                    <div className="row-wrap" style={{ gap: 8 }}>
                      <button type="button" className="btn small primary" disabled={!pasted.trim()} onClick={usePasted}>Use this</button>
                      <button type="button" className="btn small" onClick={() => { setPasting(false); setPasted(""); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="doc-field">
              <div className="doc-toolbar">
                <span id="body-label">{isLetter ? "Letter" : "Message"}</span>
                <span className="row-wrap" style={{ gap: 4 }}>
                  <button type="button" className="iconbtn small" title="Bold (select words first)" aria-label="Bold" onClick={wrapBold}><strong>B</strong></button>
                  <button type="button" className="iconbtn small" title="Bullet points" aria-label="Bullet points" onClick={makeList}><Icon name="list" size={14} /></button>
                  <button type="button" className="iconbtn small" title="Add a table (or paste one from Excel)" aria-label="Add a table" onClick={insertTable}><TableIcon /></button>
                </span>
              </div>
              <AutoTextarea
                ref={bodyRef}
                aria-labelledby="body-label"
                className="input doc-body"
                value={draft.Body}
                placeholder={aiReady ? "Write here, or describe it on the left and let the AI write it." : "Write here."}
                onChange={(v) => set({ Body: v })}
              />
              <span className="muted" style={{ fontSize: 12 }}>A blank line starts a new paragraph. Lines starting with "- " become bullet points; **words** in stars are bold. Paste a table from Excel or Word (cells separated by tabs) and it becomes a table.</span>
            </div>
            {isLetter ? (
              <div className="doc-signoff">
                <label className="doc-field" style={{ maxWidth: 260 }}>
                  <span>Sign-off</span>
                  <input className="input" value={draft.SignOff} onChange={(e) => set({ SignOff: e.target.value })} />
                </label>
                <div className="doc-sign muted">
                  {prefs.signName || <a href="#/settings/letters">Add your name in Settings</a>}
                  {prefs.signTitle ? <><br />{prefs.signTitle}</> : null}
                </div>
              </div>
            ) : prefs.emailSignature ? (
              <div className="doc-sign muted" style={{ whiteSpace: "pre-line" }}>{prefs.emailSignature}</div>
            ) : null}
          </div>

          {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
          {note && <div className="alert green-alert" role="status"><span>{note}</span></div>}

          <div className="composer-actions">
            <button type="button" className="linkbtn danger-link" onClick={del} disabled={busy !== ""}>Delete</button>
            <div className="row-wrap">
              {!saved || dirty ? (
                <button type="button" className="btn" disabled={!draft.ClientKey || busy !== ""} onClick={() => { setBusy("save"); persist().catch(() => setError("Couldn't save.")).finally(() => setBusy("")); }}>
                  Save draft
                </button>
              ) : null}
              {isLetter && (
                <button type="button" className="btn" disabled={!client || busy !== ""} onClick={needsMail ? allowMail : toOutlook} title="An Outlook draft to the client with the letter attached as a Word file">
                  <Icon name="mail" />{busy === "outlook" ? "Putting in Outlook…" : "Email it as an attachment"}
                </button>
              )}
              {isLetter ? (
                <button type="button" className="btn primary" disabled={!client || busy !== ""} onClick={makeWord}>
                  <Icon name="letter" />{busy === "word" ? "Making the letter…" : "Create Word letter"}
                </button>
              ) : (
                <button type="button" className="btn primary" disabled={!client || busy !== ""} onClick={needsMail ? allowMail : toOutlook}>
                  <Icon name="mail" />{busy === "outlook" ? "Putting in Outlook…" : "Put in Outlook drafts"}
                </button>
              )}
            </div>
          </div>
          {needsMail && (
            <p className="muted" style={{ margin: 0, fontSize: 12, textAlign: "right" }}>
              The first time, Microsoft asks you to let the planner create Outlook drafts. It never sends anything itself.
            </p>
          )}
          {(draft.FileUrl || draft.OutlookUrl) && (
            <div className="row-wrap made-links">
              {draft.FileUrl && <a className="btn small" href={`ms-word:ofe|u|${draft.FileUrl}`}><Icon name="letter" />Open in Word</a>}
              {draft.FileUrl && <a className="btn small" href={draft.FileUrl} target="_blank" rel="noreferrer">Open in OneDrive</a>}
              {draft.OutlookUrl && <a className="btn small" href={draft.OutlookUrl} target="_blank" rel="noreferrer"><Icon name="mail" />Open the Outlook draft</a>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const TableIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="1.5" y="2.5" width="13" height="11" rx="1" /><path d="M1.5 6.5h13M1.5 10h13M6 6.5v7M10.5 6.5v7" />
  </svg>
);

/** A text box that grows with what's typed. */
const AutoTextarea = forwardRef<HTMLTextAreaElement, { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; "aria-labelledby"?: string }>(
  function AutoTextarea({ value, onChange, ...rest }, ref) {
    const inner = useRef<HTMLTextAreaElement | null>(null);
    useEffect(() => {
      const el = inner.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.max(240, el.scrollHeight + 2)}px`;
    }, [value]);
    return (
      <textarea
        {...rest}
        ref={(el) => {
          inner.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  },
);

// ------------------------------------------------------------------ settings

export function CommsSettings() {
  const { data, store, saveSetting } = useData();
  const prefs = useCommsPrefs();
  const ai = useAi();
  const [form, setForm] = useState(prefs);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [upload, setUpload] = useState<{ state: "idle" | "busy" | "error"; message?: string }>({ state: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setForm(prefs), [prefs]);
  useEffect(() => {
    ai.status(prefs.model || undefined).then(setAiStatus).catch((e) => setAiStatus({ configured: false, ...(e instanceof AiError ? { error: e.message } : {}) } as AiStatus));
  }, [ai, prefs.model]);

  const changed = JSON.stringify({ ...form, letterhead: undefined }) !== JSON.stringify({ ...prefs, letterhead: undefined });
  const save = async () => {
    setState("saving");
    try {
      await saveSetting("comms", { ...prefs, ...form, letterhead: prefs.letterhead });
      setState("saved");
    } catch {
      setState("error");
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setUpload({ state: "busy" });
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (bytes.length > 4_000_000) throw new NotWordFile("That file is over 4 MB. Save the letterhead with smaller pictures and try again.");
      const check = await checkLetterhead(bytes);
      const item = await store.graph.put<{ webUrl?: string }>(`${letterheadPath()}:/content`, bytes, DOCX_TYPE);
      const uploaded = new Date().toISOString();
      letterheadCache = { uploaded, bytes };
      await saveSetting("comms", { ...prefs, letterhead: { name: f.name, size: bytes.length, uploaded, placeholder: check.placeholder, example: check.example, webUrl: item.webUrl } });
      setUpload({ state: "idle" });
    } catch (e) {
      setUpload({ state: "error", message: e instanceof NotWordFile ? e.message : "Couldn't save the letterhead to OneDrive. Try again." });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const sample = async () => {
    try {
      const head = await getLetterhead(store.graph, prefs);
      const bytes = await letterDocx({
        date: longDate(todayIso()), address: ["Mr A Client", "Example Trading Ltd", "1 High Street", "Leeds", "LS1 1AA"], salutation: "Dear Alex,",
        subject: "A sample letter", signOff: form.signOff || "Yours sincerely,", signName: form.signName || "[Your name]", signTitle: form.signTitle || undefined,
        body: "This is how your letters will look. The text goes here, in your letterhead's own font and margins.\n\nBullet points look like this:\n- the first point\n- the second point\n\nA table looks like this:\n\nItem\t2026\t2025\nTurnover\t120,000\t98,500\nProfit before tax\t24,300\t(1,200)\n\nAnd **bold words** stand out like this.",
      }, head);
      downloadFile(bytes, "Sample letter.docx", DOCX_TYPE);
    } catch {
      setUpload({ state: "error", message: "Couldn't make the sample letter." });
    }
  };

  const canMail = mailAllowed();
  const f = (k: keyof CommsPrefs) => (e: { target: { value: string } }) => {
    setForm({ ...form, [k]: e.target.value });
    setState("idle");
  };
  void data;

  return (
    <>
      <section className="card pad stack" aria-labelledby="lh-h">
        <h2 id="lh-h">Letterhead</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Upload your Word letterhead (.docx or .dotx). Letters keep its header, footer, logo, fonts and margins. If it's an example letter (address,
          date, "Dear …" with the subject, the body, "Yours …" and your signature), each new letter is laid out the same way, in the same fonts, with
          your signature, and the example's words are replaced. Otherwise the letter goes where it says <span className="mono">{"{{LETTER}}"}</span>, or
          at the top of the page body. It's kept in OneDrive › {LETTERS_FOLDER}.
        </p>
        {prefs.letterhead ? (
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <span>
              <Icon name="letter" /> <strong>{prefs.letterhead.name}</strong>{" "}
              <span className="muted">· uploaded {fmtDate(prefs.letterhead.uploaded.slice(0, 10))}{prefs.letterhead.placeholder ? " · has the {{LETTER}} marker" : prefs.letterhead.example ? " · laid out like your example letter" : ""}</span>
            </span>
            <span className="row-wrap">
              <button type="button" className="btn small" onClick={sample}>Download a sample letter</button>
              <button type="button" className="btn small" onClick={() => fileRef.current?.click()} disabled={upload.state === "busy"}>Replace</button>
            </span>
          </div>
        ) : (
          <div className="row-wrap">
            <button type="button" className="btn primary" onClick={() => fileRef.current?.click()} disabled={upload.state === "busy"}>
              {upload.state === "busy" ? "Uploading…" : "Upload your letterhead"}
            </button>
            <button type="button" className="btn" onClick={sample}>Download a plain sample letter</button>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".docx,.dotx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={(e) => onFile(e.target.files?.[0])} aria-label="Letterhead file" />
        {upload.state === "error" && <p className="error-text" role="alert" style={{ margin: 0 }}>{upload.message}</p>}
        {!prefs.letterhead && <p className="muted" style={{ margin: 0, fontSize: 12 }}>Until you upload one, letters are plain (no letterhead).</p>}
      </section>

      <section className="card pad stack" aria-labelledby="sig-h">
        <h2 id="sig-h">How you sign off</h2>
        <div className="form" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <label>Your name (under the signature)<input className="input" value={form.signName} onChange={f("signName")} placeholder="Kevin Bannister" /></label>
          <label>Second line (optional)<input className="input" value={form.signTitle} onChange={f("signTitle")} placeholder="e.g. your practice name or role" /></label>
          <label>Letter sign-off<input className="input" value={form.signOff} onChange={f("signOff")} placeholder="Yours sincerely," /></label>
          <label style={{ gridColumn: "1 / -1" }}>Email signature (added under emails)<textarea className="input" rows={4} value={form.emailSignature} onChange={f("emailSignature")} placeholder={"Kevin Bannister\nPractice name\n0113 000 0000"} /></label>
        </div>
      </section>

      <section className="card pad stack" aria-labelledby="ai-set-h">
        <h2 id="ai-set-h">AI writing (OpenAI)</h2>
        {aiStatus === null ? (
          <p className="muted" style={{ margin: 0 }}>Checking…</p>
        ) : aiStatus.configured ? (
          <p style={{ margin: 0, color: aiStatus.keyAccepted === false ? "var(--red-ink)" : "var(--green)", fontWeight: 600 }}>
            {aiStatus.keyAccepted === false ? "The OpenAI key is in Azure, but OpenAI didn't accept it." : `Connected · using ${aiStatus.model}`}
          </p>
        ) : (
          <div className="stack" style={{ gap: 6, fontSize: 14 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>Not set up yet. To add it:</p>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              <li>At <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com › API keys</a>, create a secret key, and add some credit under Billing.</li>
              <li>In the Azure portal, open the Practice Planner static web app › Settings › Environment variables, and add <span className="mono">OPENAI_API_KEY</span> with the key as its value. Save.</li>
              <li>Come back here and refresh.</li>
            </ol>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>The key stays in Azure; it's never in the app or your browser.</p>
          </div>
        )}
        <div className="form" style={{ gridTemplateColumns: "1fr" }}>
          {aiStatus?.configured && (aiStatus.models || []).length > 0 && (
            <label>
              Model
              <select className="input" value={form.model} onChange={f("model")}>
                <option value="">Automatic (a fast, capable model)</option>
                {(aiStatus.models || []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          )}
          <label>
            Effort
            <select className="input" value={form.effort || ""} onChange={f("effort")}>
              <option value="">Automatic (low: quick answers)</option>
              <option value="minimal">Minimal: fastest</option>
              <option value="low">Low</option>
              <option value="medium">Medium: more careful, slower</option>
              <option value="high">High: most careful, slowest</option>
            </select>
            <span className="muted" style={{ fontSize: 12 }}>How hard the model thinks before answering. Used for letters, emails, Ask and bank statements. Only models that reason (the gpt-5 family and similar) use it; others ignore it. Higher effort costs more and can take a minute or two.</span>
          </label>
          <label>
            House style for the AI (optional)
            <textarea className="input" rows={4} value={form.style} onChange={f("style")}
              placeholder={"e.g. We're a small friendly practice in Leeds. Use first names. Keep letters to one page. Always offer a call if they have questions."} />
          </label>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          What's sent to OpenAI: what you ask for, the text being changed, and the client's name, contact, greeting, address and open work. Tax
          references, NI numbers and dates of birth aren't sent. OpenAI doesn't use API data to train its models.
        </p>
      </section>

      <section className="card pad stack" aria-labelledby="ol-h">
        <h2 id="ol-h">Outlook</h2>
        <p style={{ margin: 0, fontSize: 14 }}>
          {canMail
            ? "Emails go into your Outlook drafts, ready for you to check and send."
            : "Emails go into your Outlook drafts. Microsoft asks you to allow this the first time; the planner never sends anything itself."}
        </p>
        {!canMail && <div><button type="button" className="btn" onClick={() => addScope(MAIL_SCOPE, true)}>Allow Outlook drafts</button></div>}
      </section>

      <div className="form-actions" style={{ alignItems: "center" }}>
        {state === "saved" && !changed && <span className="muted" style={{ fontSize: 13 }}>Saved</span>}
        {state === "error" && <span className="error-text">Couldn't save</span>}
        <button type="button" className="btn primary" onClick={save} disabled={!changed || state === "saving"}>{state === "saving" ? "Saving…" : "Save"}</button>
      </div>
    </>
  );
}
