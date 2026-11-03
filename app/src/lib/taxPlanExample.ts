// A made-up client for trying the tax planner and checking its answers: Example Trading Ltd, two directors on different classes of
// share, one with a part-time job elsewhere and a company car, one owed money on his loan account and wanting a set amount of cash.
// Nothing here is a real person or company.
import { PlanInput, blankPlan, newPerson, blankOther } from "./taxPlanning";

export const EXAMPLE_COMPANY = "Example Trading Ltd";
export function examplePlan(year = 2027): PlanInput {
  return {
    ...blankPlan(year, EXAMPLE_COMPANY), profit: 120000, reservesBf: 25000, associated: 0, aim: "target", dividendSplit: "classes",
    people: [
      newPerson("ex-alex", { name: "Alex Example", director: true, salaried: true, sharesPct: 100, shareClass: "A", targetTakeHome: 50000, loanBalance: 6000, employerPension: 10000, customSalary: 12570 }),
      newPerson("ex-sam", { name: "Sam Example", director: true, salaried: true, sharesPct: 100, shareClass: "B", targetTakeHome: 25000, bik: 3600, other: { ...blankOther(), nonSavings: 18000 }, customSalary: 12570 }),
    ],
  };
}
