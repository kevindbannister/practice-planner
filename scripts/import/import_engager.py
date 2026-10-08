#!/usr/bin/env python3
"""Turn Engager exports into Practice Planner tables.

Usage:
    python3 import_engager.py --clients raw/clients.csv --jobs raw/jobs_open.csv \
        --completed raw/jobs_completed.csv --out out --today 2026-10-08

Writes one CSV per table into --out, plus quality_issues.csv and summary.json.
Client data never belongs in the code repository: keep raw/ and out/ out of git.
"""
import argparse
import csv
import datetime as dt
import json
import re
from collections import defaultdict
from pathlib import Path

BLANKS = {"", "n/a", "na", "none", "(not linked)", "tbc"}

# Engager service block prefix (and occurrence) -> our service code.
BLOCK_CODES = {
    ("MYS", 0): "MYS",
    ("A/Cs", 0): "ACCS_LTD",
    ("CT600", 0): "CT600",
    ("A/Cs", 1): "ACCS_LLP",
    ("A/Cs", 2): "ACCS_OTHER_A",
    ("A/Cs", 3): "ACCS_OTHER_B",
    ("VAT", 0): "VAT",
    ("SA100", 0): "SA100",
    ("PAYE", 0): "PAYROLL",
    ("CIS", 0): "CIS",
    ("PAE", 0): "PAE",
    ("CS01", 0): "CS01",
    ("DS01", 0): "DS01",
    ("SA800", 0): "SA800",
    ("Bookkeep", 0): "BOOKKEEPING",
    ("Software", 0): "SOFTWARE",
    ("Capital Gains", 0): "CGT",
    ("NCSU", 0): "NCSU",
    ("IMR", 0): "MGMT_ACCOUNTS",
    ("Onboarding", 0): "ONBOARDING",
    ("Company Removal", 0): "STRIKE_OFF",
}

# code: (display name, recurrence, deadline rule)
SERVICES = {
    "ACCS_LTD": ("Limited company accounts", "annual", "Year end + 9 months (first accounts: Companies House)"),
    "CT600": ("Corporation tax return", "annual", "Year end + 12 months; tax due year end + 9 months + 1 day"),
    "CS01": ("Confirmation statement", "annual", "Made-up date + 14 days"),
    "ACCS_LLP": ("LLP accounts", "annual", "Year end + 9 months"),
    "SA800": ("Partnership tax return", "annual", "31 January after tax year"),
    "SA100": ("Self Assessment return", "annual", "31 January after tax year"),
    "VAT": ("VAT return", "quarterly", "Quarter end + 1 month + 7 days"),
    "PAYROLL": ("Payroll", "monthly", "Pay date (set per client)"),
    "CIS": ("CIS return", "monthly", "19th of following month"),
    "MGMT_ACCOUNTS": ("Management accounts", "monthly", "Internal date"),
    "BOOKKEEPING": ("Bookkeeping", "per fee period", "Internal date"),
    "MYS": ("Model Your Success", "per fee period", "Internal date"),
    "SOFTWARE": ("Software subscription", "annual", "Renewal date"),
    "ONBOARDING": ("Onboarding", "one-off", "Internal date"),
    "CGT": ("Capital gains", "one-off", "Set per job"),
    "NCSU": ("New company set-up", "one-off", "Set per job"),
    "DS01": ("Strike-off application (DS01)", "one-off", "Set per job"),
    "STRIKE_OFF": ("Company removal", "one-off", "Set per job"),
    "PAE": ("PAE", "per fee period", "Set per job"),
    "ACCS_OTHER_A": ("Other accounts (A)", "annual", "Set per job"),
    "ACCS_OTHER_B": ("Other accounts (B)", "annual", "Set per job"),
    "SE_ACCOUNTS": ("Self-employed accounts", "annual", "Set per job"),
    "CHARITY_ACCOUNTS": ("Charity accounts", "annual", "Set per job"),
    "TASK": ("Task", "one-off", "Set per task"),
}

