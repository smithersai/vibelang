package compiler

import (
	"context"
	"sort"
	"strings"
	"testing"
)

// Coercion to a primitive, on the Go fork, is an ordinary call the program never
// spells — and the row it carries had never been charged.
//
// `implicitInvocations` (lowering.go) is the AUTHORED half of the question
// `implicitInvocationProtocol` (hostrules.go) answers for FOREIGN values: which
// checked function does this POSITION run? The predicate was already total over
// the grammar. The authored half kept its own two-entry list — a template span
// and binary `+` — and charged only `Symbol.toPrimitive` and `toString`, never
// `valueOf`.
//
// The consequence, measured on this backend before the fix. Each of these
// checked `ok: true` with `requirements: []` and panicked at run time with
// `capability 'Db' was not provided`:
//
//	+obj  -obj  ~obj  obj - 1  obj < 1  obj == 1  obj & 1  n += obj  s += obj
//	Number(obj)  Math.abs(obj)  table[obj]  obj in table  { [obj]: 1 }
//	{ ...box }  const { ...rest } = box  x instanceof matcher
//	"v " + obj   (the ONE site the old list did cover — it charged `toString`
//	              and the `+` operator reaches `valueOf`)
//
// The fix is that this half now ASKS `implicitInvocationProtocol` and branches
// on its answer; the two enumerated sites were deleted, not kept beside it. A
// table taught to one walk and not its sibling is the defect that keeps
// reopening in this file — `valueBranches` records the same story in its own
// words — so the tests below are written as an EQUALITY against the spelling
// that always worked (`obj.valueOf()`), not as a per-operator code list. A
// position is covered because the predicate classifies it, not because someone
// remembered it.
//
// Three things the walk must get exactly right, each measured against the
// emitted program's own behaviour rather than argued:
//
//   - It is `OrdinaryToPrimitive`, not "charge all three members". An object
//     whose only capability-reading member is `valueOf`, interpolated as
//     `${obj}`, prints `[object Object]` and never reads the capability;
//     charging it would refuse a program that runs.
//   - It is not "charge the member the hint names" either. `Object.prototype.valueOf`
//     returns the object itself, so a NUMBER hint over a `toString`-only object
//     really does run `toString`; and a project may declare `toString(): object`,
//     which TypeScript accepts, and then a STRING hint falls through into
//     `valueOf`.
//   - `instanceof` is in the position table because it invokes a member with no
//     call expression to see — but the member is `Symbol.hasInstance`, not the
//     coercion walk. Running the walk there refuses a program that runs.
//
// Mirrors implicitInvocations and coercionStopsAt in
// poc/src/language/semantic.ts, and poc/src/language/coercion-rows.test.ts.

// coercionSeam declares the capability and every member shape the walk has to
// tell apart. It is a separate module so the members are ordinary cross-module
// checked functions, exactly as an authored program would have them.
const coercionSeam = "seam.mod.sm\x00" + `import { Context } from "smthrs/context"

export abstract class Db extends Context {
  abstract read(): string
}

/** valueOf reads the capability; toString does not exist. */
export const numeric = { valueOf(): number { return Db.context().read().length } }

/** toString reads the capability; valueOf does not exist. */
export const stringy = { toString(): string { return Db.context().read() } }

/** Symbol.toPrimitive shadows both of the others. */
export const exotic = {
  [Symbol.toPrimitive](hint: string): number { return Db.context().read().length },
  valueOf(): number { return 0 },
  toString(): string { return "" },
}

/** A toString TypeScript accepts that does not answer, so a string hint falls through. */
export const fallsThrough = {
  toString(): object { return {} },
  valueOf(): number { return Db.context().read().length },
}

/** An OWN enumerable getter: an object spread runs it. */
export const boxed = { get size(): number { return Db.context().read().length } }

/** A PROTOTYPE getter: an object spread does NOT run it. */
export class Prototyped {
  get size(): number { return Db.context().read().length }
}

/** Symbol.hasInstance is the only member instanceof runs. */
export const matcher = {
  [Symbol.hasInstance](value: unknown): boolean { return Db.context().read().length > 0 },
}

/** A static toString instanceof never runs. */
export class Named {
  static toString(): string { return Db.context().read() }
}
`

