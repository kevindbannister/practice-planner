// Opens the side panel when the toolbar icon is clicked, and keeps the icon's badge showing a running timer.
const setup = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(() => { setup(); chrome.alarms.create("badge", { periodInMinutes: 1 }); badge(); });
chrome.runtime.onStartup.addListener(() => { setup(); chrome.alarms.create("badge", { periodInMinutes: 1 }); badge(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "badge") badge(); });
chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.running) badge(); });

async function badge() {
  const { running } = await chrome.storage.local.get("running");
  if (!running || !running.started) {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "XProFlow jobs and timer" });
    return;
  }
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(running.started)) / 60000));
  const text = mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}` : `${mins}m`;
  await chrome.action.setBadgeBackgroundColor({ color: "#0c83b2" });
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title: `Timer running: ${running.label || "a job"} (${text})` });
}
