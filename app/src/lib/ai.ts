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

export class AiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface AiApi {
  status(model?: string): Promise<AiStatus>;
  write(req: AiRequest): Promise<AiAnswer>;
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
}

/** Demo stand-in: writes plausible text from the brief, and applies a few simple changes. */
export class FakeAi implements AiApi {
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
