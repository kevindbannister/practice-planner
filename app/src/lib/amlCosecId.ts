import { Row } from "./schema";
const str = (v: unknown): string => (v == null ? "" : String(v).trim());
export function cosecIdOf(r: Row): { id: "" | "verified" | "pending" | "exempt"; on: string } {
  const v = str(r.IdStatus);
  return { id: v === "verified" || v === "pending" || v === "exempt" ? v : "", on: str(r.IdCheckedOn).slice(0, 10) };
}
