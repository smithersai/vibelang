package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

const doNeverCompletionQuote = "a do expression with no normal path has type `never`"
const doNormalCompletionQuote = "Its type is the union of the values reaching normal completion under ECMAScript's `UpdateEmpty` flow, including consumed local jumps."
const doLiteralCompletionQuote = "`const exact = do { 1 }` has type `1`, while `let ordinary = do { 1 }` widens to `number`"
const doNeverStop = "export function stop(): never { throw 1 }\n/** @throws {unknown} */\nexport function raise(): never { throw 1 }\n"

func TestDoNeverCompletionQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", doNeverCompletionQuote)
	chapterSays(t, "002-running.md", doNormalCompletionQuote)
	chapterSays(t, "002-running.md", doLiteralCompletionQuote)
}

// PREVIEW-15 d1-d6, followed by neighbours that spill conditional and logical
// values, preserve finally completions or retain the parameter IIFE boundary.
func TestDoNeverCompletion(t *testing.T) {
	TestDoNeverCompletionQuoted(t)
	w, stock := NewWorkspace(t), StockTypeScript(t)
	for _, key := range []string{"d1", "d2", "d3", "d4", "d5", "d6", "conditional", "logical", "finally", "parameter", "nested", "invalid", "user-auto", "user-prefixed-auto", "outer-completion", "outer-receiver", "outer-conditional", "outer-finally", "outer-invalid", "outer-return", "outer-bindings", "user-never-iteration", "empty-captures", "empty-source", "empty-source-filled", "literal-captures", "context-captures", "source-literal"} {
		t.Run(key, func(t *testing.T) { checkDoNeverCompletion(t, w, stock, key, nil) })
	}
}

// VIP-2's no-normal-path rule is stronger than a contextual unknown return:
// require the actual never type, rather than any or the unreachable literal.
func TestDoNeverCompletionType(t *testing.T) {
	for i := range 13 {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			checkDoNeverCompletionType(t, []byte{byte(i)})
		})
	}
}

// VIP-4 permits direct throws in async code. Keep the sync yield* probe on a
// foreign never call so both iteration paths remain covered without a plain throw.
func checkDoNeverCompletionType(t *testing.T, data []byte) {
	t.Helper()
	TestDoNeverCompletionQuoted(t)
	mode := 0
	if len(data) != 0 {
		mode = int(data[0]) % 13
	}
	source := "import { stop } from './stop.js'; export const value: never = do { stop(); 1 };"
	switch mode {
	case 1:
		source = "export async function f(): Promise<never> { const value: never = do { throw 1; 1 }; return value; }"
	case 2:
		source = "export function f(): never { return do { return null as never; 1 }; }"
	case 3:
		source = "export function f(): void { for (;;) { const value: never = do { break; 1 }; } }"
	case 4:
		source = "export function f(): void { for (;;) { const value: never = do { continue; 1 }; } }"
	case 5:
		source = "export async function f(): Promise<never> { return null as never; return do { throw 1; 1 }; }"
	case 6:
		source = "import { stop } from './stop.js'; export function f(): void { for (const item of do { stop(); [1] }) { void item; } }"
	case 7:
		source = "export async function f(): Promise<number[]> { return [...do { throw 1; [1] }]; }"
	case 8:
		source = "export function f(): number { const [item] = do { return 1; [1] }; return item; }"
	case 9:
		source = "import { stop } from './stop.js'; export function* f(): Generator<number> { yield* do { stop(); [1] }; }"
	case 10:
		source = "export function f(): number { let item: number; [item] = do { return 1; [1] }; return item; }"
	case 11:
		source = "import { stop } from './stop.js'; function take(...items: number[]): void {} export function f(): void { take(...do { stop(); [1] }); }"
	case 12:
		source = "import { stop } from './stop.js'; export async function f(): Promise<void> { for await (const item of do { stop(); [1] }) { void item; } }"
	}
	w := NewWorkspace(t)
	c, err := w.CompileOrdered(t.Context(), Project{Files: map[string]string{
		"main.vibe": source,
		"stop.ts":   doNeverStop,
	}, Config: fmt.Sprintf(errorTwinConfig, "main.vibe")}, OrderTsc, true)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	if len(c.Diagnostics) != 0 {
		t.Fatalf("mode %d: no-normal-path do must have type never: %v", mode, c.Diagnostics)
	}
}

