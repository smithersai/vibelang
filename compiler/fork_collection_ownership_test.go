package compiler

import (
	"strings"
	"testing"
)

// TestPinnedForkReturnedCollectionChargesItsReceiver is the fork half of the
// must-consume container transfer.
//
// A `return` is not a discharge; it is a TRANSFER, and a transfer conserves the
// obligation only if the receiving side is charged for it. A Result or a started
// Promise is charged automatically at the caller's call site. A CONTAINER of
// them was charged nowhere, so moving Results into an array and returning it
// cancelled the obligation outright — `save(2)` could throw, the failure never
// reach the row, never be consumed, and the program exit 0 reporting success, on
// BOTH backends. `07-must-consume/array-length-is-not-consumption-of-a-result-collection`
// refuses the identical array one call away, which is what named the defect.
//
// Two coupled rules close it, and they are the same question asked at both ends
// of the transfer: heldObligation charges a call whose value is not itself a
// Result or a started Promise but still HOLDS one, and transferReachesCaller
// lets a `return` discharge a stored collection only when the enclosing
// function's return type still carries the channel.
//
// The NEGATIVE half below is the load-bearing one. In particular
// 07-must-consume/a-lifted-call-stored-into-a-plainly-typed-array-is-still-a-discard
// pins that a store transfers ownership only when the container's own type still
// carries the channel; the receiving rule asks that same question of the value a
// call hands back, so that case is unchanged.
func TestPinnedForkReturnedCollectionChargesItsReceiver(t *testing.T) {
	const prelude = `class Missing extends Error {}
function one(): Result<number, Missing> { throw new Missing("gone") }
`

	refused := []struct {
		name string
		body string
		want string
	}{
		{
			name: "an array of Results returned and read for its length",
			body: `function pack(): readonly Result<number, Missing>[] { return [one()] }
export function g(): number { const a = pack(); return a.length }`,
			want: "SMITHERS1301@4:41",
		},
		{
			name: "an object of Results returned and never read at all",
			body: `function hold(): { readonly r: Result<number, Missing> } { return { r: one() } }
export function g(): number { const b = hold(); return 0 }`,
			want: "SMITHERS1301@4:41",
		},
		{
			name: "a tuple of Results returned",
			body: `function pack(): readonly [Result<number, Missing>] { return [one()] }
export function g(): number { const t = pack(); return t.length }`,
			want: "SMITHERS1301@4:41",
		},
		{
			name: "a nested container of Results returned",
			body: `function pack(): readonly (readonly Result<number, Missing>[])[] { return [[one()]] }
export function g(): number { const n = pack(); return n.length }`,
			want: "SMITHERS1301@4:41",
		},
		{
			name: "a container returned through a ternary",
			body: `function pack(flag: boolean): readonly Result<number, Missing>[] { return flag ? [one()] : [] }
export function g(): number { const a = pack(true); return a.length }`,
			want: "SMITHERS1301@4:41",
		},
		{
			name: "an async function returning Promise<Result[]>, awaited and dropped",
			body: `async function pack(): Promise<readonly Result<number, Missing>[]> { return [one()] }
export async function g(): Promise<number> { const a = await pack(); return a.length }`,
			want: "SMITHERS1301@4:62",
		},
		{
			name: "an arrow with an inferred container return type",
			body: `const pack = () => [one()]
export function g(): number { const a = pack(); return a.length }`,
			want: "SMITHERS1301@4:41",
		},
		{
			name: "a container returned from a callback and dropped",
			body: `export function g(): number { return [1].map(() => [one()]).length }`,
			want: "SMITHERS1301@3:38",
		},
		{
			name: "a container laundered through a return type that cannot carry the channel",
			body: `function pack(): unknown { return [one()] }
export function g(): number { const a = pack(); return 0 }`,
			want: "SMITHERS1301@3:36",
		},
		{
			name: "a container bound inside the callee and then returned",
			body: `function pack(): readonly Result<number, Missing>[] { const arr = [one()]; return arr }
export function g(): number { const a = pack(); return a.length }`,
			want: "SMITHERS1301@4:41",
		},
		{
			name: "a returned container iterated with for-of",
			body: `function pack(): readonly Result<number, Missing>[] { return [one()] }
export function g(): number { let n = 0; for (const r of pack()) { n += 1 } return n }`,
			want: "SMITHERS1301@4:58",
		},
		{
			name: "a returned container discarded as a statement",
			body: `function pack(): readonly Result<number, Missing>[] { return [one()] }
export function g(): number { pack(); return 0 }`,
			want: "SMITHERS1301@4:31",
		},
		{
			name: "a container returned from an object method",
			body: `const api = { pack(): readonly Result<number, Missing>[] { return [one()] } }
export function g(): number { const a = api.pack(); return a.length }`,
			want: "SMITHERS1301@4:41",
		},
		{
			name: "a container returned through an as-cast",
			body: `function pack(): readonly Result<number, Missing>[] { return [one()] as readonly Result<number, Missing>[] }
export function g(): number { const a = pack(); return a.length }`,
			want: "SMITHERS1301@4:41",
		},
	}
	for _, testCase := range refused {
		t.Run(testCase.name, func(t *testing.T) {
			files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: prelude + testCase.body + "\n"}}
			got := strings.Join(formatDiagnosticPositions(t, files, compileInternalSource(t, files)), " ")
			if !strings.Contains(got, testCase.want) {
				t.Fatalf("diagnostics = %s, want it to contain %s", got, testCase.want)
			}
		})
	}

	t.Run("a returned collection of started Promises is a 1402, not a 1301", func(t *testing.T) {
		authored := `async function work(): Promise<number> { return 1 }
function starts(): readonly Promise<number>[] { return [work()] }
export function g(): number { const ps = starts(); return ps.length }
`
		files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: authored}}
		got := strings.Join(formatDiagnosticPositions(t, files, compileInternalSource(t, files)), " ")
		if got != "SMITHERS1402@3:42" {
			t.Fatalf("diagnostics = %s, want SMITHERS1402@3:42", got)
		}
	})
}

