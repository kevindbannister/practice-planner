// Before V20.1 a Xama refresh wrote Xama's own assessment date into the client's next AML review date. Since then Xama's date has its own
// column (XamaAssessedOn), so a client whose review date is exactly Xama's date, with no planner assessment to set it, most likely had
// it overwritten. The tracker flags these so the right date can be put back.
import { Row } from "./schema";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
export function reviewDateSuspect(client: Row, source: string): boolean {
  const r = str(client.AMLReview), x = str(client.XamaAssessedOn);
  return source === "client record" && !!r && r === x;
}
