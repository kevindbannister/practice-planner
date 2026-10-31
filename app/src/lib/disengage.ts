// A letter ending an engagement (ceasing to act). Built from the client's record and a few choices: why, from when,
// what is handed back and what is still owed. It is a starting point for the practice to check and edit, not legal
// advice; the wording is kept plain and says nothing the practice hasn't chosen.
import { Client } from "./domain";

export type Reason = "practice" | "client" | "fees" | "retiring";
export const REASONS: { key: Reason; label: string }[] = [
  { key: "client", label: "The client has asked us to stop" },
  { key: "practice", label: "We have decided to stop acting" },
  { key: "fees", label: "Unpaid fees" },
  { key: "retiring", label: "We are closing or retiring" },
];

export type Deadline = { title: string; date: string };
export type DisengageInput = {
  client: Pick<Client, "Title" | "Kind" | "CompanyNumber">;
  reason: Reason;
  /** The last day we act, as text (e.g. "30 November 2026"). */
  endDate: string;
  /** Whole-practice letters (all services) or a list of the services ending. */
  services: string[];
  returnRecords: boolean;
  /** Tell them HMRC and Companies House access is theirs to arrange. */
  authorities: boolean;
  newAccountant: boolean;
  /** Fees still owing, in pounds, if any. */
  owing: number;
  /** Upcoming deadlines that stay with the client. */
  deadlines: Deadline[];
  /** Anything else to say, added before the closing. */
  extra: string;
};

export const defaultInput = (client: DisengageInput["client"]): DisengageInput => ({
  client, reason: "client", endDate: "", services: [], returnRecords: true, authorities: true, newAccountant: true, owing: 0, deadlines: [], extra: "",
});

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const isCompany = (c: DisengageInput["client"]) => c.Kind === "Ltd" || c.Kind === "LLP";

export function problems(i: DisengageInput): string[] {
  const out: string[] = [];
  if (!i.endDate.trim()) out.push("Say the date we stop acting.");
  if (i.reason === "fees" && !(i.owing > 0)) out.push("Enter the amount of unpaid fees.");
  return out;
}

export function disengageLetter(i: DisengageInput): { subject: string; body: string } {
  const who = String(i.client.Title);
  const scope = i.services.length ? `acting for ${who} in relation to ${i.services.join(", ")}` : `acting as accountants for ${who}`;
  const first: Record<Reason, string> = {
    client: `Thank you for letting us know that you wish to end our engagement. This letter confirms that we will stop ${scope} with effect from ${i.endDate}.`,
    practice: `I am writing to let you know that we have decided to stop ${scope} with effect from ${i.endDate}.`,
    fees: `I am writing about our outstanding fees. As they remain unpaid, we have decided to stop ${scope} with effect from ${i.endDate}.`,
    retiring: `I am writing to let you know that we are closing our practice, so we will stop ${scope} with effect from ${i.endDate}.`,
  };
  const lines: string[] = [first[i.reason]];
  if (i.reason === "fees" || i.owing > 0) lines.push("", `Our fees of ${gbp(i.owing)} remain outstanding. Please arrange payment by the date above, or contact us if you would like to discuss it.`);
  if (i.deadlines.length) {
    lines.push("", "Please note that, after that date, we will not be dealing with the following, so you or your new accountant will need to make sure they are met:");
    for (const d of i.deadlines) lines.push(`- ${d.title}${d.date ? `, due ${d.date}` : ""}`);
  }
  const todo: string[] = [];
  if (i.returnRecords) todo.push("We will return your original records and any papers you have asked us to keep for you. Where we are required to keep copies of our own working papers, we will hold them for the period the rules require.");
  if (i.authorities) todo.push(`${isCompany(i.client) ? "HMRC and Companies House" : "HMRC"} permissions given to us will end when we stop acting. ${isCompany(i.client) ? "Please make sure you hold your Companies House authentication code and that your new agent, if any, is authorised." : "If you appoint a new agent, they will need to ask you for a new authorisation."}`);
  if (i.newAccountant) todo.push("If you appoint another accountant, please ask them to write to us. We will respond promptly and help with an orderly handover.");
  if (todo.length) { lines.push("", ...todo.flatMap((t, n) => (n ? ["", t] : [t]))); }
  if (i.extra.trim()) lines.push("", i.extra.trim());
  lines.push("", i.reason === "practice" || i.reason === "fees" ? "Thank you for the opportunity to work with you." : "Thank you for your custom over the time we have worked together, and we wish you every success.");
  return { subject: `Ending our engagement: ${who}`, body: lines.join("\n") };
}