// The static oracle is stock tsc's diagnostics on an IIFE twin. Never execute
// these programs: an unconditional call to stop deliberately cannot complete.
func checkDoNeverCompletion(t *testing.T, w *Workspace, stock, key string, data []byte) {
	t.Helper()
	TestDoNeverCompletionQuoted(t)
	body, twinBody := "stop(); 1", "stop(); return 1"
	result, prefix, suffix := "unknown", "", ""
	switch key {
	case "d1":
		body, twinBody = "raise(); 1", "raise(); return 1"
		prefix, suffix = "try { ", " } catch (error) { return error }"
	case "d3":
		prefix, suffix = "try { ", " } catch (error) { return error }"
	case "d4":
		body, twinBody, result = "1", "return 1", "number"
	case "d5":
		result = "number"
	case "d6":
		body, twinBody, result = "if (flag) stop(); 1", "if (flag) stop(); return 1", "number"
	case "position", "invalid":
		count, position := 3, 0
		if len(data) > 0 {
			count = int(data[0])%6 + 1
		}
		if len(data) > 1 {
			position = int(data[1]) % (count + 1)
		}
		var statements []string
		for i := 0; i <= count; i++ {
			if i == position {
				statements = append(statements, "stop();")
			}
			if i < count {
				statements = append(statements, fmt.Sprintf("const n%d = %d;", i, i))
			}
		}
		if key == "invalid" {
			statements = append(statements, "const invalid: string = 1;")
		}
		body, twinBody = strings.Join(statements, " ")+" 1", strings.Join(statements, " ")+" return 1"
	}
	value, twin := "do { "+body+" }", "(() => { "+twinBody+" })()"
	switch key {
	case "conditional":
		value, twin = "flag ? "+value+" : do { stop(); 2 }", "flag ? "+twin+" : (() => { stop(); return 2 })()"
	case "logical":
		value, twin = "flag && "+value, "flag && "+twin
	case "finally":
		value, twin = "do { try { stop(); 1 } finally { stop(); 2 } }", "(() => { try { stop(); return 1 } finally { stop(); 2 } })()"
	case "nested":
		value = "do { (do { " + body + " }) }"
	}
	source := "import { stop, raise } from './stop.js';\nexport function f(flag: boolean): " + result + " { " + prefix + "return " + value + ";" + suffix + " }"
	counterpart := "import { stop, raise } from './stop.js';\nexport function f(flag: boolean): " + result + " { " + prefix + "return " + twin + ";" + suffix + " }"
	if key == "parameter" {
		source = "import { stop } from './stop.js'; export function f(value = " + value + ") { return value }"
		counterpart = "import { stop } from './stop.js'; export function f(value = " + twin + ") { return value }"
	}
	if strings.HasPrefix(key, "outer-") {
		value, twin := "do { 1 }", "(() => { return 1 })()"
		if key == "outer-conditional" {
			value, twin = "flag ? do { 1 } : do { 2 }", "flag ? (() => { return 1 })() : (() => { return 2 })()"
		}
		if key == "outer-finally" {
			value, twin = "do { try { 1 } finally {} }", "(() => { try { return 1 } finally {} })()"
		}
		operation := "const value = " + value + "; return value.toFixed();"
		twinOperation := "const value = " + twin + "; return value.toFixed();"
		if key == "outer-invalid" {
			operation = strings.Replace(operation, ".toFixed()", ".missing()", 1)
			twinOperation = strings.Replace(twinOperation, ".toFixed()", ".missing()", 1)
		}
		if key == "outer-receiver" {
			operation = "return (class { static m(n: number): string { return String(n) } }).m(" + value + ");"
			twinOperation = "return (class { static m(n: number): string { return String(n) } }).m(" + twin + ");"
		}
		source = "import { stop } from './stop.js'; export function f(flag: boolean): string { stop(); " + operation + " }"
		counterpart = "import { stop } from './stop.js'; export function f(flag: boolean): string { stop(); " + twinOperation + " }"
		if key == "outer-return" {
			source = strings.Replace(source, "{ stop(); ", "{ return \"before\"; ", 1)
			counterpart = strings.Replace(counterpart, "{ stop(); ", "{ return \"before\"; ", 1)
		}
	}
	if key == "outer-bindings" {
		source = "export function f(): unknown {\n return 1;\n let user;\n const value = do { 1 };\n return user;\n}\nexport function g(): number {\n return 1;\n const value = do { 1 };\n unused: {}\n void value;\n}\nexport function inferred() {\n return 1;\n const value = do { 1 };\n void value;\n}\nexport const checked: number = inferred();\nexport function live(flag: boolean): number {\n if (flag) {\n  return 1;\n  const value = do { 1 };\n  dead: {}\n  void value;\n }\n alive: {}\n return 2;\n}\nexport function nested(): unknown {\n return 1;\n const value = do { 1 };\n function inner() { innerUnused: {}; return 1 }\n return inner;\n}\n"
		source += "export function deadBreak(): number { live: { return 1; const value = do { 1 }; break live; } }\nexport function deadContinue(): number { live: while (true) { return 1; const value = do { 1 }; continue live; } }\nexport function liveUse(flag: boolean): number { used: { if (flag) break used; const value = do { 1 }; return value; } return 2; }\n"
		counterpart = strings.ReplaceAll(source, "do { 1 }", "(() => { return 1 })()")
	}
	if key == "empty-captures" {
		values := []struct{ vibe, native string }{
			{"[].concat(do { [] })", "[].concat((() => { return [] })())"},
			{"[]?.concat(do { [] })", "[]?.concat((() => { return [] })())"},
			{"[][\"concat\"](do { [] })", "[][\"concat\"]((() => { return [] })())"},
			{"pair([], do { 1 })", "pair([], (() => { return 1 })())"},
			{"[...[], do { 1 }]", "[...[], (() => { return 1 })()]"},
			{"(do { [] })[do { 0 }]", "((() => { return [] })())[((() => { return 0 })())]"},
			{"([] as never[]).concat(do { [] })", "([] as never[]).concat((() => { return [] })())"},
			{"match ([]) { when []: 1; default: 0; }", "((values: readonly unknown[]) => values.length === 0 ? 1 : 0)([])"},
			{"match ([]) { when []: do { 1 }; default: 0; }", "((values: readonly unknown[]) => values.length === 0 ? 1 : 0)([])"},
			{"[] is []", "((values: readonly unknown[]) => values.length === 0)([])"},
			{"flag ? [] : do { [] }", "flag ? [] : (() => { return [] })()"},
			{"flag && do { [] }", "flag && (() => { return [] })()"},
			{"(flag ? [] : undefined) ?? do { [] }", "(flag ? [] : undefined) ?? (() => { return [] })()"},
		}
		mode := 0
		if len(data) != 0 {
			mode = int(data[0]) % len(values)
		}
		before := ""
		if len(data) > 1 && data[1]&1 != 0 {
			before = "stop(); "
		}
		head := "import { stop } from './stop.js'; function pair(xs: number[], n: number) { return [xs.length, n] } export function f(flag: boolean): unknown { "
		source = head + before + "return " + values[mode].vibe + "; }"
		counterpart = head + before + "return " + values[mode].native + "; }"
	}
	if key == "literal-captures" {
		mode := 0
		if len(data) != 0 {
			mode = int(data[0]) % 3
		}
		forms := []struct{ result, vibe, native string }{
			{"1 | 2", "flag ? do { 1 } : do { 2 }", "flag ? (() : 1 => { return 1 })() : (() : 2 => { return 2 })()"},
			{"false | 1", "flag && do { 1 }", "flag && (() : 1 => { return 1 })()"},
			{"1 | 2", "(flag ? 1 : undefined) ?? do { 2 }", "(flag ? 1 : undefined) ?? (() : 2 => { return 2 })()"},
		}
		f := forms[mode]
		source = "export function f(flag: boolean): " + f.result + " { return " + f.vibe + "; }"
		counterpart = "export function f(flag: boolean): " + f.result + " { return " + f.native + "; }"
	}
	if key == "context-captures" {
		mode := 0
		if len(data) != 0 {
			mode = int(data[0]) % 4
		}
		forms := []struct{ result, vibe, native string }{
			{"Shape", "flag ? do { ({ tag: \"a\" }) } : do { ({ tag: \"b\" }) }", "flag ? (() : Shape => ({ tag: \"a\" }))() : (() : Shape => ({ tag: \"b\" }))()"},
			{"false | Shape", "flag && do { ({ tag: \"a\" }) }", "flag && (() : Shape => ({ tag: \"a\" }))()"},
			{"Shape", "(flag ? { tag: \"a\" } : undefined) ?? do { ({ tag: \"b\" }) }", "(flag ? { tag: \"a\" } : undefined) ?? (() : Shape => ({ tag: \"b\" }))()"},
			{"Shape", "(flag ? { tag: \"a\" } : undefined) || do { ({ tag: \"b\" }) }", "(flag ? { tag: \"a\" } : undefined) || (() : Shape => ({ tag: \"b\" }))()"},
		}
		f := forms[mode]
		head := "type Shape = { tag: \"a\" } | { tag: \"b\" }; export function f(flag: boolean): " + f.result + " { return "
		source, counterpart = head+f.vibe+"; }", head+f.native+"; }"
	}
	if key == "source-literal" {
		source = "export function f(): 1 { let $do_v1; $do_v1 = 1; return $do_v1; }"
		counterpart = source
	}
	if key == "empty-source" || key == "empty-source-filled" {
		fill := ""
		if key == "empty-source-filled" {
			fill = "$do_t1.push(1); "
		}
		source = "export function f(): unknown { const $do_t1 = []; " + fill + "return $do_t1.concat(do { [] }); }"
		counterpart = strings.Replace(source, "do { [] }", "(() => { return [] })()", 1)
	}
	if key == "user-never-iteration" {
		source = "declare const $do1: never; export function f() { for (const item of $do1) { void item } const [bound] = $do1; void bound; const spread = [...$do1]; void spread; } export function* g() { yield* $do1; }"
		counterpart = source
	}
	if key == "user-auto" {
		source = "import { stop } from './stop.js'; export function f(): unknown { let userValue; stop(); return userValue }"
		counterpart = source
	}
	if key == "user-prefixed-auto" {
		source = "import { stop } from './stop.js'; export function f(): unknown { let $do1; stop(); return $do1 }"
		counterpart = source
	}
	configuration := func(name string) string {
		config := fmt.Sprintf(errorTwinConfig, name)
		if key != "outer-bindings" {
			return config
		}
		var object map[string]any
		if err := json.Unmarshal([]byte(config), &object); err != nil {
			t.Fatal(err)
		}
		options := object["compilerOptions"].(map[string]any)
		options["allowUnreachableCode"] = true
		options["allowUnusedLabels"] = false
		options["noImplicitReturns"] = true
		data, err := json.Marshal(object)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	project := Project{Files: map[string]string{"main.vibe": source, "stop.ts": doNeverStop}, Config: configuration("main.vibe")}
	c, err := w.CompileOrdered(t.Context(), project, OrderTsc, true)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	stockProject := Project{Files: map[string]string{"main.ts": counterpart, "stop.ts": doNeverStop}, Config: configuration("main.ts")}
	dir, err := w.writeProject(stockProject)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, stock, "-p", dir, "--pretty", "false")
	output, runErr := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatal(ctx.Err())
	}
	var want, got []string
	for line := range strings.SplitSeq(string(output), "\n") {
		if m := stockDiagnostic.FindStringSubmatch(line); m != nil && m[4] == "error" {
			want = append(want, "TS"+m[5])
		}
	}
	if runErr != nil && len(want) == 0 {
		t.Fatalf("stock compiler failed: %v\n%s", runErr, output)
	}
	writtenNames := doSourceTemporaryNames(map[string]string{"main.vibe": source})
	for _, d := range c.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			code := fmt.Sprintf("TS%d", d.Code())
			if IsEK(d) {
				code = fmt.Sprintf("EK%04d", d.Code())
			}
			got = append(got, code)
		}
		if name := compilerTemporaryName.FindString(doTemporaryDiagnosticText(d)); name != "" && !writtenNames[name] {
			Gap(t, doCompletionTarget, "temporary:"+key, "compiler name %s in diagnostic: %s", name, d)
		}
	}
	slices.Sort(want)
	slices.Sort(got)
	if !slices.Equal(want, got) {
		Gap(t, doCompletionTarget, "never:"+key, "VIP-2 %q; stock diagnostics %v, do diagnostics %v\n%s\n%s\n%v", doNeverCompletionQuote, want, got, output, source, c.Diagnostics)
	}
	for name, text := range c.Outputs {
		if strings.HasSuffix(name, ".d.ts") && compilerTemporaryName.MatchString(text) {
			Gap(t, doCompletionTarget, "declaration:"+key, "compiler temporary in %s:\n%s", name, text)
		}
	}
	ExpectPending(t, doCompletionTarget, "never:"+key)
}

