// UK income tax, National Insurance, student loan, Child Benefit and Capital Gains Tax figures for each tax year the Tax
// section handles. Sources (checked 3 November 2026): GOV.UK "Income Tax rates and allowances for current and previous tax
// years", GOV.UK "Rates and allowances: National Insurance contributions", gov.scot "Scottish Income Tax: rates and bands",
// student loan thresholds as published for employers, Child Benefit uprating, CGT rates (including the 30 October 2024
// change). A year is named by the calendar year it ends in: 2026 means 6 April 2025 to 5 April 2026.

export type Region = "england" | "scotland" | "wales";
export type Band = { upTo: number; rate: number; name: string }; // upTo is in taxable income after allowances; Infinity for the last

export type YearRates = {
  year: number; label: string;
  personalAllowance: number; taperFrom: number; marriageAllowance: number; blindAllowance: number;
  /** England, Wales, Northern Ireland: basic, higher, additional (also the bands for savings and dividends everywhere) */
  uk: Band[];
  scotland: Band[];
  savingsStartingBand: number; psaBasic: number; psaHigher: number;
  dividendAllowance: number; dividendRates: [number, number, number];
  class2Weekly: number; smallProfitsThreshold: number; class2Compulsory: boolean;
  /** profits from which compulsory Class 2 is due (to 2021-22 the Small Profits Threshold; from 2022-23 the Lower Profits Limit, which is the default) */
  class2From?: number;
  class4Lower: number; class4Upper: number; class4Main: number; class4Additional: number;
  studentLoan: { plan1: number; plan2: number; plan4: number; plan5?: number; postgrad: number };
  childBenefit: { eldest: number; other: number }; // weekly
  hicbc: { from: number; per1pc: number };
  cgt: { exempt: number; basic: number; higher: number; resBasic: number; resHigher: number; badr: number;
    /** 2024-25 only: rates for disposals before 30 October 2024 */ early?: { basic: number; higher: number } };
  poaThreshold: number; poaSourcePc: number;
  propertyAllowance: number; tradingAllowance: number;
  /** EIS, SEIS, VCT relief as a share of the amount invested */
  eis: number; seis: number; vct: number;
};

const ukBands = (): Band[] => [
  { upTo: 37700, rate: 0.2, name: "Basic rate" },
  { upTo: 125140, rate: 0.4, name: "Higher rate" },
  { upTo: Infinity, rate: 0.45, name: "Additional rate" },
];
/** Before 2023-24 the additional rate started at £150,000 (and the basic rate band was £37,500 to 2020-21). */
const ukOld = (basic: number): Band[] => [
  { upTo: basic, rate: 0.2, name: "Basic rate" },
  { upTo: 150000, rate: 0.4, name: "Higher rate" },
  { upTo: Infinity, rate: 0.45, name: "Additional rate" },
];
/** Scotland to 2022-23: starter, basic, intermediate, higher 41% to £150,000, top 46%. */
const scotOld = (starter: number, basic: number, intermediate: number): Band[] => [
  { upTo: starter, rate: 0.19, name: "Starter rate" }, { upTo: basic, rate: 0.2, name: "Basic rate" }, { upTo: intermediate, rate: 0.21, name: "Intermediate rate" },
  { upTo: 150000, rate: 0.41, name: "Higher rate" }, { upTo: Infinity, rate: 0.46, name: "Top rate" },
];
const scot = (starter: number, basic: number, intermediate: number, higher: number, advanced: number | null, top: number): Band[] => [
  { upTo: starter, rate: 0.19, name: "Starter rate" },
  { upTo: basic, rate: 0.2, name: "Basic rate" },
  { upTo: intermediate, rate: 0.21, name: "Intermediate rate" },
  ...(advanced === null
    ? [{ upTo: Infinity, rate: higher, name: "Higher rate" }]
    : [{ upTo: advanced, rate: 0.42, name: "Higher rate" }, { upTo: 125140, rate: 0.45, name: "Advanced rate" }, { upTo: Infinity, rate: top, name: "Top rate" }]),
];