# Engager job "Service / Task name" -> our code.
JOB_CODES = {
    "Limited Company Accounts": "ACCS_LTD",
    "LLP Accounts": "ACCS_LLP",
    "CT600": "CT600",
    "CS01": "CS01",
    "VAT": "VAT",
    "SA100": "SA100",
    "SA800": "SA800",
    "Payroll": "PAYROLL",
    "Construction Industry Scheme": "CIS",
    "Insight Management Accounts": "MGMT_ACCOUNTS",
    "Bookkeeping": "BOOKKEEPING",
    "Model Your Success": "MYS",
    "Software": "SOFTWARE",
    "Onboarding": "ONBOARDING",
    "Capital Gains": "CGT",
    "Self-employed Accounts": "SE_ACCOUNTS",
    "Charity Accounts": "CHARITY_ACCOUNTS",
}

STAGE_FIXES = {
    ("ACCS_LTD", 4): "Missing info received",
    ("CT600", 2): "Tax computation & return preparation",
}

TITLES = {"mr", "mrs", "ms", "miss", "dr", "mx"}

# Engager title-cases acronyms ("Xyz Ltd" for "XYZ Ltd"). Fixes are kept in a
# local JSON file (--name-fixes, outside the repo) because they come from client names.
ACRONYMS = {}

STATUTORY = {"ACCS_LTD", "ACCS_LLP", "CT600", "CS01", "VAT", "SA100", "SA800", "CIS"}
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


# ---------- small cleaners ----------

def val(s):
    s = re.sub(r"\s+", " ", (s or "").strip())
    return None if s.lower() in BLANKS else s


def parse_date(s):
    s = val(s)
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%Y, %H:%M:%S"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def iso(d):
    return d.isoformat() if d else ""


def hours(s):
    s = val(s)
    if not s:
        return 0.0
    parts = s.split(":")
    try:
        h, m = int(parts[0]), int(parts[1]) if len(parts) > 1 else 0
        return round(h + m / 60, 2)
    except ValueError:
        return 0.0


def money(s):
    s = val(s)
    try:
        return round(float(s.replace(",", "").replace("£", "")), 2) if s else None
    except ValueError:
        return None


def company_number(s):
    s = val(s)
    if not s:
        return None
    s = s.replace(" ", "").upper()
    return s.zfill(8) if s.isdigit() else s


def year_end(s):
    """'Oct-31' or 'Apr 5' -> 'MM-DD'."""
    s = val(s)
    if not s:
        return None
    m = re.match(r"([A-Za-z]{3})[\s-]+(\d{1,2})$", s)
    if not m:
        return None
    return f"{MONTHS[m.group(1).lower()]:02d}-{int(m.group(2)):02d}"


def tidy_company_name(s):
    # "A.b. Smith" -> "A.B. Smith"; "Xyz Ltd" -> "XYZ Ltd" when listed in the name fixes
    s = re.sub(r"\b([A-Za-z])\.([a-z])\.", lambda m: f"{m.group(1).upper()}.{m.group(2).upper()}.", s)
    return " ".join(ACRONYMS.get(w.lower(), w) for w in s.split())


def display_person(name):
    """'Mr Adrian Saunders' -> 'Adrian Saunders'; collapses double spaces."""
    words = [w for w in (name or "").split() if w.lower().strip(".") not in TITLES]
    return " ".join(words)


def person_key(first, last):
    return (first or "").lower().strip(), (last or "").lower().strip()


def key_from_listed(name):
    """'Smith, Jane Mary' / 'Jones, Mr Tom' -> ('jane', 'smith')."""
    if "," not in name:
        return None
    last, rest = [p.strip() for p in name.split(",", 1)]
    words = [w for w in rest.split() if w.lower().strip(".") not in TITLES]
    return (words[0].lower() if words else ""), last.lower()


def key_from_display(name):
    """'Mr Adrian Saunders' -> ('adrian', 'saunders')."""
    words = [w for w in name.split() if w.lower().strip(".") not in TITLES]
    if len(words) < 2:
        return None
    return words[0].lower(), words[-1].lower()