// Generated variables have numbered names. Public runtime intrinsics such as
// $try are not variables introduced by lowering. Do not outlaw source names.
var compilerTemporaryName = regexp.MustCompile(`\$(?:do(?:_[A-Za-z]+|Match|Head)?|match|is|extracted|for)[0-9]+\b`)

// A longer identifier or a comment mentioning a temporary must not hide a
// generated-name leak. Explicit source identifiers and literal names remain legal.
func doSourceTemporaryNames(files map[string]string) map[string]bool {
	names := map[string]bool{}
	decode := scanner.NewScanner()
	for file, source := range files {
		switch filepath.Ext(file) {
		case ".vibe", ".vibex", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts":
		default:
			continue
		}
		for _, token := range toolsScan(source) {
			switch token.kind {
			case ast.KindIdentifier, ast.KindPrivateIdentifier, ast.KindStringLiteral, ast.KindNoSubstitutionTemplateLiteral:
			default:
				continue
			}
			decode.SetText(token.text)
			decode.Scan()
			name := strings.TrimPrefix(decode.TokenValue(), "#")
			if name != "" && compilerTemporaryName.FindString(name) == name {
				names[name] = true
			}
		}
	}
	return names
}

func TestDoNeverCompletionSourceNames(t *testing.T) {
	for _, sample := range []struct {
		source  string
		written bool
	}{
		{"let $do1;", true},
		{"let $do10;", false},
		{"// $do1\nlet value;", false},
		{"const text = 'prefix $do1';", false},
		{"const key = '$do1';", true},
		{"const pattern = /$do1/;", false},
		{"let $\\u0064o1;", true},
	} {
		names := doSourceTemporaryNames(map[string]string{"main.vibe": sample.source, "expected/messages.txt": "$do1"})
		if names["$do1"] != sample.written {
			t.Errorf("%q: written=%v; want %v", sample.source, names["$do1"], sample.written)
		}
	}
}