// coercionPositions are the spellings whose evaluation runs a member of the
// value. Each returns a module body; `%s` is not used because several need a
// statement of their own. Every one of them must reach the same verdict as
// `numeric.valueOf()`, because every one of them runs exactly that.
var coercionPositions = []struct {
	name string
	body string
}{
	{"an explicit call — the control", "const v = numeric.valueOf()\n"},
	{"unary plus", "const v = +numeric\n"},
	{"unary minus", "const v = -numeric\n"},
	{"bitwise not", "const v = ~numeric\n"},
	{"subtraction", "const v = (numeric as unknown as number) - 1\n"},
	{"subtraction, value on the right", "const v = 1 - (numeric as unknown as number)\n"},
	{"multiplication", "const v = (numeric as unknown as number) * 2\n"},
	{"division", "const v = (numeric as unknown as number) / 2\n"},
	{"remainder", "const v = (numeric as unknown as number) % 2\n"},
	{"exponentiation", "const v = (numeric as unknown as number) ** 2\n"},
	{"less than", "const v = (numeric as unknown as number) < 1\n"},
	{"greater than or equal", "const v = (numeric as unknown as number) >= 1\n"},
	{"bitwise and", "const v = (numeric as unknown as number) & 1\n"},
	{"bitwise or", "const v = (numeric as unknown as number) | 1\n"},
	{"bitwise xor", "const v = (numeric as unknown as number) ^ 1\n"},
	{"left shift", "const v = (numeric as unknown as number) << 1\n"},
	{"unsigned right shift", "const v = (numeric as unknown as number) >>> 1\n"},
	{"loose equality", "const v = (numeric as unknown as number) == 1\n"},
	{"loose inequality", "const v = (numeric as unknown as number) != 1\n"},
	{"addition", "const v = (numeric as unknown as number) + 1\n"},
	{"string concatenation reaches valueOf, not toString", "const v = \"n \" + (numeric as unknown as number)\n"},
	{"an addition assignment", "let n = 0\nn += numeric as unknown as number\nconst v = n\n"},
	{"a subtraction assignment", "let n = 0\nn -= numeric as unknown as number\nconst v = n\n"},
	{"a shift assignment", "let n = 1\nn <<= numeric as unknown as number\nconst v = n\n"},
	{"Number", "const v = Number(numeric)\n"},
	{"Math.abs", "const v = Math.abs(numeric as unknown as number)\n"},
	{"Math.max, second argument", "const v = Math.max(0, numeric as unknown as number)\n"},
	{"parentheses", "const v = +(numeric)\n"},
	{"a type assertion", "const v = +(numeric as unknown as number)\n"},
	{"a satisfies expression", "const v = +(numeric satisfies { valueOf(): number })\n"},
	{"an alias", "const held = numeric\nconst v = +held\n"},
	{"a property of an object literal", "const holder = { inner: numeric }\nconst v = +holder.inner\n"},
	{"a ternary", "const v = +(true ? numeric : numeric)\n"},
	{"a nested prefix operator", "const v = -(-numeric)\n"},
}

// coercionStringPositions are the four positions that ask for a STRING. They
// take `stringy`, whose only capability-reading member is `toString`.
var coercionStringPositions = []struct {
	name string
	body string
}{
	{"an explicit call — the control", "const v = stringy.toString()\n"},
	{"template interpolation", "const v = `x${stringy}`\n"},
	{"String", "const v = String(stringy)\n"},
	{"an element access key", "const table: Record<string, number> = { a: 1 }\nconst v = table[stringy as unknown as string]\n"},
	{"an element access key, written", "const table: Record<string, number> = { a: 1 }\ntable[stringy as unknown as string] = 1\nconst v = table.a\n"},
	{"an object-literal computed key", "const shape = { [stringy as unknown as string]: 1 }\nconst v = shape.a\n"},
	{"the in operator", "const table: Record<string, number> = { a: 1 }\nconst v = (stringy as unknown as string) in table\n"},
	{"an optional element access", "const table: Record<string, number> | undefined = { a: 1 }\nconst v = table?.[stringy as unknown as string]\n"},
	{"a delete of a computed key", "const table: Record<string, number> = { a: 1 }\ndelete table[stringy as unknown as string]\nconst v = 1\n"},
}

func coercionModule(body string, imports string) string {
	return "import { " + imports + " } from \"./seam.mod.sm\"\n" +
		body +
		"export function main(): string[] {\n  return [`${v}`]\n}\n"
}

