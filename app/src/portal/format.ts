const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A date from the practice's records for a client: "1997-05-08" becomes "8 May 1997"; a year end "10-31" becomes "31 October". Anything else is left alone. */
export function niceDate(v: string): string {
  const full = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (full) return `${Number(full[3])} ${MONTHS[Number(full[2]) - 1]} ${full[1]}`;
  const dm = /^(\d{2})-(\d{2})$/.exec(v);
  if (dm && Number(dm[1]) >= 1 && Number(dm[1]) <= 12) return `${Number(dm[2])} ${MONTHS[Number(dm[1]) - 1]}`;
  return v;
}

/** The business details with dates shown the way people read them. */
export function readable(d: Record<string, string>): Record<string, string> {
  return { ...d, incorporated: niceDate(d.incorporated || ""), yearEnd: niceDate(d.yearEnd || "") };
}
