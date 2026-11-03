export type FormField = { kind: "money" | "tick" | "text" | "date"; rect: [number, number, number, number]; cells?: [number, number][]; dec?: number; sub?: string; value?: string };
export type FormBox = { id: string; n: string; section?: string; label: string; fields: FormField[] };
export type FormPageMap = { index: number; form: string; no: number; tr: number; w: number; h: number; boxes: FormBox[] };
export function pageCode(text: { s: string; x: number; y: number }[]): { form: string; no: number };
export function pageBoxes(page: unknown, number: number, OPS: unknown, read?: boolean): Promise<FormPageMap>;
export function readField(text: unknown[], f: FormField): string;