// coercionCodes compiles one module against the seam and returns its distinct
// diagnostic codes. Codes and not positions: every spelling in the tables above
// necessarily moves the column, so only the codes compare across spellings.
func coercionCodes(t *testing.T, backend Compiler, ctx context.Context, source string) []string {
	t.Helper()
	name, text, _ := strings.Cut(coercionSeam, "\x00")
	files := []SourceFile{
		{Path: "main.sm", Kind: FileKindSmithers, Text: source},
		{Path: name, Kind: FileKindSmithers, Text: text},
	}
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.sm", name},
		Files:     files,
		Options:   Options{},
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	seen := make(map[string]bool)
	for _, position := range formatDiagnosticPositions(t, files, result) {
		code, _, _ := strings.Cut(position, "@")
		seen[code] = true
	}
	codes := make([]string, 0, len(seen))
	for code := range seen {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	return codes
}

// TestPinnedForkCoercionPositionAnswersLikeTheExplicitCall is the ONE TABLE
// assertion. It is an equality against `obj.valueOf()` rather than a
// per-operator code list on purpose: the property being pinned is that a
// coercion POSITION is an ordinary call, not that `+obj` happens to report
// SMITHERS2102 today.
func TestPinnedForkCoercionPositionAnswersLikeTheExplicitCall(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, table := range []struct {
		hint      string
		imports   string
		positions []struct {
			name string
			body string
		}
	}{
		{"number hint", "numeric", coercionPositions},
		{"string hint", "stringy", coercionStringPositions},
	} {
		t.Run(table.hint, func(t *testing.T) {
			control := coercionCodes(t, backend, ctx, coercionModule(table.positions[0].body, table.imports))
			found := false
			for _, code := range control {
				if code == "SMITHERS2102" {
					found = true
				}
			}
			if !found {
				t.Fatalf("the explicit-call control must already report SMITHERS2102, but reported %v; "+
					"an accepting baseline would make every equality below vacuous", control)
			}
			for _, position := range table.positions[1:] {
				t.Run(position.name, func(t *testing.T) {
					got := coercionCodes(t, backend, ctx, coercionModule(position.body, table.imports))
					if strings.Join(got, " ") != strings.Join(control, " ") {
						t.Fatalf("%s answers %v; the explicit call `%s.valueOf()`/`.toString()` answers %v — "+
							"a coercion position runs exactly that member, so the two must be the same set",
							position.name, got, table.imports, control)
					}
				})
			}
		})
	}
}

// TestPinnedForkCoercionWalksOrdinaryToPrimitive pins the walk in BOTH
// directions. The accepting rows are the load-bearing ones: they are the
// programs a flattened "charge all three members" would refuse, and they RUN.
func TestPinnedForkCoercionWalksOrdinaryToPrimitive(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "a number hint over a valueOf-only object charges valueOf",
			modules: []string{coercionSeam},
			source:  "import { numeric } from \"./seam.mod.sm\"\nconst v = +numeric\nexport function main(): string[] {\n  return [`${v}`]\n}\n",
			reject:  []string{"SMITHERS2102@2:12"},
		},
		{
			// Object.prototype.valueOf returns the object ITSELF, so the number
			// hint does not stop there and really does run `toString`.
			name:    "a number hint over a toString-only object falls through to toString",
			modules: []string{coercionSeam},
			source:  "import { stringy } from \"./seam.mod.sm\"\nconst v = +(stringy as unknown as number)\nexport function main(): string[] {\n  return [`${v}`]\n}\n",
			reject:  []string{"SMITHERS2102@2:12"},
		},
		{
			// Object.prototype.toString answers, so the string hint stops there
			// and `valueOf` is unreachable. The program prints `[object Object]`.
			name:    "a string hint over a valueOf-only object charges NOTHING and runs",
			modules: []string{coercionSeam},
			source:  "import { numeric } from \"./seam.mod.sm\"\nexport function main(): string[] {\n  return [`${numeric}`]\n}\n",
			stdout:  "[object Object]",
		},
		{
			name:    "String over a valueOf-only object charges NOTHING and runs",
			modules: []string{coercionSeam},
			source:  "import { numeric } from \"./seam.mod.sm\"\nexport function main(): string[] {\n  return [String(numeric)]\n}\n",
			stdout:  "[object Object]",
		},
		{
			name:    "an element-access key over a valueOf-only object charges NOTHING and runs",
			modules: []string{coercionSeam},
			source: "import { numeric } from \"./seam.mod.sm\"\n" +
				"export function main(): string[] {\n" +
				"  const table: Record<string, number> = { a: 1 }\n" +
				"  return [`${table[numeric as unknown as string] ?? 0}`]\n" +
				"}\n",
			stdout: "0",
		},
		{
			// The other fall-through: `toString(): object` is a program
			// TypeScript accepts, and then the string hint reaches `valueOf`.
			name:    "a string hint falls through a toString that does not answer",
			modules: []string{coercionSeam},
			source:  "import { fallsThrough } from \"./seam.mod.sm\"\nconst v = `x${fallsThrough}`\nexport function main(): string[] {\n  return [v]\n}\n",
			reject:  []string{"SMITHERS2102@2:15"},
		},
		{
			// `!` is deliberately NOT stripped by `charge`: in `.sm` it is the
			// checked propagation boundary and it really does change the value.
			// The row still travels through it; SMITHERS1207 is the separate
			// rule that refuses `!` over a value that is not a Result.
			name:    "a non-null assertion keeps the row and adds its own rule",
			modules: []string{coercionSeam},
			source:  "import { numeric } from \"./seam.mod.sm\"\nconst v = +numeric!\nexport function main(): string[] {\n  return [`${v}`]\n}\n",
			reject:  []string{"SMITHERS1207@2:12", "SMITHERS2102@2:12"},
		},
		{
			name:    "Symbol.toPrimitive shadows valueOf and toString",
			modules: []string{coercionSeam},
			source:  "import { exotic } from \"./seam.mod.sm\"\nconst v = +exotic\nexport function main(): string[] {\n  return [`${v}`]\n}\n",
			reject:  []string{"SMITHERS2102@2:12"},
		},
	})
}

