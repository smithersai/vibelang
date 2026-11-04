package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"
)

// Functions, "Legacy JavaScript" (VIP-1 and VIP-4, amended 2026-10-29).
var legacyJavaScriptQuotes = []string{
	"every `IdentifierReference` named `eval`",
	"every `IdentifierReference` resolving to the global `Function` constructor, except the right operand of `instanceof`",
	"and the object of a statically named `prototype` access",
	"every `IdentifierReference` named `arguments`",
	"every `with` statement",
	"Property names on ordinary objects, such as `o.arguments`, `o.eval` and `{ var: 1 }`, are names, not references, and are unaffected",
	"Reading a property named `constructor` from a value whose static type is a function type or `Function` is `EK0107`",
	"A string-literal `data:` or `blob:` specifier, in `import(…)` or an `import` declaration, is `EK0107`",
	"A member `eval` or `Function` is the global itself, so `globalThis.eval(s)` and `globalThis[\"Function\"](\"return 1\")` are `EK0107`, with the two `Function` exemptions above: `x instanceof globalThis.Function` and `globalThis.Function.prototype` are allowed.",
}

func requireLegacyJavaScriptQuotes(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range legacyJavaScriptQuotes {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("missing legacy JavaScript rule: %q", quote)
		}
	}
}

func TestLegacyJavaScriptQuoted(t *testing.T) { requireLegacyJavaScriptQuotes(t) }

// legacyJavaScriptContexts wraps one statement in each kind of function the
// rule names ("anywhere in a `.vibe` file, plain functions included").
var legacyJavaScriptContexts = map[string]func(statement string) string{
	"plain":  func(s string) string { return "export function load(): unknown { " + s + " }" },
	"effect": func(s string) string { return "export effect function load() { " + s + " }" },
	"async":  func(s string) string { return "export async function load() { " + s + " }" },
	"arrow":  func(s string) string { return "export const load = () => { " + s + " }" },
	"method": func(s string) string { return "export class Loader { load(): unknown { " + s + " } }" },
}

