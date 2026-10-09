// A colour for each family of work, used as a small swatch or stripe beside its name (the
// name is always shown, so colour is never the only clue). Seven colours in a fixed order,
// checked for colour-blind separation in light and dark; everything else is neutral grey.
const FAMILY: Record<string, number> = {
  ACCS_LTD: 1, ACCS_LLP: 1, SE_ACCOUNTS: 1, CHARITY_ACCOUNTS: 1, ACCS_OTHER_A: 1, ACCS_OTHER_B: 1, // accounts: blue
  SA100: 2, SA800: 2, CGT: 2, // personal tax: orange
  CS01: 3, DS01: 3, STRIKE_OFF: 3, NCSU: 3, // Companies House: aqua
  MGMT_ACCOUNTS: 4, BOOKKEEPING: 4, MYS: 4, // management and bookkeeping: yellow
  VAT: 5, // VAT: magenta
  PAYROLL: 6, CIS: 6, PAE: 6, // payroll: green
  CT600: 7, // corporation tax: violet
};

/** 1 to 7 for a coloured family of work, 0 for neutral. */
export function serviceSlot(serviceKey?: string): number {
  return FAMILY[serviceKey || ""] || 0;
}

/** Names for each colour, for legends. */
export const FAMILY_NAMES: Record<number, string> = {
  1: "Accounts", 2: "Personal tax", 3: "Companies House", 4: "Management and bookkeeping", 5: "VAT", 6: "Payroll and CIS",
  7: "Corporation tax", 0: "Other work and tasks",
};
export const FAMILY_ORDER = [1, 2, 3, 4, 5, 6, 7, 0];

/** Class name that sets --svc to the family's colour. */
export const svcClass = (serviceKey?: string) => `svc-${serviceSlot(serviceKey)}`;