func doTemporaryDiagnosticText(d *ast.Diagnostic) string {
	text := d.String()
	for _, child := range d.MessageChain() {
		text += "\n" + doTemporaryDiagnosticText(child)
	}
	for _, child := range d.RelatedInformation() {
		text += "\n" + doTemporaryDiagnosticText(child)
	}
	return text
}

// Always run all cases, including pending and expected-error cases; -short
// does not sample this corpus-wide diagnostic invariant.
func TestCaseCorpusCompilerTemporaryDiagnostics(t *testing.T) {
	w := NewWorkspace(t)
	for _, seed := range CaseSeeds() {
		t.Run(seed.Name, func(t *testing.T) {
			// A compiler panic must fail this case without preventing the rest
			// of the diagnostic/declaration audit from running.
			defer func() {
				if failure := recover(); failure != nil {
					t.Errorf("compiler panic: %v\n%s", failure, debug.Stack())
				}
			}()
			c, err := w.CompileOrdered(t.Context(), Project{Files: seed.Files, Config: seed.Files["tsconfig.json"]}, OrderTsc, true)
			if err != nil {
				t.Fatal(err)
			}
			defer c.Remove()
			writtenNames := doSourceTemporaryNames(seed.Files)
			for _, d := range c.Diagnostics {
				for _, name := range compilerTemporaryName.FindAllString(doTemporaryDiagnosticText(d), -1) {
					if !writtenNames[name] {
						t.Errorf("compiler temporary %s in diagnostic: %s", name, d)
					}
				}
			}
			for output, text := range c.Outputs {
				if !strings.HasSuffix(output, ".d.ts") {
					continue
				}
				for _, name := range compilerTemporaryName.FindAllString(text, -1) {
					if !writtenNames[name] {
						t.Errorf("compiler temporary %s in declaration %s", name, output)
					}
				}
			}
		})
	}
}

// Keep the spec-derived keyed corpus on disk, including each original witness.
func TestDoNeverCompletionCorpus(t *testing.T) {
	for _, key := range []string{"d1", "d2", "d3", "d4", "d5", "d6", "position", "conditional", "logical", "finally", "parameter", "nested", "invalid", "outer-completion", "outer-receiver", "outer-conditional", "outer-finally", "outer-invalid", "outer-return"} {
		path := filepath.Join("testdata", "fuzz", doCompletionTarget, "never-"+key)
		if _, err := os.Stat(path); err != nil {
			t.Fatal(err)
		}
	}
}