// legacyJavaScriptForms maps a key to the statement it tests and the number
// of EK0107 diagnostics the rule gives it.
var legacyJavaScriptForms = map[string]struct {
	statement string
	want      int
}{
	"function-wrapper-instanceof-parens":    {`const x: unknown = 1; return x instanceof ((Function))`, 0},
	"function-wrapper-instanceof-assert":    {`const x: unknown = 1; return x instanceof (Function as FunctionConstructor)`, 0},
	"function-wrapper-instanceof-satisfies": {`const x: unknown = 1; return x instanceof (Function satisfies FunctionConstructor)`, 0},
	"function-wrapper-instanceof-nonnull":   {`const x: unknown = 1; return x instanceof Function!`, 0},
	"function-wrapper-prototype-parens":     {`return ((Function)).prototype`, 0},
	"function-wrapper-prototype-assert":     {`return (Function as FunctionConstructor).prototype`, 0},
	"function-wrapper-prototype-satisfies":  {`return (Function satisfies FunctionConstructor)["prototype"]`, 0},
	"function-wrapper-prototype-nonnull":    {`return Function!?.prototype`, 0},
	"function-wrapper-call-banned":          {`return (Function as FunctionConstructor)("return 7")`, 1},
	"function-wrapper-alias-banned":         {`const F = ((Function)); return F`, 1},
	"function-wrapper-member-banned":        {`return (Function!).name`, 1},
	"function-wrapper-comma-banned":         {`const x: unknown = 1; return x instanceof (0, Function)`, 1},
	"eval-direct":                           {`return eval("1")`, 1},
	"eval-indirect":                         {`return (0, eval)("1")`, 1},
	"eval-optional":                         {`return eval?.("1")`, 1},
	"eval-alias":                            {`const e = eval; return e`, 1},
	"eval-property-control":                 {`const o = { eval: 1 }; return o.eval`, 0},
	"eval-text-control":                     {`return "eval(1)"`, 0},
	"arguments":                             {`return arguments.length`, 1},
	"arguments-shorthand":                   {`return { arguments }`, 1},
	"arguments-property-control":            {`const o = { arguments: 1 }; return o.arguments`, 0},
	"function-new":                          {`return new Function("return 1")`, 1},
	"function-call":                         {`return Function("return 1")`, 1},
	"function-optional-call":                {`return Function?.("return 1")`, 1},
	"function-alias":                        {`const F = Function; return F`, 1},
	"function-member":                       {`return Function.call(null, "return 7")`, 1},
	"function-instanceof-control":           {`const x: unknown = 1; return x instanceof Function`, 0},
	"function-prototype-control":            {`return Function.prototype.toString.call(() => 1)`, 0},
	"function-prototype-element-control":    {`return Function["prototype"]`, 0},
	"function-type-control":                 {`const f: Function = () => 1; return f`, 0},
	"function-shorthand":                    {`return { Function }`, 1},
	"function-shorthand-type-shadow":        {`type Function = number; return { Function }`, 1},
	"function-shorthand-local-control":      {`const Function = 1; return { Function }`, 0},
	"function-shorthand-property-control":   {`return { Function: 1 }`, 0},
	"function-shorthand-default-control":    {`const { Function = () => 1 } = {} as { Function?: () => number }; return { Function }`, 0},
	"with":                                  {`const o = { x: 1 }; with (o) { return 1 }`, 1},
	"constructor-nullable-call":             {`const f = undefined as (() => number) | undefined; return f?.constructor`, 1},
	"constructor-nullable-function":         {`const f = null as Function | null; return f?.constructor`, 1},
	"constructor-nullable-construct":        {`const f = undefined as (new () => object) | undefined; return f?.["constructor"]`, 1},
	"constructor-nullable-key-wrapper":      {`const f = null as (() => number) | null; return f?.[("constructor" as const)]`, 1},
	"constructor-nullable-template-key":     {"const f = undefined as (() => number) | null | undefined; return f?.[`constructor`]", 1},
	"constructor-nullable-member":           {`const o = {} as { f?: () => number }; return o.f?.constructor`, 1},
	"constructor-nullable-continuation":     {`const o = undefined as { f: () => number } | undefined; return o?.f.constructor`, 1},
	"constructor-nullable-generic":          {`function read<T extends (() => number) | undefined>(f: T) { return f?.constructor }; return read`, 1},
	"constructor-nullable-object-control":   {`const o = undefined as { constructor: number } | undefined; return o?.constructor`, 0},
	"constructor-nullable-any-control":      {`const o = undefined as any; return o?.constructor`, 0},
	"constructor-nullable-instance-control": {`class Box {}; const o = null as Box | null; return o?.constructor`, 0},
	"constructor-nullable-delete-control":   {`const f = undefined as (() => number) | undefined; return delete f?.constructor`, 0},
	"constructor-arrow":                     {`return (async () => {}).constructor`, 1},
	"constructor-function":                  {`const f = () => 1; return f.constructor`, 1},
	"constructor-element":                   {`const f = () => 1; return f["constructor"]`, 1},
	"constructor-write-control":             {"function f(): number { return 1 }; function g(): number { return 2 }; f.constructor = g; return f", 0},
	"constructor-element-write-control":     {"function f(): number { return 1 }; function g(): number { return 2 }; f[\"constructor\"] = g; return f", 0},
	"constructor-destructure-write-control": {"function f(): number { return 1 }; function g(): number { return 2 }; ({ value: f.constructor } = { value: g }); return f", 0},
	"constructor-for-of-write-control":      {"function f(): number { return 1 }; function g(): number { return 2 }; for (f.constructor of [g]) {} return f", 0},
	"constructor-read-write":                {"function f(): number { return 1 }; function g(): number { return 2 }; f.constructor ||= g; return f", 1},
	"constructor-write-rhs-control":         {"function f(): number { return 1 }; function g(): number { return 2 }; f.constructor = eval(\"1\"); return f", 1},
	"constructor-global-write":              {"function f(): number { return 1 }; function g(): number { return 2 }; Function.constructor = g; return f", 1},
	"constructor-object-control":            {`return ({}).constructor`, 0},
	"constructor-any-control":               {`const v: any = 1; return v.constructor`, 0},
	"constructor-key-parens":                {`const f=()=>1; return f[("constructor")]`, 1},
	"constructor-key-assert":                {`const f=()=>1; return f[("constructor" as const)]`, 1},
	"constructor-key-satisfies":             {`const f=()=>1; return f[("constructor" satisfies string)]`, 1},
	"constructor-key-nonnull":               {`const f=()=>1; return f["constructor"!]`, 1},
	"prototype-key-parens-control":          {`return Function[("prototype")]`, 0},
	"prototype-key-assert-control":          {`return Function[("prototype" as const)]`, 0},
	"prototype-key-satisfies-control":       {`return Function[("prototype" satisfies string)]`, 0},
	"prototype-key-nonnull-control":         {`return Function["prototype"!]`, 0},
	"constructor-key-object-control":        {`const o={constructor:1}; return o[("constructor")]`, 0},
	"constructor-key-any-control":           {`const f:any=()=>1; return f[("constructor")]`, 0},
	"constructor-key-write-control":         {`const f=()=>1; f[("constructor")]=f; return f`, 0},
	"constructor-key-update":                {`const f=()=>1; f[("constructor")] ||= f; return f`, 1},
	"constructor-key-delete-control":        {`const f=()=>1; delete f[("constructor")]; return f`, 0},
	"specifier-data":                        {`return import("data:text/javascript,export default 1")`, 1},
	"specifier-blob":                        {`return import("blob:https://example.test/1")`, 1},
	"specifier-computed-control":            {`const spec = "./other.js"; return import(spec)`, 0},
	"constructor-delete-control":            {"function f(): number { return 1 }; function g(): number { return 2 }; delete f.constructor; return f", 0},
	"constructor-delete-parens-control":     {"function f(): number { return 1 }; function g(): number { return 2 }; delete ((f[\"constructor\"])); return f", 0},
	"constructor-assert-write-control":      {"function f(): number { return 1 }; function g(): number { return 2 }; (f.constructor as Function) = g; return f", 0},
	"constructor-nonnull-write-control":     {"function f(): number { return 1 }; function g(): number { return 2 }; (f.constructor!) = g; return f", 0},
	"constructor-satisfies-write-control":   {"function f(): number { return 1 }; function g(): number { return 2 }; (f.constructor satisfies Function) = g; return f", 0},
	"constructor-assert-read":               {"function f(): number { return 1 }; function g(): number { return 2 }; return (f.constructor as Function)", 1},
	"constructor-delete-base-read":          {"function f(): number { return 1 }; function g(): number { return 2 }; delete (f.constructor as any).property; return f", 1},
	"constructor-delete-global":             {"function f(): number { return 1 }; function g(): number { return 2 }; delete Function.constructor; return f", 1},
	"global-eval":                           {`return globalThis.eval("1")`, 1},
	"global-eval-element":                   {`return globalThis["eval"]("1")`, 1},
	"global-eval-template":                  {"return globalThis[`eval`](\"1\")", 1},
	"global-eval-optional":                  {`return globalThis?.eval("1")`, 1},
	"global-eval-parens":                    {`return (globalThis).eval`, 1},
	"global-eval-nested":                    {`return globalThis.globalThis.eval`, 1},
	"global-eval-alias":                     {`const e = globalThis.eval; return e`, 1},
	"global-function-call":                  {`return globalThis.Function("return 1")`, 1},
	"global-function-new":                   {`return new globalThis.Function("return 1")`, 1},
	"global-function-element":               {`return globalThis["Function"]("return 1")`, 1},
	"global-function-member":                {`return globalThis.Function.call(null, "return 7")`, 1},
	"global-function-nested":                {`return globalThis["globalThis"].Function`, 1},
	"global-function-instanceof-control":    {`const x: unknown = 1; return x instanceof globalThis.Function`, 0},
	"global-function-prototype-control":     {`return globalThis.Function.prototype`, 0},
	"global-function-prototype-el-control":  {`return globalThis["Function"]["prototype"]`, 0},
	"global-function-type-control":          {`type F = typeof globalThis.Function; const n: F | number = 1; return n`, 0},
	"global-member-control":                 {`return globalThis.Math.max(1, 2)`, 0},
	"global-shadow-control":                 {`const globalThis = { eval: 1, Function: 2 }; return globalThis.eval + globalThis.Function`, 0},
}

