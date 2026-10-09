// Backups: every Practice Planner list, read fresh from SharePoint, saved as one Excel file
// in your OneDrive (folder "Practice Planner Backups"). Each list is a sheet with every column.
import { Graph } from "./graph";
import { LISTS, ListKey, Row } from "./schema";
import { Cell, Sheet, XLSX_TYPE, workbook } from "./xlsx";

export const BACKUP_FOLDER = "Practice Planner Backups";

export type BackupRecord = {
  at: string; // when it finished (ISO)
  name?: string;
  webUrl?: string;
  folderUrl?: string;
  size?: number;
  rows?: number;
  auto?: boolean;
};
export type BackupFailure = { at: string; message: string };

const pad = (n: number) => String(n).padStart(2, "0");

/** "Practice Planner backup 2026-10-09 2246.xlsx" */
export function backupName(when: Date): string {
  return `Practice Planner backup ${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}${pad(when.getMinutes())}.xlsx`;
}

/** One sheet per list (named as in SharePoint, without "PP "), plus a contents sheet first. */
export function backupSheets(data: Partial<Record<ListKey, Row[]>>, when: Date): Sheet[] {
  const sheets: Sheet[] = [];
  const contents: Cell[][] = [["List", "Rows", "SharePoint list"]];
  for (const list of LISTS) {
    const rows = data[list.key] || [];
    const cols = ["Title", ...list.columns.map((c) => c.name), "Modified"];
    const sheetRows: Cell[][] = [cols];
    const sorted = [...rows].sort((a, b) => String(a.Key ?? "").localeCompare(String(b.Key ?? ""), undefined, { numeric: true }));
    for (const r of sorted) sheetRows.push(cols.map((c) => r[c] as Cell));
    const name = list.displayName.replace(/^PP /, "");
    sheets.push({ name, rows: sheetRows });
    contents.push([name, rows.length, list.displayName]);
  }
  contents.push([], ["Made", when.toLocaleString("en-GB")]);
  contents.push(["About", "A copy of every Practice Planner list. Your live data stays in SharePoint."]);
  return [{ name: "Contents", rows: contents }, ...sheets];
}

export async function buildBackup(data: Partial<Record<ListKey, Row[]>>, when = new Date()): Promise<{ bytes: Uint8Array; rows: number }> {
  const rows = Object.values(data).reduce((t, r) => t + (r?.length || 0), 0);
  return { bytes: await workbook(backupSheets(data, when), when), rows };
}

/** Upload to OneDrive. Folders in the path are created as needed. */
export async function uploadBackup(graph: Graph, bytes: Uint8Array, name: string): Promise<{ webUrl?: string; folderUrl?: string; size: number }> {
  const path = `/me/drive/root:/${encodeURIComponent(BACKUP_FOLDER)}/${encodeURIComponent(name)}:/content`;
  const item = await graph.put<{ webUrl?: string; size?: number }>(path, bytes, XLSX_TYPE);
  let folderUrl: string | undefined;
  try {
    folderUrl = (await graph.get<{ webUrl?: string }>(`/me/drive/root:/${encodeURIComponent(BACKUP_FOLDER)}`)).webUrl;
  } catch {
    /* the file link is enough */
  }
  return { webUrl: item.webUrl, folderUrl, size: item.size ?? bytes.byteLength };
}

/** True when the last good backup is older than `hours` (or there isn't one). */
export function backupDue(last: BackupRecord | undefined, now: Date, hours = 20): boolean {
  if (!last?.at) return true;
  return now.getTime() - Date.parse(last.at) > hours * 3600 * 1000;
}
