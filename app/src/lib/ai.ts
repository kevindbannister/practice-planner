// Talking to the app's AI writing bridge (/api/ai, which holds the OpenAI key). The demo build
// uses a stand-in that writes canned text, so the screens can be tried without a key.

export type AiKind = "letter" | "email";
export type AiRequest = {
  kind: AiKind;
  mode: "draft" | "amend";
  brief?: string;
  instruction?: string;
  current?: { subject: string; body: string };
  context?: Record<string, unknown>;
  style?: string;
  model?: string;
};
export type AiAnswer = { subject: string; body: string; model?: string };
export type AiStatus = { configured: boolean; keyAccepted?: boolean; model?: string; models?: string[] };

export type MeetingAction = { text: string; who: string; due: string };
export type MeetingTidy = { summary: string; decisions: string[]; actions: MeetingAction[] };
export type MeetingRequest = {
  meeting: { title: string; when: string; kind: string; attendees: string; agenda: { item: string; notes: string }[]; notes: string };
  context?: Record<string, unknown>;
  style?: string;
  model?: string;
};

export type AssistTurn = { role: "user" | "assistant"; content: string };
export type AssistRequest = { message: string; context: Record<string, unknown>; history?: AssistTurn[]; model?: string };
export type AssistAnswer = { reply: string; actions: unknown[]; model?: string };

export type EmailVerdict = { id: string; needsAction: boolean; title?: string; due?: string; hours?: number; why?: string };

export class AiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface AiApi {
  status(model?: string): Promise<AiStatus>;
  write(req: AiRequest): Promise<AiAnswer>;
  tidyMeeting(req: MeetingRequest): Promise<MeetingTidy>;
  assist(req: AssistRequest): Promise<AssistAnswer>;
  emails(req: { today: string; emails: Record<string, unknown>[]; model?: string }): Promise<{ emails: EmailVerdict[] }>;
}

export class HttpAi implements AiApi {
  constructor(private token: () => Promise<string>) {}

  private async call(path: string, init: RequestInit = {}): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`/api/ai/${path}`, {
        ...init,
        headers: { "X-PP-Token": await this.token(), Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      });
    } catch {
      throw new AiError("unreachable", "Couldn't reach the app's server. Check your internet connection.");
    }
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON: the bridge isn't deployed yet */
    }
    if (res.ok && body) return body;
    if (!body || !body.error) throw new AiError("no-bridge", "The AI connection isn't on the server yet. It arrives with the next deployment.");
    throw new AiError(body.error, body.message || "The AI couldn't write that. Try again.");
  }

  status(model?: string): Promise<AiStatus> {
    return this.call(`status${model ? `?model=${encodeURIComponent(model)}` : ""}`);
  }
  write(req: AiRequest): Promise<AiAnswer> {
    return this.call("write", { method: "POST", body: JSON.stringify(req) });
  }
  emails(req: { today: string; emails: Record<string, unknown>[]; model?: string }): Promise<{ emails: EmailVerdict[] }> {
    return this.call("emails", { method: "POST", body: JSON.stringify(req) });
  }
  assist(req: AssistRequest): Promise<AssistAnswer> {
    return this.call("assist", { method: "POST", body: JSON.stringify(req) });
  }
  tidyMeeting(req: MeetingRequest): Promise<MeetingTidy> {
    return this.call("write", { method: "POST", body: JSON.stringify({ kind: "meeting", mode: "tidy", ...req }) });
  }
}