// TestPinnedForkCollectionOwnershipIsNotWidened is the acceptance half. Six
// over-corrections have shipped in this repository; a rule that charges a
// receiver is one wrong step away from refusing every program that uses a
// collection at all.
func TestPinnedForkCollectionOwnershipIsNotWidened(t *testing.T) {
	const prelude = `class Missing extends Error {}
function one(): Result<number, Missing> { throw new Missing("gone") }
`
	accepted := []struct {
		name string
		body string
	}{
		{
			// Exactly what `export function f(): Result<A, E> { return one() }` is:
			// the obligation leaves for a caller this file does not contain.
			name: "a returned collection with no caller is an ordinary transfer",
			body: `export function pack(): readonly Result<number, Missing>[] { return [one()] }`,
		},
		{
			name: "handing the collection to Result.all discharges it",
			body: `function pack(): readonly Result<number, Missing>[] { return [one()] }
export function g(): Result<readonly number[], Missing> { return Result.all(pack()) }`,
		},
		{
			name: "reading an element back out with postfix ! discharges it",
			body: `function pack(): readonly Result<number, Missing>[] { return [one()] }
export function g(): Result<number, Missing> { const a = pack(); return a[0]! }`,
		},
		{
			name: "indexing the call directly with postfix ! discharges it",
			body: `function pack(): readonly Result<number, Missing>[] { return [one()] }
export function g(): Result<number, Missing> { return pack()[0]! }`,
		},
		{
			name: "awaiting the async collection and collecting it discharges it",
			body: `async function pack(): Promise<readonly Result<number, Missing>[]> { return [one()] }
export async function g(): Promise<Result<readonly number[], Missing>> {
  const a = await pack()
  return Result.all(a)
}`,
		},
		{
			name: "an object of Results returned across a boundary is consumed by its property",
			body: `function hold(): { found: Result<number, Missing> } { return { found: one() } }
export function g(): Result<number, Missing> { const bag = hold(); return bag.found! }`,
		},
		{
			name: "Result.all over a bound array is still the ordinary spelling",
			body: `export function g(): Result<readonly number[], Missing> {
  const arr = [one(), one()]
  return Result.all(arr)
}`,
		},
	}
	for _, testCase := range accepted {
		t.Run(testCase.name, func(t *testing.T) {
			files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: prelude + testCase.body + "\n"}}
			got := formatDiagnosticPositions(t, files, compileInternalSource(t, files))
			if len(got) != 0 {
				t.Fatalf("diagnostics = %v, want none", got)
			}
		})
	}

	t.Run("a recognized Promise combinator owns what it hands back", func(t *testing.T) {
		// 07-must-consume/the-ambient-promise-all-discharges-a-bound-promise is
		// the corpus twin: collectionConsumed already defines a recognized
		// combinator as owning everything handed to it, so its product is the
		// consumed one and charging it would refuse that pinned program.
		authored := `async function work(): Promise<number> { return 1 }
function starts(): readonly Promise<number>[] { return [work()] }
export async function g(): Promise<number> {
  const ps = starts()
  const all = await Promise.all(ps)
  return all.length
}
`
		files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: authored}}
		if got := formatDiagnosticPositions(t, files, compileInternalSource(t, files)); len(got) != 0 {
			t.Fatalf("diagnostics = %v, want none", got)
		}
	})

	t.Run("a container with no must-consume channel in it is untouched", func(t *testing.T) {
		authored := `function two(): number { return 2 }
function pack(): readonly number[] { return [two()] }
export function g(): number { const a = pack(); return a.length }
`
		files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: authored}}
		if got := formatDiagnosticPositions(t, files, compileInternalSource(t, files)); len(got) != 0 {
			t.Fatalf("diagnostics = %v, want none", got)
		}
	})

	t.Run("a lifted call stored into a plainly typed array is still charged at the element", func(t *testing.T) {
		// 07-must-consume/a-lifted-call-stored-into-a-plainly-typed-array-is-still-a-discard.
		// `risky` is inferred `Result<number, Missing>` while its declaration says
		// `number`, so the array's own type is `number[]`, the store is a fiction,
		// and `main()` hands back a `number[]` that carries no channel — the
		// receiving rule must charge nothing at the call and everything at the
		// element, exactly as before it existed.
		authored := `class Missing extends Error {}
function risky(key: string) {
  if (key !== "ada") throw new Missing()
  return 1
}
export function main(): number[] {
  return [risky("ada")]
}
`
		files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: authored}}
		got := strings.Join(formatDiagnosticPositions(t, files, compileInternalSource(t, files)), " ")
		if got != "SMITHERS1301@7:11" {
			t.Fatalf("diagnostics = %s, want the single element discard SMITHERS1301@7:11", got)
		}
	})
}

