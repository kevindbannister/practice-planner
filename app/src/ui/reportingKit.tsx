// Shared by the reporting screens: the saved monthly figures for a client (with a way to read them again from Xero) and the small controls.
import { useCallback, useEffect, useState } from "react";
import { todayIso } from "../lib/domain";
import { ReportData, lastCompleteMonth, readReportData, reportItem } from "../lib/reportData";
import { XeroError } from "../lib/xero";
import { useData } from "./data";
import { useXero } from "./XeroSettings";

type Load = { data?: ReportData; busy: string; error?: string; checked: boolean };

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

  const refresh = useCallback(async () => {
    if (!tenant || !tenantId) return;
    setS((x) => ({ ...x, busy: "Reading from Xero…", error: undefined }));
    try {
      const d = await readReportData(api, tenant, lastCompleteMonth(todayIso()), 36, (m) => setS((x) => ({ ...x, busy: m })));
      await store.graph.put(`${reportItem(clientKey)}:/content`, new TextEncoder().encode(JSON.stringify(d)), "application/json");
      setS({ data: d, busy: "", checked: true });
    } catch (e) {
      setS((x) => ({ ...x, busy: "", error: e instanceof XeroError ? e.message : "The figures couldn't be read from Xero or saved. Try again." }));
    }
  }, [api, store, clientKey, tenant, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...s, refresh };
}


export function Seg<T extends string>({ value, set, opts, label }: { value: T; set: (v: T) => void; opts: [T, string][]; label: string }) {
  return <div className="seg" role="group" aria-label={label}>{opts.map(([k, l]) => <button key={k} type="button" aria-pressed={value === k} onClick={() => set(k)}>{l}</button>)}</div>;
}