/** Demo stand-in: writes plausible text from the brief, and applies a few simple changes. */
export class FakeAi implements AiApi {
  /** Demo stand-in: says every email needs action, tidying the title. */
  async emails(req: { emails: Record<string, unknown>[] }): Promise<{ emails: EmailVerdict[] }> {
    await new Promise((r) => setTimeout(r, 300));
    return { emails: req.emails.map((e) => ({ id: String(e.id), needsAction: !/lunch/i.test(String(e.subject)), why: "Demo: the AI would judge this from the preview" })) };
  }
  /** Demo stand-in for the chat: understands "add a task to …" and "what's urgent". */
  async assist(req: AssistRequest): Promise<AssistAnswer> {
    await new Promise((r) => setTimeout(r, 400));
    const m = req.message.trim();
    const ctx = req.context as { today?: string; work?: { key: string; title: string; deadline?: string }[] };
    const add = /^(?:please )?(?:add|create|new)(?: a)? task(?: to| for|:)?\s+(.+)/i.exec(m);
    if (add) return { reply: `I'll add a task: ${add[1]}.`, actions: [{ type: "create_task", title: add[1].replace(/\.$/, ""), planned: ctx.today }], model: "demo-assistant" };
    if (/urgent|first|next|today/i.test(m)) {
      const top = (ctx.work || []).filter((w) => w.deadline).slice(0, 3);
      return { reply: top.length ? `The nearest deadlines are: ${top.map((w) => `${w.title} (${w.deadline})`).join("; ")}.` : "Nothing has a deadline coming up.", actions: [], model: "demo-assistant" };
    }
    return { reply: "In the demo I can add a task (try \"add a task to ring the bank\") or tell you what's urgent. The real assistant understands much more.", actions: [], model: "demo-assistant" };
  }
  async tidyMeeting(req: MeetingRequest): Promise<MeetingTidy> {
    await new Promise((r) => setTimeout(r, 400));
    const items = req.meeting.agenda.filter((a) => a.notes.trim());
    const lines = [...items.flatMap((a) => a.notes.split("\n")), ...req.meeting.notes.split("\n")].map((l) => l.trim()).filter(Boolean);
    const actions = lines
      .filter((l) => /^(action|todo|to do)\b/i.test(l))
      .map((l) => {
        const text = l.replace(/^(action|todo|to do)\s*[:-]?\s*/i, "");
        return { text, who: /\bclient\b/i.test(text) ? "client" : "me", due: (text.match(/\d{4}-\d{2}-\d{2}/) || [""])[0] };
      });
    const decisions = lines.filter((l) => /^(agreed|decided|decision)\b/i.test(l)).map((l) => l.replace(/^(agreed|decided|decision)\s*[:-]?\s*/i, ""));
    const summary = items.length
      ? `We talked about ${items.map((a) => a.item.toLowerCase()).join(", ")}. ${lines.filter((l) => !/^(action|todo|to do|agreed|decided|decision)\b/i.test(l)).slice(0, 3).join(" ")}`.trim()
      : lines.slice(0, 3).join(" ");
    return { summary, decisions, actions };
  }
  async status(): Promise<AiStatus> {
    return { configured: true, keyAccepted: true, model: "demo-writer", models: ["demo-writer"] };
  }
  async write(req: AiRequest): Promise<AiAnswer> {
    await new Promise((r) => setTimeout(r, 400));
    const ctx = (req.context || {}) as any;
    const first = String(ctx.salutation || "").replace(/^(Dear|Hi)\s+/i, "").replace(/,$/, "") || "there";
    const work = (ctx.about && ctx.about.work) || "your accounts";
    if (req.mode === "amend" && req.current) {
      const i = (req.instruction || "").toLowerCase();
      let body = req.current.body;
      if (/short/.test(i)) body = body.split(/\n\s*\n/).slice(0, 2).join("\n\n");
      else if (/formal/.test(i)) body = body.replace(/I'm/g, "I am").replace(/you'll/g, "you will").replace(/don't/g, "do not");
      else body = `${body}\n\n[Changed as asked: ${req.instruction}]`;
      return { subject: req.current.subject, body, model: "demo-writer" };
    }
    const paras = [
      `I'm writing about ${work}. ${req.brief ? `You asked me to cover: ${req.brief.trim()}.` : ""}`.trim(),
      "Here's what happens next:\n- I'll finish the work once I have everything I need\n- I'll send it to you to check before anything is filed",
      `Please let me know by [date] if you have any questions.`,
    ];
    if (req.kind === "email") {
      return { subject: `About ${work}`, body: [`Hi ${first},`, ...paras, `Kind regards,\n${ctx.sender || "Kevin"}`].join("\n\n"), model: "demo-writer" };
    }
    return { subject: `${work[0].toUpperCase()}${work.slice(1)}`, body: paras.join("\n\n"), model: "demo-writer" };
  }
}
