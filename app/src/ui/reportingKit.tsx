// Shared by the reporting screens: the saved monthly figures for a client (with a way to read them again from Xero) and the small controls.
import { useCallback, useEffect, useState } from "react";
import { todayIso } from "../lib/domain";
import { KpiSettings, SavedAlerts, alertLines, computeKpis, snapshotOf, triggeredAlerts } from "../lib/kpis";
import { ReportData, lastCompleteMonth, readReportData, reportItem } from "../lib/reportData";
import { XeroApi, XeroError } from "../lib/xero";
import { SharePointStore } from "../lib/sharepoint";
import { readSetting, useData } from "./data";
import { useXero } from "./XeroSettings";

type Load = { data?: ReportData; busy: string; error?: string; checked: boolean };

/** Reads a client's months from Xero and keeps them on the signed-in person's OneDrive. */
export async function readAndSave(api: XeroApi, store: SharePointStore, clientKey: string, tenant: { tenantId: string; tenantName: string }, step: (m: string) => void): Promise<ReportData> {
  const d = await readReportData(api, tenant, lastCompleteMonth(todayIso()), 36, step);
  await store.graph.put(`${reportItem(clientKey)}:/content`, new TextEncoder().encode(JSON.stringify(d)), "application/json");
  return d;
}

export type ReadNote = { at: string; month: string };
/** After a read: note when it happened (shown across Reporting, and in the list of clients) and keep the KPI alerts it raises for the morning email. */
export function useRecordRead() {
  const { data, saveSetting } = useData();
  return useCallback(async (clientKey: string, d: ReportData) => {
    const month = d.months[d.months.length - 1] || "";
    await saveSetting(`reporting.read.${clientKey}`, { at: d.at, month } satisfies ReadNote);
    if (!month) return;
    const kpi = readSetting<KpiSettings>(data.settings, `reporting.kpi.${clientKey}`) || {};
    const lines = alertLines(triggeredAlerts(computeKpis(d, "month", month, 9, kpi), kpi));
    await saveSetting(`reporting.snap.${clientKey}`, snapshotOf(computeKpis(d, "month", month, 9, { ...kpi, off: [] }), d.at, month));
    const before = readSetting<SavedAlerts>(data.settings, `reporting.alerts.${clientKey}`);
    if (lines.length || before?.lines.length) await saveSetting(`reporting.alerts.${clientKey}`, { at: d.at, month, lines } satisfies SavedAlerts);
  }, [data.settings, saveSetting]);
}

/** The saved figures for a client, and a way to read them again from Xero. */
export function useReportData(clientKey: string, tenant?: { tenantId: string; tenantName: string }) {
  const { store } = useData();
  const api = useXero();
  const [s, setS] = useState<Load>({ busy: "", checked: false });
  const tenantId = tenant?.tenantId;

  useEffect(() => {
    let live = true;
    setS({ busy: "Opening the saved figures…", checked: false });
    store.graph.download(reportItem(clientKey)).then(
      (bytes) => {
        if (!live) return;
        try { const saved = JSON.parse(new TextDecoder().decode(bytes)) as ReportData; setS({ data: saved.v === 3 ? saved : undefined, busy: "", checked: true }); } catch { setS({ busy: "", checked: true }); } // an older layout of the saved figures is read again
      },
      () => live && setS({ busy: "", checked: true }),
    );
    return () => { live = false; };
  }, [clientKey, store]);

  const record = useRecordRead();
  const refresh = useCallback(async () => {
    if (!tenant || !tenantId) return;
    setS((x) => ({ ...x, busy: "Reading from Xero…", error: undefined }));
    try {
      const d = await readAndSave(api, store, clientKey, tenant, (m) => setS((x) => ({ ...x, busy: m })));
      await record(clientKey, d);
      setS({ data: d, busy: "", checked: true });
    } catch (e) {
      setS((x) => ({ ...x, busy: "", error: e instanceof XeroError ? e.message : "The figures couldn't be read from Xero or saved. Try again." }));
    }
  }, [api, store, clientKey, tenant, tenantId, record]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...s, refresh };
}


export function Seg<T extends string>({ value, set, opts, label }: { value: T; set: (v: T) => void; opts: [T, string][]; label: string }) {
  return <div className="seg" role="group" aria-label={label}>{opts.map(([k, l]) => <button key={k} type="button" aria-pressed={value === k} onClick={() => set(k)}>{l}</button>)}</div>;
}
