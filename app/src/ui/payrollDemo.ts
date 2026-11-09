// Whether Payroll talks to the fake RTI service (demo build). Apart from the Payroll screen so the app can set it without loading Payroll.
let demo = false;
export const setPayrollDemo = (v: boolean) => { demo = v; };
export const payrollDemo = () => demo;
