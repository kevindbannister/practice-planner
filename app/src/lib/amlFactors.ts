// The risk questions in an AML review. Each answer is yes or no; some questions are the other way round (a "no" is the worry).
// The planner suggests a rating and the wording for "what the rating is based on", but the rating is the person's call.
export type Factor = { id: string; label: string; help: string; worry: "yes" | "no"; severe?: boolean };
export const FACTORS: Factor[] = [
  { id: "pep", label: "Is the client, or anyone who owns or controls it, a politically exposed person, or a close family member or associate of one?", help: "Senior public roles here or abroad. A yes needs enhanced due diligence.", worry: "yes", severe: true },
  { id: "geo", label: "Any link to a high-risk country, through where they live, are based, trade or get money from?", help: "Check the UK's high-risk third countries list and the UK sanctions list.", worry: "yes", severe: true },
  { id: "adverse", label: "Any sanctions match, or adverse media about the client or the people behind it?", help: "From your screening. Don't record the details of a suspicion here.", worry: "yes", severe: true },
  { id: "structure", label: "Is the ownership complex or hard to follow: layers of companies, trusts, nominees, bearer shares or offshore holders?", help: "If you can't tell who owns or controls it, that is itself a warning sign.", worry: "yes" },
  { id: "cash", label: "Does the business handle a lot of cash, or work in a higher-risk sector?", help: "For example cash-intensive trades, property, money services, crypto, gambling.", worry: "yes" },
  { id: "remote", label: "Have you not met the client, or the people behind it, face to face?", help: "Non-face-to-face onboarding can be lower assurance unless you verified them electronically.", worry: "yes" },
  { id: "unusual", label: "Is anything unusual about how they behave, give information, or pay?", help: "Reluctance to give ID, payments from third parties, urgency, changes of story.", worry: "yes" },
  { id: "funds", label: "Do you understand where their money comes from?", help: "A no means you need to ask, especially for higher-value or unusual work.", worry: "no" },
  { id: "sense", label: "Does the work they want make sense for who they are and what they do?", help: "A no may point to something you haven't been told.", worry: "no" },
];
export type Answers = Record<string, "yes" | "no" | "">;

export function readFactors(v: unknown): Answers {
  try { const j = JSON.parse(String(v ?? "") || "{}"); const out: Answers = {}; for (const f of FACTORS) if (j?.[f.id] === "yes" || j?.[f.id] === "no") out[f.id] = j[f.id]; return out; } catch { return {}; }
}
const worrying = (f: Factor, a: Answers) => a[f.id] === f.worry;
export function suggestRating(a: Answers): { risk: "low" | "medium" | "high" | ""; answered: number; why: string[] } {
  const answered = FACTORS.filter((f) => a[f.id]).length;
  if (!answered) return { risk: "", answered, why: [] };
  const flags = FACTORS.filter((f) => worrying(f, a));
  const severe = flags.filter((f) => f.severe);
  const risk = severe.length ? "high" : flags.length >= 2 ? "high" : flags.length === 1 ? "medium" : answered === FACTORS.length ? "low" : "";
  return { risk, answered, why: flags.map((f) => f.label) };
}
const SHORT: Record<string, string> = { pep: "politically exposed person involved", geo: "link to a high-risk country", adverse: "sanctions or adverse media concern", structure: "complex ownership", cash: "cash-intensive or higher-risk sector", remote: "not met face to face", unusual: "unusual behaviour or payments", funds: "source of funds not understood", sense: "the work does not fit the client" };
export function basisText(a: Answers): string {
  const flags = FACTORS.filter((f) => worrying(f, a)).map((f) => SHORT[f.id]);
  const answered = FACTORS.filter((f) => a[f.id]).length;
  if (!answered) return "";
  return flags.length ? `Factors raising risk: ${flags.join("; ")}.` : answered === FACTORS.length ? "No risk factors identified on the standard questions." : "No risk factors identified on the questions answered so far.";
}