// TestPinnedForkForeignPropertyReadAsksTheReceiver closes the fork's property
// rule fail-open recorded as
// 09-foreign-calls/a-foreign-index-signature-read-is-refused-on-one-backend-only.
//
// The rule stated in its own comment that "the RECEIVER's value provenance is
// the rule, not the property's declaring file" and then contradicted itself with
// a second gate that walked the MEMBER's declarations. An index-signature member
// has none, an empty declaration list is not evidence of a trust claim, and the
// fork compiled, ran and exited 0 on a program the reference refuses. The
// declaring file was never the question either: nothing stops a foreign object
// from serving `length` or `toString` from a throwing getter.
//
// Asking the receiver one question makes the answer total over the spellings.
// Every row below reports the SAME code at the SAME position as the reference.
func TestPinnedForkForeignPropertyReadAsksTheReceiver(t *testing.T) {
	const foreign = `/**
 * @module
 * @throws {never}
 */
export const keyed: Record<string, number> = { k: 1 };
export const listed: number[] = [1, 2, 3];
export const declaredMember: { value: number } = { value: 7 };
export const nested: { inner: Record<string, number> } = { inner: { k: 2 } };
export interface Shape { readonly tag: string }
`
	refused := []struct {
		name string
		body string
		want string
	}{
		{"an index-signature read, dotted", `export function g(): number { return keyed.k }`, "SMITHERS1506@2:38"},
		{"an index-signature read, element access", `export function g(): number { return keyed["k"] }`, "SMITHERS1506@2:38"},
		{"an index-signature read with a computed key", `export function g(name: string): number { return keyed[name] }`, "SMITHERS1506@2:50"},
		{"a numeric index read off a foreign array", `export function g(): number { return listed[0] }`, "SMITHERS1506@2:38"},
		{"a library-declared member off a foreign value", `export function g(): number { return listed.length }`, "SMITHERS1506@2:38"},
		{"a declared member, element-access spelling", `export function g(): number { return declaredMember["value"] }`, "SMITHERS1506@2:38"},
		{"a write through an index signature", `export function g(): number { keyed.k = 2; return 0 }`, "SMITHERS1506@2:31"},
		{"an optional-chained index-signature read", `export function g(): number { return keyed?.k }`, "SMITHERS1506@2:38"},
		{"destructuring a foreign value", `export function g(): number { const { k } = keyed; return k }`, "SMITHERS1506@2:37"},
	}
	for _, testCase := range refused {
		t.Run(testCase.name, func(t *testing.T) {
			authored := "import { keyed, listed, declaredMember } from \"./foreign.ts\"\n" + testCase.body + "\n"
			files := []SourceFile{
				{Path: "main.sm", Kind: FileKindSmithers, Text: authored},
				{Path: "foreign.ts", Kind: FileKindTypeScript, Text: foreign},
			}
			got := strings.Join(formatDiagnosticPositions(t, files, compileInternalSource(t, files)), " ")
			if !strings.Contains(got, testCase.want) {
				t.Fatalf("diagnostics = %s, want it to contain %s", got, testCase.want)
			}
		})
	}

	t.Run("a chained foreign read reports once, as the reference does", func(t *testing.T) {
		// `nested.inner.k` is two foreign property reads and both begin at
		// `nested`, so both render identically. The reference collapses that in
		// finalizeDiagnostics; without the same collapse here the two backends
		// disagree on a program neither of them is wrong about.
		authored := `import { nested } from "./foreign.ts"
export function g(): number {
  return nested.inner.k
}
`
		files := []SourceFile{
			{Path: "main.sm", Kind: FileKindSmithers, Text: authored},
			{Path: "foreign.ts", Kind: FileKindTypeScript, Text: foreign},
		}
		got := strings.Join(formatDiagnosticPositions(t, files, compileInternalSource(t, files)), " ")
		if got != "SMITHERS1506@3:10" {
			t.Fatalf("diagnostics = %s, want exactly one SMITHERS1506@3:10", got)
		}
	})

	t.Run("an authored record is not a foreign read", func(t *testing.T) {
		authored := `export function g(): number { const local: Record<string, number> = { k: 1 }; return local.k }
`
		files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: authored}}
		if got := formatDiagnosticPositions(t, files, compileInternalSource(t, files)); len(got) != 0 {
			t.Fatalf("diagnostics = %v, want none", got)
		}
	})

	t.Run("a parameter typed by a foreign interface holds an authored value", func(t *testing.T) {
		// specification/compatibility.mdx, "Runtime TypeScript Dependency":
		// "A type-only import MUST NOT add that requirement."
		authored := `import type { Shape } from "./foreign.ts"
export function g(s: Shape): string { return s.tag }
`
		files := []SourceFile{
			{Path: "main.sm", Kind: FileKindSmithers, Text: authored},
			{Path: "foreign.ts", Kind: FileKindTypeScript, Text: foreign},
		}
		if got := formatDiagnosticPositions(t, files, compileInternalSource(t, files)); len(got) != 0 {
			t.Fatalf("diagnostics = %v, want none", got)
		}
	})
}