const base = {
  personalAllowance: 12570, taperFrom: 100000, marriageAllowance: 1260, savingsStartingBand: 5000, psaBasic: 1000, psaHigher: 500,
  class4Lower: 12570, class4Upper: 50270, class4Additional: 0.02, poaThreshold: 1000, poaSourcePc: 0.8, propertyAllowance: 1000, tradingAllowance: 1000,
  eis: 0.3, seis: 0.5, vct: 0.3,
};

export const YEARS: YearRates[] = [
  // Past years, for returns made late, amended or brought in from IRIS. Class 2 was compulsory on profits from the Small Profits
  // Threshold until 2021-22; in 2022-23 profits between that and the Lower Profits Limit were treated as paid, and the Class 4
  // main rate averaged 9.73% (10.25% to 5 November 2022, then 9%).
  {
    ...base, year: 2020, label: "2019-20", personalAllowance: 12500, marriageAllowance: 1250, blindAllowance: 2450, uk: ukOld(37500), scotland: scotOld(2049, 12444, 30930),
    dividendAllowance: 2000, dividendRates: [0.075, 0.325, 0.381],
    class2Weekly: 3.0, smallProfitsThreshold: 6365, class2Compulsory: true, class2From: 6365, class4Lower: 8632, class4Upper: 50000, class4Main: 0.09,
    studentLoan: { plan1: 18935, plan2: 25725, plan4: 18935, postgrad: 21000 },
    childBenefit: { eldest: 20.7, other: 13.7 }, hicbc: { from: 50000, per1pc: 100 },
    cgt: { exempt: 12000, basic: 0.1, higher: 0.2, resBasic: 0.18, resHigher: 0.28, badr: 0.1 },
  },
  {
    ...base, year: 2021, label: "2020-21", personalAllowance: 12500, marriageAllowance: 1250, blindAllowance: 2500, uk: ukOld(37500), scotland: scotOld(2085, 12658, 30930),
    dividendAllowance: 2000, dividendRates: [0.075, 0.325, 0.381],
    class2Weekly: 3.05, smallProfitsThreshold: 6475, class2Compulsory: true, class2From: 6475, class4Lower: 9500, class4Upper: 50000, class4Main: 0.09,
    studentLoan: { plan1: 19390, plan2: 26575, plan4: 19390, postgrad: 21000 },
    childBenefit: { eldest: 21.05, other: 13.95 }, hicbc: { from: 50000, per1pc: 100 },
    cgt: { exempt: 12300, basic: 0.1, higher: 0.2, resBasic: 0.18, resHigher: 0.28, badr: 0.1 },
  },
  {
    ...base, year: 2022, label: "2021-22", blindAllowance: 2520, uk: ukOld(37700), scotland: scotOld(2097, 12726, 31092),
    dividendAllowance: 2000, dividendRates: [0.075, 0.325, 0.381],
    class2Weekly: 3.05, smallProfitsThreshold: 6515, class2Compulsory: true, class2From: 6515, class4Lower: 9568, class4Main: 0.09,
    studentLoan: { plan1: 19895, plan2: 27295, plan4: 25000, postgrad: 21000 },
    childBenefit: { eldest: 21.15, other: 14.0 }, hicbc: { from: 50000, per1pc: 100 },
    cgt: { exempt: 12300, basic: 0.1, higher: 0.2, resBasic: 0.18, resHigher: 0.28, badr: 0.1 },
  },
  {
    ...base, year: 2023, label: "2022-23", blindAllowance: 2600, uk: ukOld(37700), scotland: scotOld(2162, 13118, 31092),
    dividendAllowance: 2000, dividendRates: [0.0875, 0.3375, 0.3935],
    class2Weekly: 3.15, smallProfitsThreshold: 6725, class2Compulsory: true, class4Lower: 11908, class4Main: 0.0973, class4Additional: 0.0273,
    studentLoan: { plan1: 20195, plan2: 27295, plan4: 25375, postgrad: 21000 },
    childBenefit: { eldest: 21.8, other: 14.45 }, hicbc: { from: 50000, per1pc: 100 },
    cgt: { exempt: 12300, basic: 0.1, higher: 0.2, resBasic: 0.18, resHigher: 0.28, badr: 0.1 },
  },
  {
    ...base, year: 2024, label: "2023-24", blindAllowance: 2870, uk: ukBands(),
    // 2023-24 Scotland: starter to 2,162, basic to 13,118, intermediate to 31,092, higher 42% to 125,140, top 47%
    scotland: [{ upTo: 2162, rate: 0.19, name: "Starter rate" }, { upTo: 13118, rate: 0.2, name: "Basic rate" }, { upTo: 31092, rate: 0.21, name: "Intermediate rate" }, { upTo: 125140, rate: 0.42, name: "Higher rate" }, { upTo: Infinity, rate: 0.47, name: "Top rate" }],
    dividendAllowance: 1000, dividendRates: [0.0875, 0.3375, 0.3935],
    class2Weekly: 3.45, smallProfitsThreshold: 6725, class2Compulsory: true, class4Main: 0.09,
    studentLoan: { plan1: 22015, plan2: 27295, plan4: 27660, postgrad: 21000 },
    childBenefit: { eldest: 24.0, other: 15.9 }, hicbc: { from: 50000, per1pc: 100 },
    cgt: { exempt: 6000, basic: 0.1, higher: 0.2, resBasic: 0.18, resHigher: 0.28, badr: 0.1 },
  },
  {
    ...base, year: 2025, label: "2024-25", blindAllowance: 3070, uk: ukBands(), scotland: scot(2306, 13991, 31092, 0.42, 62430, 0.48),
    dividendAllowance: 500, dividendRates: [0.0875, 0.3375, 0.3935],
    class2Weekly: 3.45, smallProfitsThreshold: 6725, class2Compulsory: false, class4Main: 0.06,
    studentLoan: { plan1: 24990, plan2: 27295, plan4: 31395, postgrad: 21000 },
    childBenefit: { eldest: 25.6, other: 16.95 }, hicbc: { from: 60000, per1pc: 200 },
    cgt: { exempt: 3000, basic: 0.18, higher: 0.24, resBasic: 0.18, resHigher: 0.24, badr: 0.1, early: { basic: 0.1, higher: 0.2 } },
  },
  {
    ...base, year: 2026, label: "2025-26", blindAllowance: 3130, uk: ukBands(), scotland: scot(2827, 14921, 31092, 0.42, 62430, 0.48),
    dividendAllowance: 500, dividendRates: [0.0875, 0.3375, 0.3935],
    class2Weekly: 3.5, smallProfitsThreshold: 6845, class2Compulsory: false, class4Main: 0.06,
    studentLoan: { plan1: 26065, plan2: 28470, plan4: 32745, postgrad: 21000 },
    childBenefit: { eldest: 26.05, other: 17.25 }, hicbc: { from: 60000, per1pc: 200 },
    cgt: { exempt: 3000, basic: 0.18, higher: 0.24, resBasic: 0.18, resHigher: 0.24, badr: 0.14 },
  },
  {
    ...base, year: 2027, label: "2026-27", blindAllowance: 3250, uk: ukBands(), scotland: scot(3967, 16956, 31092, 0.42, 62430, 0.48),
    dividendAllowance: 500, dividendRates: [0.1075, 0.3575, 0.3935],
    class2Weekly: 3.65, smallProfitsThreshold: 7105, class2Compulsory: false, class4Main: 0.06,
    studentLoan: { plan1: 26900, plan2: 29385, plan4: 33795, plan5: 25000, postgrad: 21000 },
    childBenefit: { eldest: 27.05, other: 17.9 }, hicbc: { from: 60000, per1pc: 200 },
    cgt: { exempt: 3000, basic: 0.18, higher: 0.24, resBasic: 0.18, resHigher: 0.24, badr: 0.18 },
  },
];

export const ratesFor = (year: number): YearRates => YEARS.find((y) => y.year === year) || YEARS[YEARS.length - 1];
export const yearLabel = (year: number) => `${year - 1}-${String(year).slice(2)}`;
/** The tax year end date for a year, as the app keeps periods (yyyy-04-05). */
export const yearEnd = (year: number) => `${year}-04-05`;
/** The tax year a date falls in. */
export const yearOf = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); const y = d.getUTCFullYear(); return d.getUTCMonth() > 3 || (d.getUTCMonth() === 3 && d.getUTCDate() >= 6) ? y + 1 : y; };
