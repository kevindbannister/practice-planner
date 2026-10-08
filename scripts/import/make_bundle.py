#!/usr/bin/env python3
"""Package the final import tables as the bundle the app's Setup page loads.

Usage: python3 make_bundle.py --final final --file practice-planner-import.json

Field names here must match the SharePoint columns in app/src/lib/schema.ts.
The bundle holds client data: keep it out of the repository and delete it once loaded.
"""
import argparse
import csv
import datetime as dt
import json
from pathlib import Path


def read(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def num(v):
    try:
        return float(v) if v not in ("", None) else None
    except ValueError:
        return None


def flag(v):
    return str(v).lower() in ("true", "yes", "1")


def clean(row):
    return {k: v for k, v in row.items() if v not in ("", None)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--final", required=True)
    ap.add_argument("--file", required=True)
    a = ap.parse_args()
    f = Path(a.final)

    clients = read(f / "clients.csv")
    names = {c["id"]: c["name"] for c in clients}
    lists = {}

    lists["Services"] = [clean({
        "Key": s["code"], "Title": s["name"], "Recurrence": s["recurrence"], "DeadlineRule": s["deadline_rule"],
    }) for s in read(f / "service_templates.csv")]

    lists["StageTemplates"] = [clean({
        "Key": f"ST:{s['service']}:{s['stage']}", "Title": s["name"], "ServiceKey": s["service"],
        "StageNo": int(s["stage"]),
    }) for s in read(f / "stage_templates.csv")]

    lists["Clients"] = [clean({
        "Key": c["id"], "Title": c["name"], "Kind": c["kind"], "Status": c["status"],
        "CompanyNumber": c["company_number"], "CHAuthCode": c["ch_auth_code"], "SIC": c["sic"],
        "Incorporated": c["incorporated"], "Engaged": c["engaged"], "DateOfBirth": c["date_of_birth"],
        "YearEnd": c["year_end"], "ContactTitle": c["contact_title"], "ContactFirst": c["contact_first"],
        "ContactPreferred": c["contact_preferred"], "ContactLast": c["contact_last"], "Email": c["email"],
        "Mobile": c["mobile"], "Phone": c["phone"], "ContactPreference": c["contact_preference"],
        "HomeAddress": c["home_address"], "TradingAddress": c["trading_address"],
        "RegisteredOffice": c["registered_office"], "Partner": c["partner"], "Manager": c["manager"],
        "UTR": c["utr"], "CTUTR": c["ct_utr"], "NINumber": c["ni_number"], "VATNumber": c["vat_number"],
        "VATRegistered": c["vat_registered"], "MTDServices": c["mtd_services"], "PAYERef": c["paye_ref"],
        "AccountsOfficeRef": c["accounts_office_ref"], "XeroId": c["xero_id"], "XamaId": c["xama_id"],
        "XamaStatus": c["xama_status"], "LoEStatus": c["loe_status"], "LoESent": c["loe_sent"],
        "LoEDecided": c["loe_decided"], "AnnualFees": num(c["annual_fees"]), "PaymentDays": num(c["payment_days"]),
        "LatePaymentPct": num(c["late_payment_pct"]), "RetentionYears": num(c["retention_years"]),
        "EngagerId": c["engager_id"], "CHChecked": flag(c.get("ch_checked")), "CHStatus": c.get("ch_status"),
    }) for c in clients]

    lists["Contacts"] = [clean({
        "Key": c["id"], "Title": c["name"], "ContactTitle": c["contact_title"], "Email": c["email"],
        "Mobile": c["mobile"], "Phone": c["phone"], "Relationships": c["relationships_raw"],
        "EngagerId": c["engager_id"],
    }) for c in read(f / "contacts.csv")]

    lists["Groups"] = [{"Key": g["id"], "Title": g["name"]} for g in read(f / "groups.csv")]

    lists["GroupMembers"] = [clean({
        "Key": f"GM:{m['group_id']}:{m['client_id']}", "Title": m["member"], "GroupKey": m["group_id"],
        "MemberKey": m["client_id"], "Kind": m["kind"],
    }) for m in read(f / "group_members.csv")]

    lists["ClientServices"] = [clean({
        "Key": f"CS:{s['client_id']}:{s['service']}", "Title": f"{names.get(s['client_id'], s['client_id'])} · {s['service']}",
        "ClientKey": s["client_id"], "ServiceKey": s["service"], "Fee": num(s["fee"]), "FeePeriod": s["fee_period"],
        "OneOff": flag(s["one_off"]), "AnnualFee": num(s["annual_fee"]), "NextDeadline": s["next_deadline"],
    }) for s in read(f / "client_services.csv")]

    lists["ClientServiceStages"] = [clean({
        "Key": f"CSS:{s['client_id']}:{s['service']}:{s['stage']}", "Title": s["name"],
        "ClientKey": s["client_id"], "ServiceKey": s["service"], "StageNo": int(s["stage"]), "Who": s["who"],
        "BudgetHours": num(s["budget_hours"]) or None, "BillingPoint": flag(s["billing_point"]),
    }) for s in read(f / "client_service_stages.csv")]

    lists["Jobs"] = [clean({
        "Key": j["id"], "Title": j["title"], "ClientKey": j["client_id"], "ClientName": j["client_name"],
        "ServiceKey": j["service"], "PeriodEnd": j["period_end"], "StageNo": int(j["stage"]) if j["stage"] else None,
        "StageName": j["stage_name"], "RecordsReceived": j["records_received"], "PlannedDate": j["planned_date"],
        "EstimateHours": num(j["estimate_hours"]) or None, "InternalDeadline": j["internal_deadline"],
        "Deadline": j["deadline"], "DeadlineSource": "Companies House" if j["ch_check"] in ("matches", "differs") else "",
        "CHDeadline": j["ch_deadline"], "SuggestedSlot": j["suggested_slot"], "LastCompleted": j["last_completed"],
        "Priority": j["priority"], "Status": "Open", "Fee": num(j["fee"]) or None, "FeePeriod": j["fee_period"],
        "Source": j["source"], "EngagerClient": j["engager_client"], "Notes": j["notes"],
    }) for j in read(f / "jobs.csv")]

    lists["JobHistory"] = [clean({
        "Key": h["id"], "Title": h["title"], "ClientKey": h["client_id"], "EngagerClient": h["engager_client"],
        "ServiceKey": h["service"], "StatutoryDeadline": h["statutory_deadline"],
        "InternalDeadline": h["internal_deadline"], "Completed": h["completed"], "OnTime": h["on_time"],
        "BudgetHours": num(h["budget_hours"]) or None, "ActualHours": num(h["actual_hours"]) or None,
        "ClosedNote": h.get("closed_note"),
    }) for h in read(f / "job_history.csv")]

    for name, rows in lists.items():
        keys = [r["Key"] for r in rows]
        dupes = {k for k in keys if keys.count(k) > 1}
        if dupes:
            raise SystemExit(f"{name}: duplicate keys {sorted(dupes)[:5]}")
        if any(not r.get("Title") for r in rows):
            raise SystemExit(f"{name}: a row has no Title")

    bundle = {"format": "practice-planner-import", "version": 1,
              "created": dt.datetime.now().isoformat(timespec="seconds"), "lists": lists}
    Path(a.file).write_text(json.dumps(bundle, ensure_ascii=False, indent=1))
    print({k: len(v) for k, v in lists.items()})


if __name__ == "__main__":
    main()
