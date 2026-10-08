#!/usr/bin/env python3
"""Apply the practice's decisions from the import-check workbook and write the final tables.

Usage:
    python3 apply_decisions.py --out out --decisions raw/decisions.xlsx \
        --ch raw/ch_snapshot.csv --final final --today 2026-10-08

Reads the import tables in --out, applies each yellow-cell decision, and writes
the tables that get loaded into SharePoint into --final, plus import_log.csv
listing every change made and anything still needing an answer.
"""
import argparse
import calendar
import csv
import datetime as dt
import re
from pathlib import Path

from openpyxl import load_workbook


def read(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write(path, rows, fields=None):
    fields = fields or (list(rows[0].keys()) if rows else [])
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in fields})


def d(s):
    return dt.date.fromisoformat(s) if s else None


def add_months(day, n, month_end=False):
    y, m = divmod(day.month - 1 + n, 12)
    y, m = day.year + y, m + 1
    last = calendar.monthrange(y, m)[1]
    return dt.date(y, m, last if month_end else min(day.day, last))


def is_month_end(day):
    return day.day == calendar.monthrange(day.year, day.month)[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--decisions", required=True)
    ap.add_argument("--ch", required=True)
    ap.add_argument("--final", required=True)
    ap.add_argument("--extra", help="CSV of further jobs to create: client,service,period_end,deadline,why")
    ap.add_argument("--extra-members", help="CSV of further group members: group,member,kind,why")
    ap.add_argument("--today", default=dt.date.today().isoformat())
    a = ap.parse_args()
    out, final, today = Path(a.out), Path(a.final), dt.date.fromisoformat(a.today)
    final.mkdir(parents=True, exist_ok=True)

    clients = read(out / "clients.csv")
    contacts = read(out / "contacts.csv")
    jobs = read(out / "jobs.csv")
    history = read(out / "job_history.csv")
    stages = read(out / "stage_templates.csv")
    services = {s["code"]: s for s in read(out / "service_templates.csv")}
    ch = {r["company_number"].zfill(8) if r["company_number"].isdigit() else r["company_number"]: r
          for r in read(a.ch)}
    by_name = {c["name"]: c for c in clients}
    by_id = {c["id"]: c for c in clients}
    first_stage = {}
    for s in stages:
        if s["stage"] == "1":
            first_stage[s["service"]] = s["name"]

    log = []

    def note(kind, client, what, detail=""):
        log.append({"type": kind, "client": client, "what": what, "detail": detail})

    for j in jobs:
        j["priority"] = ""
        j["source"] = "Engager"

    next_id = [max(int(j["id"][1:]) for j in jobs) + 1]

    def new_job(client, code, period_end, deadline, why, priority=""):
        jid = f"J{next_id[0]:04d}"
        next_id[0] += 1
        job = {k: "" for k in jobs[0].keys()}
        job.update({
            "id": jid, "client_id": client["id"], "engager_client": "", "client_name": client["name"],
            "service": code, "title": services[code]["name"], "period_end": period_end.isoformat(),
            "stage": 1, "stage_name": first_stage.get(code, ""), "deadline": deadline.isoformat(),
            "days_to_deadline": (deadline - today).days, "estimate_hours": 0.0,
            "priority": priority, "source": "Created at import",
        })
        jobs.append(job)
        note("Job created", client["name"], f"{job['title']} · period to {period_end:%-d %b %Y}",
             f"Due {deadline:%-d %b %Y}. {why}")
        return job

    def close(job, why):
        history.append({
            "id": f"H{len(history) + 1:04d}", "client_id": job["client_id"], "engager_client": job["engager_client"],
            "service": job["service"], "title": job["title"], "statutory_deadline": job["deadline"],
            "internal_deadline": job["internal_deadline"], "completed": "", "on_time": "",
            "budget_hours": job["estimate_hours"], "actual_hours": 0, "closed_note": why,
        })
        jobs.remove(job)
        note("Job closed", job["client_name"], f"{job['title']} · period to {job['period_end']}", why)

    def ch_for(client):
        return ch.get(client.get("company_number") or "")

    # ---------- further jobs confirmed after the workbook ----------
    extra_for = set()
    if a.extra:
        for x in read(a.extra):
            client = by_name.get(x["client"])
            if not client:
                note("Not matched", x["client"], f"Extra job {x['service']}", "No client by that name")
                continue
            extra_for.add(x["client"])
            new_job(client, x["service"], d(x["period_end"]), d(x["deadline"]), x["why"])

    # ---------- decisions ----------
    wb = load_workbook(a.decisions)
    decided = []
    ws = wb["Action now"]
    for r in range(2, ws.max_row + 1):
        if ws.cell(row=r, column=1).value:
            decided.append(("Action now", ws.cell(row=r, column=1).value, ws.cell(row=r, column=2).value,
                            ws.cell(row=r, column=4).value, ws.cell(row=r, column=5).value))
    ws = wb["Checks"]
    for r in range(2, ws.max_row + 1):
        if ws.cell(row=r, column=1).value:
            decided.append(("Checks", ws.cell(row=r, column=1).value, ws.cell(row=r, column=3).value,
                            ws.cell(row=r, column=5).value, None))

    def find_job(client_name, what):
        m = re.match(r"(.+?)(?: \(period to (.+?)\))?(?::| is | due | already |$)", what)
        title, period = m.group(1).strip(), m.group(2)
        for j in jobs:
            if j["client_name"] == client_name and j["title"] == title:
                if not period or dt.date.fromisoformat(j["period_end"]).strftime("%-d %b %Y") == period:
                    return j
        return None

    for sheet, client_name, what, decision, comment in decided:
        client = by_name.get(client_name)
        if not decision:
            note("No decision", client_name, what)
            continue
        if decision in ("Not needed", "Leave as is", "Not our job"):
            note("Left as is", client_name, what, decision)
            continue

        if sheet == "Action now":
            if what.startswith("Companies House shows"):
                x = ch_for(client)
                for j in jobs:
                    if j["client_id"] == client["id"] and j["service"] == "ACCS_LTD" and x:
                        if j["period_end"] != x["next_accounts_made_up_to"]:
                            note("Corrected from Companies House", client_name, "Accounts period end",
                                 f"{j['period_end']} → {x['next_accounts_made_up_to']} (Engager had the wrong year)")
                            j["period_end"] = x["next_accounts_made_up_to"]
                        j["priority"] = "urgent"
                    if j["client_id"] == client["id"] and j["service"] == "CS01":
                        j["priority"] = "urgent"
                note("Marked urgent", client_name, "Overdue accounts and confirmation statement",
                     "Companies House also shows a proposal to strike off.")
                continue
            if what.startswith("No "):
                pass  # handled with the job set-up rules below
            else:
                j = find_job(client_name, what)
                if j:
                    j["priority"] = "urgent"
                    note("Marked urgent", client_name, what)
                else:
                    note("Not matched", client_name, what, "Couldn't find this job")
                continue

        # --- shared rules for "Set up the job" / "Needs doing" style answers ---
        if "already filed at Companies House" in what:
            j = find_job(client_name, what)
            x = ch_for(client)
            if j and x:
                close(j, "Filed at Companies House; never ticked off in Engager")
                if j["service"] == "CS01":
                    new_job(client, "CS01", d(x["next_cs_date"]), d(x["cs_due"]), "Next one, from Companies House.")
                else:
                    new_job(client, j["service"], d(x["next_accounts_made_up_to"]), d(x["accounts_due"]),
                            "Next year's accounts, from Companies House.")
        elif "deadline differs from Companies House" in what:
            j = find_job(client_name, what)
            x = ch_for(client)
            if j and x:
                old = (j["period_end"], j["deadline"])
                if j["service"] == "CS01":
                    j["period_end"], j["deadline"] = x["next_cs_date"], x["cs_due"]
                else:
                    j["period_end"], j["deadline"] = x["next_accounts_made_up_to"], x["accounts_due"]
                j["days_to_deadline"] = (d(j["deadline"]) - today).days
                note("Corrected from Companies House", client_name, j["title"],
                     f"Period {old[0]} → {j['period_end']}; due {old[1]} → {j['deadline']}")
        elif "recurring job never ticked off" in what:
            j = find_job(client_name, what)
            if not j:
                note("Not matched", client_name, what)
                continue
            if j["service"] == "ONBOARDING":
                j["priority"] = "urgent"
                note("Kept open", client_name, "Onboarding", "Still at the AML stage, so left open and marked urgent.")
                continue
            last = d(j["deadline"])
            month_end = is_month_end(last)
            n = 1
            while add_months(last, n, month_end) < today:
                n += 1
            nxt = add_months(last, n, month_end)
            close(j, "Older period never ticked off in Engager; closed at import")
            new_job(client, j["service"], nxt, nxt, "Current period of a monthly job.")
        elif re.match(r"No (.+) job set up", what):
            label = re.match(r"No (.+) job set up", what).group(1)
            code = {"limited company accounts": "ACCS_LTD", "confirmation statement": "CS01",
                    "corporation tax return": "CT600"}[label]
            x = ch_for(client)
            pr = "urgent" if sheet == "Action now" else ""
            if not x:
                note("Needs your input", client_name, what, "No Companies House data to set dates from.")
            elif code == "ACCS_LTD":
                new_job(client, code, d(x["next_accounts_made_up_to"]), d(x["accounts_due"]),
                        "Dates from Companies House.", pr)
            elif code == "CS01":
                new_job(client, code, d(x["next_cs_date"]), d(x["cs_due"]), "Dates from Companies House.", pr)
            else:
                period = d(x["last_accounts_made_up_to"]) or d(x["next_accounts_made_up_to"])
                why = ("For the last accounts filed. Tick it off if the return is already in."
                       if x["last_accounts_made_up_to"] else "For the first accounting period.")
                new_job(client, code, period, add_months(period, 12, is_month_end(period)), why, pr)
        elif "Open job for a client not in the client list" in what:
            name = what.split(": ", 1)[1]
            if name not in by_name:
                cid = "C9001"
                rec = {k: "" for k in clients[0].keys()}
                rec.update({"id": cid, "name": name, "kind": "Ltd", "status": "active"})
                clients.append(rec)
                by_name[name] = rec
                by_id[cid] = rec
                for j in jobs:
                    if j["engager_client"] == name:
                        j["client_id"], j["client_name"] = cid, name
                for h in history:
                    if h["engager_client"] == name:
                        h["client_id"] = cid
                note("Client created", name, "New client record",
                     "Only the name is known; add the company number so Companies House can fill in the rest.")
        elif "No services or open jobs" in what:
            if client_name not in extra_for:
                note("Needs your input", client_name, "Which job to set up?",
                     "Answer was 'Set up the job' but there's nothing to base it on (e.g. a Self Assessment return?).")
        elif "Not yet checked against Companies House" in what:
            x = ch_for(client)
            if x:
                note("Checked", client_name, "Companies House", "Checked again: matches Engager.")
            else:
                note("Waiting", client_name, "Companies House",
                     "Couldn't be read during import; the daily check will cover it.")
        else:
            note("Not matched", client_name, what, f"Decision: {decision}")

    # ---------- groups ----------
    ws = wb["Groups"]
    groups, members = {}, []
    # a rename typed on any row of a group applies to the whole group
    group_rename = {}
    for r in range(2, ws.max_row + 1):
        suggested, rename = ws.cell(row=r, column=1).value, ws.cell(row=r, column=5).value
        keep = (ws.cell(row=r, column=4).value or "").upper()
        if suggested and rename and keep != "N":
            group_rename.setdefault(suggested, rename.strip())
    for r in range(2, ws.max_row + 1):
        suggested, member, kind = (ws.cell(row=r, column=c).value for c in (1, 2, 3))
        keep, rename = ws.cell(row=r, column=4).value, ws.cell(row=r, column=5).value
        if not suggested or not member or member.startswith("Built from"):
            continue
        target = (rename or group_rename.get(suggested) or suggested).strip()
        if (keep or "").upper() == "N" and not rename:
            note("Removed from group", member, suggested)
            continue
        if target not in groups:
            groups[target] = {"id": f"G{len(groups) + 1:02d}", "name": target}
        cid = (by_name.get(member) or {}).get("id") or next(
            (c["id"] for c in contacts if c["name"] == member), "")
        members.append({"group_id": groups[target]["id"], "group": target, "client_id": cid,
                        "member": member, "kind": kind})
        if (keep or "").upper() == "N" and rename:
            note("Moved group", member, f"{suggested} → {target}")
    if a.extra_members:
        for x in read(a.extra_members):
            if x["group"] not in groups:
                groups[x["group"]] = {"id": f"G{len(groups) + 1:02d}", "name": x["group"]}
            client = by_name.get(x["member"])
            members.append({"group_id": groups[x["group"]]["id"], "group": x["group"],
                            "client_id": client["id"] if client else "", "member": x["member"], "kind": x["kind"]})
            note("Added to group", x["member"], x["group"], x["why"])

    # ---------- write ----------
    for j in jobs:
        j["days_to_deadline"] = (d(j["deadline"]) - today).days if j["deadline"] else ""
    jobs.sort(key=lambda j: (j["deadline"] or "9999", j["client_name"]))
    for name in ("service_templates", "stage_templates", "client_services", "client_service_stages"):
        (final / f"{name}.csv").write_text((out / f"{name}.csv").read_text())
    write(final / "clients.csv", clients)
    write(final / "contacts.csv", contacts)
    write(final / "jobs.csv", jobs)
    write(final / "job_history.csv", history,
          list(history[0].keys()) + (["closed_note"] if "closed_note" not in history[0] else []))
    write(final / "groups.csv", list(groups.values()))
    write(final / "group_members.csv", members)
    write(final / "import_log.csv", log)
    counts = {}
    for x in log:
        counts[x["type"]] = counts.get(x["type"], 0) + 1
    print(counts)
    print(len(clients), "clients,", len(jobs), "open jobs,", len(history), "history,", len(groups), "groups")


if __name__ == "__main__":
    main()
