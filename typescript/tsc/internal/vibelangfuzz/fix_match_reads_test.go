package vibelangfuzz

import (
	"fmt"
	"strconv"
	"strings"
	"testing"
)

var matchOperandReadKeys = []string{"tdz-value", "const-local-value", "getter-value", "getter-type", "nested-getter", "or-getter", "not-getter", "property-value", "property-type", "let-type", "computed-type", "const-value", "const-type", "import-type"}

const matchOperandReadQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."

func TestMatchOperandReadsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), matchOperandReadQuote) {
		t.Fatalf("chapter 007 no longer says %q", matchOperandReadQuote)
	}
}

// Keyed inputs drive the existing FuzzFix converter oracle. Operand getters
// record every observable read, including initialization before main is called.
// Local let, computed const, and imported bindings vary capture lifetime too.
func matchOperandReadsProject(input string) string {
	if !strings.HasPrefix(input, "match-operand-reads:") {
		return input
	}
	parts := strings.SplitN(strings.TrimPrefix(input, "match-operand-reads:"), ":", 2)
	key := parts[0]
	variant := ""
	if len(parts) > 1 {
		variant = parts[1]
	}
	n := 2
	for _, b := range []byte(variant) {
		n = (n + int(b)) % 7
	}
	n += 2
	if key == "tdz-value" {
		return Archive(map[string]string{"main.vibe": `import { Match } from "effect"
const trace:string[]=[]
function choose(value:number):string { return Match.value(value).pipe(Match.when(1,():string=>"first"),Match.when(ready,():string=>"second"),Match.orElse(():string=>"miss")) }
const early=(():string=>{try{return choose(1)}catch{trace.push("tdz");return "tdz"}})()
const ready=2
export function traceOf():string[]{return [...trace]}
export effect function main():string!! { return early }
`})
	}
	setup, operand := "", "holder.ready"
	switch key {
	case "getter-value", "getter-type", "nested-getter", "or-getter", "not-getter":
		setup = "const holder = { get ready(): 2 { trace.push('read:ready'); return 2 } };"
	case "property-value", "property-type":
		setup = "const holder = { ready: 2 as const };"
	case "let-type":
		setup, operand = "let ready: 1 | 2 = 2;", "ready"
	case "computed-type":
		setup, operand = "const ready: 2 = ((): 2 => { trace.push('initialize'); return 2 })();", "ready"
	case "const-value", "const-type", "const-local-value":
		setup, operand = "const ready = 2;", "ready"
	case "import-type":
		setup, operand = "import { ready } from './constant.js';", "ready"
	default:
		return input
	}
	start, inputType := "Match.value(value)", "number"
	if strings.HasSuffix(key, "-type") {
		start = "Match.type<number>()"
	}
	if key == "nested-getter" {
		operand, inputType = "{ key: holder.ready }", "{ key?: number }"
	}
	stage := "Match.when(" + operand + ", (): string => { trace.push('handler:hit'); return 'hit' })"
	if key == "or-getter" {
		stage = "Match.whenOr(0, " + operand + ", (): string => { trace.push('handler:hit'); return 'hit' })"
	}
	if key == "not-getter" {
		stage = "Match.not(" + operand + ", (): string => { trace.push('handler:hit'); return 'hit' })"
	}
	chain := start + ".pipe(" + stage + ", Match.orElse((): string => { trace.push('handler:miss'); return 'miss' }))"
	if key == "getter-value" || key == "property-value" || key == "not-getter" {
		chain = start + ".pipe(Match.when(1, (): string => { trace.push('handler:first'); return 'first' }), " + stage + ", Match.orElse((): string => { trace.push('handler:miss'); return 'miss' }))"
	}
	choose := "function choose(value: " + inputType + "): string { trace.push('subject'); return " + chain + " }"
	if key == "const-local-value" {
		choose = strings.Replace(choose, "{ trace.push", "{ "+setup+" trace.push", 1)
		setup = ""
	}
	if strings.HasSuffix(key, "-type") {
		choose = "const choose = " + chain + ";"
	}
	calls := ""
	for i := 0; i < n; i++ {
		value := strconv.Itoa(i%3 + 1)
		if key == "or-getter" {
			value = strconv.Itoa(i % 3)
		}
		if key == "nested-getter" {
			value = "{ key: " + value + " }"
			if i%3 == 0 {
				value = "{}"
			}
		}
		calls += fmt.Sprintf("trace.push('call:%d'); values.push(choose(%s)); ", i, value)
	}
	mutation := ""
	if key == "let-type" {
		mutation = "ready = 1;"
	}
	source := "// fuzz:match-operand-reads\nimport { Match } from 'effect';\nconst trace: string[] = [];\n" + setup + "\n" + choose + "\n" + mutation +
		"\nexport function traceOf(): string[] { return [...trace] }\nexport effect function main(): string[]!! {\n const values: string[] = [];\n" +
		calls + "\n return values\n}\n"
	return Archive(map[string]string{
		"main.vibe":   source,
		"constant.ts": "export const ready = 2;\n",
	})
}

// Do not let malformed templates silently bypass FuzzFix's runtime oracle.
func TestMatchOperandReadsProjects(t *testing.T) {
	w := NewWorkspace(t)
	for _, key := range matchOperandReadKeys {
		t.Run(key, func(t *testing.T) {
			files := toolsUnarchive(matchOperandReadsProject("match-operand-reads:" + key + ":seed"))
			r := toolsCompile(t, w, "FuzzFix", files)
			defer r.Remove()
			if !toolsErrorFree(r) {
				t.Fatalf("invalid operand-read template %s: %v", key, r.Diagnostics)
			}
			if len(toolsRunnableExports(r)) != 1 {
				t.Fatal("operand-read template has no runnable Effect entry")
			}
		})
	}
}
