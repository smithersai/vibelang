// The native loops over the same operands: TypeScript names the operand
// (TS18046, TS18048) or calls it an object (TS2571, TS2531).
declare const holder: { rows: unknown }
declare function load(): unknown
declare function maybe(): number[][] | null

async function named(rows: unknown) { for await (const row of rows) { void row } }
async function property() { for await (const row of holder.rows) { void row } }
async function called() { for await (const row of load()) { void row } }
function headNamed(rows: unknown) { for (const [row = 0] of rows) { void row } }
function headOptional(rows: number[][] | undefined) { for (const [row = 0] of rows) { void row } }
function headCalled() { for (const [row = 0] of maybe()) { void row } }
function headDo() { for (const row of (() => maybe())()) { void row } }