// TestPinnedForkInstanceofChargesSymbolHasInstance pins the member `instanceof`
// actually runs. The negative is the reason this is not the coercion walk: a
// class with a capability-reading `static toString()` on the right of
// `instanceof` compiles and RUNS, because `instanceof` never calls it.
func TestPinnedForkInstanceofChargesSymbolHasInstance(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "instanceof charges the right operand's Symbol.hasInstance",
			modules: []string{coercionSeam},
			source: "import { matcher } from \"./seam.mod.sm\"\n" +
				"const v = ({} as unknown) instanceof matcher\n" +
				"export function main(): string[] {\n  return [`${v}`]\n}\n",
			reject: []string{"SMITHERS2102@2:38"},
		},
		{
			name:    "instanceof does NOT charge a static toString, and the program runs",
			modules: []string{coercionSeam},
			source: "import { Named } from \"./seam.mod.sm\"\n" +
				"export function main(): string[] {\n" +
				"  return [`${new Named() instanceof Named}`]\n" +
				"}\n",
			stdout: "true",
		},
	})
}

// TestPinnedForkObjectSpreadRunsItsOwnEnumerableGetters pins the enumeration
// branch of the same table, with the class-prototype carve-out that keeps it
// from refusing a program that runs.
func TestPinnedForkObjectSpreadRunsItsOwnEnumerableGetters(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "an object spread runs the value's own enumerable getters",
			modules: []string{coercionSeam},
			source: "import { boxed } from \"./seam.mod.sm\"\n" +
				"const copy = { ...boxed }\n" +
				"export function main(): string[] {\n  return [`${copy.size}`]\n}\n",
			reject: []string{"SMITHERS2102@2:19"},
		},
		{
			name:    "a rest destructuring runs them too",
			modules: []string{coercionSeam},
			source: "import { boxed } from \"./seam.mod.sm\"\n" +
				"const { ...rest } = boxed\n" +
				"export function main(): string[] {\n  return [`${rest.size}`]\n}\n",
			reject: []string{"SMITHERS2102@2:9"},
		},
		{
			// A getter declared in a CLASS body lives on the prototype, is not
			// an own property, and is not copied. Charging it would refuse this.
			name:    "a class PROTOTYPE getter is not an own property, and the spread runs",
			modules: []string{coercionSeam},
			source: "import { Prototyped } from \"./seam.mod.sm\"\n" +
				"export function main(): string[] {\n" +
				"  const copy = { ...new Prototyped() }\n" +
				"  return [`${Object.keys(copy).length}`]\n" +
				"}\n",
			stdout: "0",
		},
	})
}

