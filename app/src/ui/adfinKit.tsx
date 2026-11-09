// The Adfin bridge (its sealed sign-in kept in settings) and the daily keep-alive, apart from the Billing screens so that the keep-alive,
// which runs on every page, doesn't put Billing into the app's first download.
import { useEffect } from "react";
import { getAccessToken } from "../lib/auth";
import { AdfinApi, FakeAdfin, HttpAdfin } from "../lib/adfin";
import { ADFIN_CONNECTION_KEY } from "../lib/billing";
import { Row } from "../lib/schema";
import { isDemo } from "./commsKit";
import { readSetting, useData } from "./data";


const latest: { settings: Row[]; saveSetting?: (key: string, value: unknown) => Promise<void> } = { settings: [] };
let adfinApi: AdfinApi | null = null;
let pending: string | undefined | null = null;
export function useAdfin(): AdfinApi {
  const { data, saveSetting } = useData();
  if (latest.settings !== data.settings) {
    latest.settings = data.settings;
    if (pending !== null && (readSetting<string>(data.settings, ADFIN_CONNECTION_KEY) || undefined) === (pending || undefined)) pending = null;
  }
  latest.saveSetting = saveSetting;
  if (!adfinApi) {
    const store = {
      read: () => (pending !== null ? pending : readSetting<string>(latest.settings, ADFIN_CONNECTION_KEY)) || undefined,
      write: async (s: string | undefined) => { pending = s ?? ""; await latest.saveSetting?.(ADFIN_CONNECTION_KEY, s ?? ""); },
    };
    adfinApi = isDemo() ? new FakeAdfin(store) : new HttpAdfin(getAccessToken, store);
  }
  return adfinApi;
}
export const useAdfinConnected = () => { const { data } = useData(); return !!readSetting<string>(data.settings, ADFIN_CONNECTION_KEY); };

/** Renews the connection about once a day while the app is open: Adfin drops a sign-in that has not been used for 5 days. */
export function AdfinKeepAlive() {
  const api = useAdfin();
  const connected = useAdfinConnected();
  useEffect(() => {
    if (!connected || isDemo()) return;
    try {
      const last = Number(localStorage.getItem("pp.adfin.keepalive") || 0);
      if (Date.now() - last < 20 * 3600 * 1000) return;
      localStorage.setItem("pp.adfin.keepalive", String(Date.now()));
    } catch { /* storage unavailable: renew anyway */ }
    void api.keepAlive().catch(() => undefined);
  }, [api, connected]);
  return null;
}