func FuzzLegacyJavaScript(f *testing.F) {
	startShortBudget(f)
	requireLegacyJavaScriptQuotes(f)
	for key := range legacyJavaScriptForms {
		for where := range legacyJavaScriptContexts {
			f.Add(key, where, uint8(0))
		}
		f.Add(key, "plain", uint8(1))
		f.Add(key, "effect", uint8(2))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key, where string, mode uint8) {
		form, ok := legacyJavaScriptForms[key]
		if !ok {
			key, form = "eval-direct", legacyJavaScriptForms["eval-direct"]
		}
		wrap, ok := legacyJavaScriptContexts[where]
		if !ok {
			where, wrap = "plain", legacyJavaScriptContexts["plain"]
		}
		statement := form.statement
		switch mode % 3 {
		case 1:
			statement = "/* legacy */ " + statement + " /* eval Function arguments with */"
		case 2:
			statement = strings.ReplaceAll(statement, "return ", "return\t")
		}
		source := wrap(statement)
		if mode%3 == 2 {
			source = "// café 😀 arguments eval\n" + source
		}
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if d.Source() == "EK" && d.Code() == 107 {
				count++
			}
		}
		quote := legacyJavaScriptQuotes[0]
		if strings.HasPrefix(key, "constructor-") {
			quote = legacyJavaScriptQuotes[6]
		}
		if count != form.want {
			Gap(t, "FuzzLegacyJavaScript", "legacy:"+key+":"+where, "%s; got %d EK0107, want %d\n%s\n%v", quote, count, form.want, source, result.Diagnostics)
		}
	})
}