// TestPinnedForkCoercionPositionsStayUsable is the other direction, and it is
// the half that stops this rule from becoming the eighth over-correction in
// this file. Every program below is legitimate, must compile, and must RUN —
// the stdout assertion is what proves the value really flowed rather than the
// program merely being un-refused.
func TestPinnedForkCoercionPositionsStayUsable(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:   "ordinary arithmetic, relational, bitwise and compound assignment over primitives",
			source: "export function main(): string[] {\n  let n = 6\n  n += 2\n  n *= 3\n  n <<= 1\n  const a = 2 - 1 * 2 / 1 % 5 ** 1\n  return [`${n}${a}${(1 & 3) | (4 ^ 5)}${1 < 2}${+\"3\"}${-1}${~0}`]\n}\n",
			stdout: "4801true3-1-1",
		},
		{
			name:   "an ordinary template literal, JSON.stringify and computed key",
			source: "export function main(): string[] {\n  const table: Record<string, number> = { a: 1 }\n  return [`${\"hello\"} ${JSON.stringify({ a: 1 })} ${table[\"a\"]}`]\n}\n",
			stdout: "hello {\"a\":1} 1",
		},
		{
			name:   "a valueOf that reads no capability",
			source: "const plain = { valueOf(): number { return 7 } }\nexport function main(): string[] {\n  return [`${+plain}`]\n}\n",
			stdout: "7",
		},
		{
			// A TAGGED template hands its substitutions to the tag UNTOUCHED.
			// This backend charged the substitution's `toString` anyway, which
			// refused this program; the position table's own carve-out now
			// governs both halves of the rule.
			name:    "a tagged template does NOT coerce its substitutions, and the program runs",
			modules: []string{coercionSeam},
			source: "import { stringy } from \"./seam.mod.sm\"\n" +
				"/** @throws {never} */\n" +
				"function tag(parts: TemplateStringsArray, ...values: unknown[]): string {\n" +
				"  return parts.raw.join(\"|\") + values.length\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  return [tag`x${stringy}y`]\n" +
				"}\n",
			stdout: "x|y1",
		},
		{
			// ToBoolean, SameValueZero and strict equality run no user code.
			name:    "strict equality, truthiness and switch run no member",
			modules: []string{coercionSeam},
			source: "import { numeric } from \"./seam.mod.sm\"\n" +
				"export function main(): string[] {\n" +
				"  const strict = (numeric as unknown) === 1\n" +
				"  const truthy = numeric ? 1 : 0\n" +
				"  const found = [1, 2].indexOf(numeric as unknown as number)\n" +
				"  return [`${strict}${truthy}${found}${Boolean(numeric)}`]\n" +
				"}\n",
			stdout: "false1-1true",
		},
		{
			// `??`, `||`, `&&`, the ternary and the comma sequence a value; they
			// never coerce it. The position table omits them deliberately.
			name:    "the selecting operators run no member",
			modules: []string{coercionSeam},
			source: "import { numeric } from \"./seam.mod.sm\"\n" +
				"export function main(): string[] {\n" +
				"  const chosen = (numeric ?? numeric) && (true ? numeric : numeric)\n" +
				"  return [`${typeof chosen}${!numeric}`]\n" +
				"}\n",
			stdout: "objectfalse",
		},
		{
			// Ambient identity, not spelling: a LOCAL binding named `Number` is
			// an ordinary call and charges nothing of the ambient rule.
			name:    "a local binding named Number is an ordinary call",
			modules: []string{coercionSeam},
			source: "import { numeric } from \"./seam.mod.sm\"\n" +
				"function Number(value: unknown): number { return 42 }\n" +
				"export function main(): string[] {\n" +
				"  return [`${Number(numeric)}`]\n" +
				"}\n",
			stdout: "42",
		},
	})
}

// TestPinnedForkCoercionRowReachesTheProvideSite is the gate. Merely refusing
// `+obj` would not show that the requirement TRAVELS: this pins that the row
// reaches `Layer.provide`, is reported when the layer does not carry it, and is
// discharged — and the program runs — when it does.
func TestPinnedForkCoercionRowReachesTheProvideSite(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "a provide site sees a requirement only a coercion introduces",
			modules: []string{coercionSeam},
			source: "import { Context } from \"smthrs/context\"\n" +
				"import { Layer } from \"smthrs/provider\"\n" +
				"import { numeric } from \"./seam.mod.sm\"\n" +
				"abstract class Label extends Context {\n  abstract text(): string\n}\n" +
				"function measure(): string {\n  return `${Label.context().text()}${+numeric}`\n}\n" +
				"const label: Label = { text: () => \"t\" }\n" +
				"export const lines = Layer.provide(Layer.succeed(Label, label), () => [measure()])\n",
			reject: []string{"SMITHERS2101@11:22"},
		},
		{
			name:    "a satisfied coercion requirement runs",
			modules: []string{coercionSeam},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Db, numeric } from \"./seam.mod.sm\"\n" +
				"function measure(): number {\n  return +numeric\n}\n" +
				"const db: Db = { read: () => \"DBX\" }\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(Layer.succeed(Db, db), () => [`${measure()}`])\n}\n",
			stdout: "3",
		},
	})
}