def add_months(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    y, m = d.year + y, m + 1
    last = [31, 29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return dt.date(y, m, min(d.day, last))


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clients", required=True)
    ap.add_argument("--jobs", required=True)
    ap.add_argument("--completed", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ch", help="Companies House snapshot CSV (optional)")
    ap.add_argument("--name-fixes", help="JSON of word -> corrected word, e.g. {\"xyz\": \"XYZ\"} (optional)")
    ap.add_argument("--today", default=dt.date.today().isoformat())
    a = ap.parse_args()
    today = dt.date.fromisoformat(a.today)
    if a.name_fixes:
        ACRONYMS.update({k.lower(): v for k, v in json.loads(Path(a.name_fixes).read_text()).items()})
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    # ----- clients file: headers repeat, so work by column position -----
    rows = list(csv.reader(open(a.clients, encoding="utf-8-sig")))
    head = [h.strip() for h in rows[0]]
    first_idx = {}
    for i, h in enumerate(head):
        first_idx.setdefault(h, i)

    def col(r, name):
        i = first_idx.get(name)
        return r[i] if i is not None and i < len(r) else ""

    # locate service blocks
    blocks, seen = [], defaultdict(int)
    for i, h in enumerate(head):
        m = re.match(r"^(.+) fee$", h)
        if m and i + 1 < len(head) and head[i + 1] == m.group(1) + " fee period":
            prefix = m.group(1)
            blocks.append({"prefix": prefix, "start": i, "code": BLOCK_CODES[(prefix, seen[prefix])]})
            seen[prefix] += 1
    for bi, b in enumerate(blocks):
        end = blocks[bi + 1]["start"] if bi + 1 < len(blocks) else len(head)
        b["phases"] = []
        for j in range(b["start"], end):
            m = re.match(r".* phase (\d+): (.+) - staff$", head[j])
            if m:
                n = int(m.group(1))
                b["phases"].append({
                    "n": n,
                    "name": STAGE_FIXES.get((b["code"], n), m.group(2).strip()),
                    "staff": j, "billing": j + 1, "done": j + 2, "budget": j + 3,
                })

    clients, contacts, client_services, service_stages = [], [], [], []
    by_company_name, by_person = {}, {}
    raw_by_id = {}

    for r in rows[1:]:
        if not any(x.strip() for x in r):
            continue
        cid = f"C{int(col(r, 'ID')):04d}"
        etype = val(col(r, "Type")) or ""
        kind = {"Limited Company": "Ltd", "Limited Liability Partnership": "LLP",
                "Individual or Sole Trader": "Individual", "Contact Only": "Contact"}.get(etype, etype)
        name = val(col(r, "Name"))
        title = val(col(r, "Primary Contact Title"))
        first = val(col(r, "Primary Contact First Name"))
        last = val(col(r, "Primary Contact Last Name"))
        if kind in ("Individual", "Contact"):
            name = display_person(name) or " ".join(w for w in [first, last] if w)
        else:
            name = tidy_company_name(name)
        pref = val(col(r, "Essential contact"))
        if pref and ":" in pref:
            pref = pref.split(":", 1)[1].strip()
        rec = {
            "id": cid,
            "engager_id": col(r, "ID").strip(),
            "name": name,
            "kind": kind,
            "status": val(col(r, "Status")),
            "company_number": company_number(col(r, "Company Number")),
            "ch_auth_code": val(col(r, "Companies House authentication code")),
            "sic": val(col(r, "Nature of business (SIC codes)")),
            "incorporated": iso(parse_date(col(r, "Business start date / Date of incorporation"))),
            "engaged": iso(parse_date(col(r, "Engage date"))),
            "date_of_birth": iso(parse_date(col(r, "Date of birth"))),
            "year_end": year_end(col(r, "Accounts made up to")) if kind in ("Ltd", "LLP") else None,
            "contact_title": title,
            "contact_first": first,
            "contact_preferred": val(col(r, "Primary Contact Preferred Name")),
            "contact_last": last,
            "email": val(col(r, "E-mail")),
            "mobile": val(col(r, "Mobile number")),
            "phone": val(col(r, "Telephone number")),
            "contact_preference": pref,
            "home_address": val(col(r, "Home address")),
            "trading_address": val(col(r, "Trading address")),
            "registered_office": val(col(r, "Registered office address")),
            "partner": (val(col(r, "Director")) or "").replace(" (KB)", "") or None,
            "manager": (val(col(r, "Manager")) or "").replace(" (KB)", "") or None,
            "utr": val(col(r, "Client's Unique Taxpayer Reference (UTR)")),
            "ct_utr": val(col(r, "Client's Corporation Tax Reference")),
            "ni_number": val(col(r, "Client's National Insurance Number")),
            "vat_number": val(col(r, "VAT Registration Number")),
            "vat_registered": iso(parse_date(col(r, "Date of registration for VAT"))),
            "mtd_services": val(col(r, "MTD-registered services")),
            "paye_ref": val(col(r, "Client's PAYE Reference")),
            "accounts_office_ref": val(col(r, "Client's Accounts Office Reference")),
            "xero_id": val(col(r, "Xero ID")),
            "xama_id": val(col(r, "Xama ID")),
            "xama_status": (col(r, "Xama risk level") or "").strip("() ") or None,
            "loe_status": val(col(r, "Proposal & LoE envelope status")),
            "loe_sent": iso(parse_date(col(r, "Proposal & LoE generation date"))),
            "loe_decided": iso(parse_date(col(r, "Letter of Engagement decision date"))),
            "annual_fees": money(col(r, "Total annual fees")),
            "payment_days": val(col(r, "Payment due days")),
            "late_payment_pct": val(col(r, "Late payment %")),
            "retention_years": val(col(r, "No. of years data to be held after disengagement")),
            "relationships_raw": val(col(r, "Relationships")),
        }
        raw_by_id[cid] = rec
        if kind == "Contact":
            contacts.append({k: rec[k] for k in (
                "id", "engager_id", "name", "contact_title", "email", "mobile", "phone", "relationships_raw")})
        else:
            clients.append(rec)
        if kind in ("Ltd", "LLP"):
            by_company_name[name.lower()] = cid
        else:
            k = person_key(first, last)
            by_person[k] = cid
            dk = key_from_display(val(col(r, "Name")) or "")
            if dk:
                by_person.setdefault(dk, cid)

        # services this client has
        for b in blocks:
            s = b["start"]
            period, deadline = val(r[s + 1]), parse_date(r[s + 4])
            if not period and not deadline:
                continue
            client_services.append({
                "client_id": cid, "service": b["code"],
                "fee": money(r[s]), "fee_period": period,
                "one_off": (val(r[s + 2]) or "").lower() == "yes",
                "annual_fee": money(r[s + 3]),
                "next_deadline": iso(deadline),
            })
            for p in b["phases"]:
                service_stages.append({
                    "client_id": cid, "service": b["code"], "stage": p["n"], "name": p["name"],
                    "who": (val(r[p["staff"]]) or "").replace(" (KB)", "").replace(" (IO)", ""),
                    "billing_point": (val(r[p["billing"]]) or "").lower() == "yes",
                    "budget_hours": hours(r[p["budget"]]),
                })

    # ----- Companies House snapshot -----
    ch = {}
    if a.ch:
        with open(a.ch, encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                ch[company_number(r["company_number"])] = {k: (v.strip() or None) for k, v in r.items()}
    for c in clients:
        x = ch.get(c["company_number"])
        c["ch_checked"] = bool(x)
        c["ch_status"] = x["ch_status"] if x else None
        if x and x["next_accounts_made_up_to"]:
            c["year_end"] = x["next_accounts_made_up_to"][5:]

    stage_templates = []
    for b in blocks:
        for p in b["phases"]:
            stage_templates.append({"service": b["code"], "stage": p["n"], "name": p["name"]})
    service_templates = [{"code": k, "name": v[0], "recurrence": v[1], "deadline_rule": v[2]}
                         for k, v in SERVICES.items()]

    def match_client(name):
        n = (name or "").strip()
        if not n:
            return None
        if n.lower() in by_company_name:
            return by_company_name[n.lower()]
        if tidy_company_name(n).lower() in by_company_name:
            return by_company_name[tidy_company_name(n).lower()]
        k = key_from_listed(n) or key_from_display(n)
        return by_person.get(k) if k else None

    names = {c["id"]: c["name"] for c in clients}
    budget_by = defaultdict(float)
    for s in service_stages:
        budget_by[(s["client_id"], s["service"])] += s["budget_hours"]
    stage_no = {(t["service"], t["name"].lower()): t["stage"] for t in stage_templates}
    # Engager's job list uses the original stage names, so map those too.
    raw_stage_no = {}
    for b in blocks:
        for j in range(b["start"], len(head)):
            m = re.match(r"^" + re.escape(b["prefix"]) + r" phase (\d+): (.+) - staff$", head[j])
            if m:
                raw_stage_no.setdefault((b["code"], m.group(2).strip().lower()), int(m.group(1)))

    # ----- completed jobs (history) -----
    history = []
    with open(a.completed, encoding="utf-8-sig") as f:
        for i, r in enumerate(csv.DictReader(f), 1):
            r = {k.strip(): v for k, v in r.items()}
            task = val(r["Service type / Task name"])
            code = JOB_CODES.get(task, "TASK") if r["Job type"].strip() == "SERVICE" else "TASK"
            cid = match_client(r["Client"])
            history.append({
                "id": f"H{i:04d}",
                "client_id": cid or "",
                "engager_client": r["Client"].strip(),
                "service": code,
                "title": task if code == "TASK" else SERVICES[code][0],
                "statutory_deadline": iso(parse_date(r["Statutory deadline"])),
                "internal_deadline": iso(parse_date(r["Internal deadline"])),
                "completed": iso(parse_date(r["Complete date"])),
                "on_time": val(r["Completed on time?"]),
                "budget_hours": float(r["Budgeted time (decimal hours)"] or 0),
                "actual_hours": float(r["Time spent (decimal hours)"] or 0),
            })

    hist_by = defaultdict(list)
    for h in history:
        if h["client_id"] and h["completed"] and h["statutory_deadline"]:
            hist_by[(h["client_id"], h["service"])].append(h)

    # ----- open jobs -----
    jobs = []
    with open(a.jobs, encoding="utf-8-sig") as f:
        for i, r in enumerate(csv.DictReader(f), 1):
            r = {k.strip(): v for k, v in r.items()}
            task = val(r["Service / Task name"])
            code = JOB_CODES.get(task, "TASK")
            cid = match_client(r["Client"])
            deadline = parse_date(r["Statutory / Task Deadline"])
            phase = val(r["Current phase"])
            stage = raw_stage_no.get((code, (phase or "").lower())) or stage_no.get((code, (phase or "").lower()))

            # last year's pattern: how far before the deadline was it finished?
            # Leave at least a week before the deadline; never suggest a date in the past.
            suggested, last_done = None, None
            if deadline and cid:
                prior = [h for h in hist_by.get((cid, code), [])
                         if dt.date.fromisoformat(h["statutory_deadline"]) < deadline]
                if prior:
                    p = max(prior, key=lambda h: h["statutory_deadline"])
                    gap = (dt.date.fromisoformat(p["statutory_deadline"]) - dt.date.fromisoformat(p["completed"])).days
                    last_done = p["completed"]
                    if gap <= 366:
                        s = deadline - dt.timedelta(days=max(gap, 7))
                        while s.weekday() >= 5:  # plan on a working day
                            s -= dt.timedelta(days=1)
                        suggested = max(s, today) if deadline >= today else None

            # compare with Companies House
            ch_check, ch_deadline = "", None
            comp = raw_by_id.get(cid) if cid else None
            x = ch.get(comp["company_number"]) if comp and comp["company_number"] else None
            period = parse_date(r["Period end"])
            if x and code in ("ACCS_LTD", "ACCS_LLP"):
                last = parse_date(x["last_accounts_made_up_to"])
                if last and period and last >= period:
                    ch_check = "filed"
                else:
                    ch_deadline = parse_date(x["accounts_due"])
                    ch_check = "matches" if ch_deadline == deadline else "differs"
            elif x and code == "CS01":
                last = parse_date(x["last_cs_dated"])
                if last and period and last >= period:
                    ch_check = "filed"
                else:
                    ch_deadline = parse_date(x["cs_due"])
                    ch_check = "matches" if ch_deadline == deadline else "differs"

            jobs.append({
                "id": f"J{i:04d}",
                "client_id": cid or "",
                "engager_client": r["Client"].strip(),
                "client_name": names.get(cid, r["Client"].strip()),
                "service": code,
                "title": task if code == "TASK" else SERVICES[code][0],
                "period_end": iso(parse_date(r["Period end"])),
                "stage": stage or "",
                "stage_name": phase or "",
                "engager_status": val(r["Status"]),
                "records_received": iso(parse_date(r["Records receive date"])),
                "internal_deadline": iso(parse_date(r["Internal Deadline"])),
                "deadline": iso(deadline),
                "days_to_deadline": (deadline - today).days if deadline else "",
                "planned_date": "",
                "estimate_hours": round(budget_by.get((cid, code), 0.0), 2),
                "suggested_slot": iso(suggested),
                "last_completed": last_done or "",
                "ch_check": ch_check,
                "ch_deadline": iso(ch_deadline),
                "fee": money(r["Fee"]),
                "fee_period": val(r["Fee period"]),
                "notes": val(r.get("Notes")),
            })

    # ----- suggested groups from relationships -----
    graph = defaultdict(set)
    for c in clients:
        for part in (c["relationships_raw"] or "").split(";"):
            part = part.strip()
            if not part or "(secondary contact" in part:
                continue
            other = match_client(re.sub(r"\s*\(.*$", "", part))
            if other and other != c["id"]:
                graph[c["id"]].add(other)
                graph[other].add(c["id"])
    seen_ids, groups, members = set(), [], []
    for c in clients:
        if c["id"] in seen_ids or c["id"] not in graph:
            continue
        stack, comp = [c["id"]], set()
        while stack:
            x = stack.pop()
            if x in comp:
                continue
            comp.add(x)
            stack.extend(graph[x] - comp)
        seen_ids |= comp
        if len(comp) < 2:
            continue
        people = [x for x in comp if raw_by_id[x]["kind"] == "Individual"]
        anchor = max(people or comp, key=lambda x: len(graph[x]))
        if raw_by_id[anchor]["kind"] in ("Individual", "Contact"):
            surname = raw_by_id[anchor]["name"].split()[-1]
        else:
            surname = re.sub(r"\s+(Ltd|Limited|LLP)$", "", raw_by_id[anchor]["name"])
        gname = f"{surname} group"
        if any(g["name"] == gname for g in groups):
            gname = f"{raw_by_id[anchor]['name']} group"
            for g in groups:
                if g["name"] == f"{surname} group":
                    g["name"] = f"{g['anchor']} group"
        gid = f"G{len(groups) + 1:02d}"
        groups.append({"id": gid, "name": gname, "anchor": raw_by_id[anchor]["name"], "suggested": True})
        for x in sorted(comp, key=lambda x: (raw_by_id[x]["kind"] in ("Individual", "Contact"), raw_by_id[x]["name"])):
            members.append({"group_id": gid, "client_id": x, "client_name": raw_by_id[x]["name"],
                            "kind": raw_by_id[x]["kind"]})

    # ----- quality checks -----
    issues = []

    def issue(level, cid, area, text, detail="", fallback=""):
        issues.append({"level": level, "client_id": cid or "", "client": names.get(cid, fallback or cid or ""),
                       "area": area, "issue": text, "detail": detail})

    def fmt(d):
        return dt.date.fromisoformat(d).strftime("%-d %b %Y") if d else ""

    for j in jobs:
        cid = j["client_id"]
        what = j["title"] + (f" (period to {fmt(j['period_end'])})" if j["period_end"] else "")
        if not cid:
            issue("Check", None, "Jobs", f"Open job for a client not in the client list: {j['engager_client']}",
                  f"{what} · due {fmt(j['deadline'])}. Former company, or a duplicate record?",
                  fallback=j["engager_client"])
        if j["ch_check"] == "filed":
            issue("Check", cid, "Deadlines", f"{what} already filed at Companies House",
                  f"Engager still shows it open ({j['stage_name']}). It will come in as complete, "
                  "with next year's job created from the Companies House dates.")
            continue
        if j["ch_check"] == "differs":
            issue("Check", cid, "Deadlines", f"{what}: deadline differs from Companies House",
                  f"Engager {fmt(j['deadline'])} · Companies House {fmt(j['ch_deadline'])}. "
                  "The Companies House date will be used.")
        days = j["days_to_deadline"]
        if days == "":
            continue
        comp = raw_by_id.get(cid) if cid else None
        flagged = comp and (ch.get(comp["company_number"]) or {}).get("ch_warning")
        if flagged and j["service"] in ("ACCS_LTD", "ACCS_LLP", "CS01"):
            continue  # already reported once from the Companies House warning
        if days < 0:
            if j["service"] in STATUTORY or j["service"] == "TASK":
                issue("Action now", cid, "Deadlines", f"{what} is past its deadline and still open",
                      f"Due {fmt(j['deadline'])} ({-days} days ago), at stage: {j['stage_name']}. "
                      "If it's done, it just needs ticking off; if not, it's late.", fallback=j["engager_client"])
            else:
                issue("Check", cid, "Jobs", f"{what}: recurring job never ticked off",
                      f"Was due {fmt(j['deadline'])}. Likely done but not completed in Engager.")
        elif days <= 30 and j["stage"] in (1, "") and j["service"] in STATUTORY:
            issue("Action now", cid, "Deadlines", f"{what} due in {days} days, not started",
                  f"Due {fmt(j['deadline'])} · stage: {j['stage_name']}")

    open_by = defaultdict(set)
    for j in jobs:
        if j["ch_check"] != "filed":
            open_by[j["client_id"]].add(j["service"])
    svc_by = defaultdict(set)
    for s in client_services:
        svc_by[s["client_id"]].add(s["service"])

    for c in clients:
        cid, k = c["id"], c["kind"]
        if k in ("Ltd", "LLP"):
            x = ch.get(c["company_number"])
            if not x:
                issue("Check", cid, "Companies House", "Not yet checked against Companies House",
                      "The page couldn't be read during import; the daily check will cover it.")
            elif x.get("ch_warning"):
                issue("Action now", cid, "Companies House", f"Companies House shows: {x['ch_warning']}",
                      f"Status: {x['ch_status']}. Accounts to {fmt(x['next_accounts_made_up_to'])} were due "
                      f"{fmt(x['accounts_due'])}; confirmation statement was due {fmt(x['cs_due'])}.")
            accs = "ACCS_LTD" if k == "Ltd" else "ACCS_LLP"
            needed = [(accs, "next_accounts_made_up_to", "accounts_due"), ("CS01", "next_cs_date", "cs_due")]
            if k == "Ltd":
                needed.append(("CT600", None, None))
            for code, made_up, due in needed:
                if code in open_by[cid]:
                    continue
                if code in {j["service"] for j in jobs if j["client_id"] == cid and j["ch_check"] == "filed"}:
                    continue  # next one gets created from the filed job
                if x and due and x.get(due) and not x.get("ch_warning"):
                    left = (dt.date.fromisoformat(x[due]) - today).days
                    issue("Action now" if left <= 60 else "Check", cid, "Jobs",
                          f"No {SERVICES[code][0].lower()} job set up",
                          f"Companies House: period to {fmt(x[made_up])}, due {fmt(x[due])} ({left} days).")
                elif not (x and x.get("ch_warning")):
                    issue("Check", cid, "Jobs", f"No {SERVICES[code][0].lower()} job set up",
                          "Every active company needs one, unless it's dormant or handled elsewhere.")
        if k == "Ltd":
            if not c["company_number"]:
                issue("Tidy-up", cid, "References", "Company number missing")
            if not c["ch_auth_code"]:
                issue("Tidy-up", cid, "References", "Companies House authentication code missing")
            if not c["ct_utr"]:
                issue("Tidy-up", cid, "References", "Corporation tax UTR missing")
            if not c["year_end"]:
                issue("Tidy-up", cid, "Dates", "Year end missing")
        if k == "LLP" and not c["company_number"]:
            issue("Tidy-up", cid, "References", "LLP registration number missing")
        if k == "Individual":
            if "SA100" in svc_by[cid] or "SA100" in open_by[cid]:
                if not c["utr"]:
                    issue("Tidy-up", cid, "References", "Self Assessment UTR missing")
                if not c["ni_number"]:
                    issue("Tidy-up", cid, "References", "National Insurance number missing")
            elif not open_by[cid]:
                issue("Check", cid, "Jobs", "No services or open jobs",
                      "Is this still a client, or a contact only?")
        if "VAT" in svc_by[cid] | open_by[cid] and not c["vat_number"]:
            issue("Tidy-up", cid, "References", "VAT work set up but no VAT number recorded")
        if "PAYROLL" in svc_by[cid] | open_by[cid] and not c["paye_ref"]:
            issue("Tidy-up", cid, "References", "Payroll set up but no PAYE reference recorded")
        if not c["email"] and not c["mobile"]:
            issue("Tidy-up", cid, "Contact", "No email or mobile for the primary contact")
        if c["loe_status"] != "Finalised":
            issue("Check", cid, "Compliance", "No signed engagement letter recorded",
                  f"Engager status: {c['loe_status'] or 'none'}")
        if c["xama_status"] in (None, "not linked", "no assessment"):
            issue("Check", cid, "Compliance", "AML risk assessment not recorded",
                  f"Xama: {c['xama_status'] or 'not linked'}")

    # ----- write -----
    def write(name, rows_, fields=None):
        fields = fields or (list(rows_[0].keys()) if rows_ else [])
        with open(out / f"{name}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for x in rows_:
                w.writerow({k: ("" if x.get(k) is None else x.get(k)) for k in fields})

    write("clients", clients)
    write("contacts", contacts)
    write("service_templates", service_templates)
    write("stage_templates", stage_templates)
    write("client_services", client_services)
    write("client_service_stages", service_stages)
    write("jobs", jobs)
    write("job_history", history)
    write("groups_suggested", groups)
    write("group_members_suggested", members)
    order = {"Action now": 0, "Check": 1, "Tidy-up": 2}
    issues.sort(key=lambda x: (order[x["level"]], x["client"], x["area"]))
    write("quality_issues", issues)

    summary = {
        "today": a.today,
        "clients": len(clients),
        "by_kind": {k: sum(1 for c in clients if c["kind"] == k) for k in ("Ltd", "LLP", "Individual")},
        "contacts": len(contacts),
        "open_jobs": len(jobs),
        "open_jobs_unmatched": sum(1 for j in jobs if not j["client_id"]),
        "history_jobs": len(history),
        "history_unmatched_clients": sorted({h["engager_client"] for h in history if not h["client_id"]}),
        "groups_suggested": len(groups),
        "issues": {lvl: sum(1 for x in issues if x["level"] == lvl) for lvl in order},
        "jobs_with_budget": sum(1 for j in jobs if j["estimate_hours"]),
        "jobs_with_suggested_slot": sum(1 for j in jobs if j["suggested_slot"]),
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
