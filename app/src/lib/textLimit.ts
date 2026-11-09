// SharePoint stops saving a text column at about 64,000 characters. Refuse before that with a message people can act on,
// instead of a save that fails with a server error.
export const TEXT_LIMIT = 60000;
export function tooLong(list: string, values: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "string" && v.length > TEXT_LIMIT) throw new Error(`This is too long to save in SharePoint (${k} in ${list} would be ${v.length.toLocaleString("en-GB")} characters; the limit is about 60,000). Shorten it, or split it into separate records.`);
  }
}
