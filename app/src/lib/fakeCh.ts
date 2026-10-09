// A stand-in for Companies House in the demo build. The first time it's asked, it makes up a
// record for each company that agrees with the planner, then changes a few so every kind of
// difference shows: accounts already filed, a due date that differs, a new registered office,
// a strike-off notice, and (from the second check on) a new director. Saved in localStorage
// so it behaves like a real register between checks.
import { Client, Job, isOpen } from "./domain";
import { ChApi, ChError, ChProfile, chNumber, isCompany } from "./companiesHouse";
import { addDays, addMonths } from "./planning";

type Store = { profiles: Record<string, ChProfile>; officers: Record<string, { name: string; officer_role: string }[]>; checks: number };
const KEY = "pp.demo.ch";

export class FakeCh implements ChApi {
  constructor(private source: () => { clients: Client[]; jobs: Job[] }) {}

  private load(): Store {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (s && s.profiles) return s;
    } catch {
      /* start again */
    }
    const s = this.build();
    this.persist(s);
    return s;
  }

  private persist(s: Store) {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* the demo still works for this page */
    }
  }

  private build(): Store {
    const { clients, jobs } = this.source();
    const companies = clients.filter(isCompany).sort((a, b) => chNumber(a).localeCompare(chNumber(b)));
    const store: Store = { profiles: {}, officers: {}, checks: 0 };
    companies.forEach((c, i) => {
      const open = jobs.filter((j) => j.ClientKey === c.Key && isOpen(j));
      const accs = open.filter((j) => j.ServiceKey?.startsWith("ACCS")).sort((a, b) => (a.PeriodEnd || "").localeCompare(b.PeriodEnd || ""))[0];
      const cs01 = open.filter((j) => j.ServiceKey === "CS01").sort((a, b) => (a.PeriodEnd || "").localeCompare(b.PeriodEnd || ""))[0];
      const p: ChProfile = {
        company_name: c.Title.toUpperCase(),
        company_number: chNumber(c),
        company_status: "active",
        registered_office_address: c.RegisteredOffice ? { address_line_1: String(c.RegisteredOffice) } : undefined,
        accounts: accs?.PeriodEnd
          ? { next_made_up_to: accs.PeriodEnd, next_due: accs.Deadline, overdue: false, last_accounts: { made_up_to: addMonths(accs.PeriodEnd, -12) } }
          : {},
        confirmation_statement: cs01?.PeriodEnd
          ? { next_made_up_to: cs01.PeriodEnd, next_due: cs01.Deadline, last_made_up_to: addMonths(cs01.PeriodEnd, -12, false) }
          : {},
      };
      if (i === 0 && accs?.PeriodEnd) {
        // accounts filed already
        const pe = addMonths(accs.PeriodEnd, 12);
        p.accounts = { last_accounts: { made_up_to: accs.PeriodEnd }, next_made_up_to: pe, next_due: addMonths(pe, 9), overdue: false };
      }
      if (i === 1 && cs01?.Deadline) p.confirmation_statement!.next_due = addDays(cs01.Deadline, 7);
      if (i === 2) p.registered_office_address = { premises: "Unit 4", address_line_1: "Example Business Park", locality: "Exampletown", postal_code: "EX1 2AB", country: "England" };
      if (i === 3) {
        p.company_status_detail = "active-proposal-to-strike-off";
        p.accounts = { ...p.accounts, overdue: true };
      }
      store.profiles[chNumber(c)] = p;
      const director = [c.ContactLast, c.ContactFirst].every(Boolean)
        ? [{ name: `${String(c.ContactLast).toUpperCase()}, ${c.ContactFirst}`, officer_role: "director" }]
        : [];
      store.officers[chNumber(c)] = director;
    });
    return store;
  }

  async get(path: string): Promise<any> {
    await new Promise((r) => setTimeout(r, 20));
    const m = /^company\/([A-Z0-9]{8})(?:\/(officers|persons-with-significant-control))?$/.exec(path.split("?")[0]);
    if (!m) throw new ChError("upstream", "Not supported in the demo");
    const s = this.load();
    const [, num, sub] = m;
    const p = s.profiles[num];
    if (!p) throw new ChError("not-found", "Companies House has no record of this.");
    if (!sub) return p;
    if (sub === "persons-with-significant-control") return { items: [] };
    // the fifth company gets a new director from the second check on
    const keys = Object.keys(s.profiles).sort();
    if (num === keys[0]) {
      s.checks += 1;
      this.persist(s);
    }
    const items = [...(s.officers[num] || [])];
    if (num === keys[4] && s.checks > 1) items.push({ name: "EXAMPLE, Jordan", officer_role: "director" });
    return { items };
  }
}
