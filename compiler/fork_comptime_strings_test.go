package compiler

import (
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
)

// Runtime JavaScript is the semantic comparison here, not another compiler
// library. The native interpreter and both native emission paths must preserve
// the same UTF16 values, property names, case mappings and replacement rules.
func TestPinnedForkComptimeStringSemantics(t *testing.T) {
	expressions := []string{
		`"\ud800"`, `"\udfff"`, `"\ud800".length`, `"\ud800\ud800".length`,
		`"\ud83d"+"\ude00"`, `("\ud83d"+"\ude00")==="😀"`,
		`"\\ud83d"+"\ude00"`, `JSON.stringify("\\ud83d"+"\ude00")`,
		`JSON.parse('"\\ud800"')`, `JSON.parse('"\ud800"')`,
		`JSON.parse('{"\\ud800":42,"z":1}')`,
		`Object.keys(JSON.parse('{"\\udfff":1,"😀":2,"\\ud800":3}'))`,
		`"😀".slice(0,1)`, `"😀".slice(1)`, `"\ud800x".slice(0,1)`,
		`"😀".split("")`, `"\ud800x".split("")`, `"".split("")`, `"".split("x")`,
		`"😀".split("\ud83d")`, `"x😀y".split("\ude00")`,
		`"😀".includes("\ud83d")`, `"😀".startsWith("\ud83d")`, `"😀".endsWith("\ude00")`,
		`"a😀b😀".indexOf("\ude00")`, `"a😀b😀".lastIndexOf("\ud83d")`, `"aaaa".lastIndexOf("aa")`,
		`"😀".indexOf("")`, `"😀".lastIndexOf("")`,
		`"abc".replaceAll("","-")`, `"😀".replaceAll("","-")`,
		`"😀😀".replaceAll("\ud83d","x")`, `"aba".replaceAll("a","$&")`,
		`"aba".replaceAll("a","$$-$&-$1-$<x>-$")`,
		"\"aba\".replaceAll(\"a\",\"$`-$'\")", `"a".replaceAll("","$&")`,
		`"x".padStart(2,"😀")`, `"x".padEnd(2,"😀")`, `"\ude00".padStart(2,"\ud83d")`,
		`"\ud800".repeat(2)`, `"".repeat(9007199254740991)`,
		`"straße".toUpperCase()`, `"ΟΣ".toLowerCase()`, `"İ".toLowerCase()`,
		`"\ud800A\udfff".toLowerCase()`, `"\ud800a\udfff".toUpperCase()`, `"\ufeff\ud800\u2028".trim()`,
		`"\ud800"<"\ue000"`, `"😀"<"\ue000"`,
	}
	expression := "[" + strings.Join(expressions, ",") + "]"
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("Node is required for the runtime semantic comparison")
	}
	want, err := exec.Command(node, "--input-type=module", "--eval", "process.stdout.write(JSON.stringify("+expression+"))").CombinedOutput()
	if err != nil {
		t.Fatalf("runtime comparison failed: %v %s", err, want)
	}
	source := `import {comptime} from "vibelang:comptime";const value=comptime(` + expression + `);export function main(){return JSON.stringify(value)}`
	compiled := compileComptime(t, comptimeSources(source), nil)
	requireClean(t, compiled)
	if got := runComptimeProgram(t, compiled); got != string(want) {
		t.Fatalf("native lowered value changed:\ngot  %s\nwant %s", got, want)
	}
	backend, ctx := newPinnedTestBackend(t)
	plan, err := backend.(ComptimePlanner).PlanComptime(ctx, ComptimePlanRequest{
		Files: []InspectionSource{{Path: "main.ts", Text: source, ScriptKind: "typescript"}}, Target: "typescript-node", SchemaRuntimeImport: "bound:schema", Inputs: []ComptimeTextInput{},
	})
	if err != nil || !plan.Complete || len(plan.Calls) != 1 {
		t.Fatalf("%+v %v", plan, err)
	}
	var output strings.Builder
	cursor := 0
	// Source contains literal astral characters: offsets are UTF16, not bytes.
	// Apply via the transport's known call/import identities without inventing
	// a second parser or relying on byte counts for UTF16 spans.
	for _, edit := range plan.Edits {
		start, end := comptimeTestUTF16ByteOffset(source, edit.At.Span.Start), comptimeTestUTF16ByteOffset(source, edit.At.Span.Start+edit.At.Span.Length)
		output.WriteString(source[cursor:start])
		output.WriteString(edit.Text)
		cursor = end
	}
	output.WriteString(source[cursor:])
	emitted, err := backend.(Transpiler).Transpile(ctx, TranspileRequest{Files: []TranspileSource{{Path: "main.ts", Text: output.String()}}, Options: Options{"module": "esnext", "target": "esnext"}})
	if err != nil || len(emitted.Files) != 1 || emitted.Files[0].EmitSkipped || len(emitted.Files[0].Diagnostics) > 0 {
		t.Fatalf("%+v %v", emitted, err)
	}
	got := runComptimeProgram(t, CompileResult{Artifacts: []Artifact{{Path: "main.js", Content: []byte(emitted.Files[0].JavaScript)}}})
	if got != string(want) {
		t.Fatalf("phase-planned value changed:\ngot  %s\nwant %s", got, want)
	}
}

func comptimeTestUTF16ByteOffset(text string, offset int) int {
	units := 0
	for at, character := range text {
		if units == offset {
			return at
		}
		units++
		if character > 0xffff {
			units++
		}
	}
	if units == offset {
		return len(text)
	}
	panic("test selected a non-boundary UTF16 offset")
}

func TestPinnedForkComptimeJSONAndStringRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, value := range []string{"01", "1.", ".1", "1e", "1e+", "-", "--1", "+1", "-0", "-0e0", "-1e-9999", "[1,]", "{\"x\":1,}", "\"a\nb\"", "\"a\tb\"", "\"\x00\""} {
		t.Run("JSON "+value, func(t *testing.T) {
			encoded, _ := json.Marshal(value)
			source := `import {comptime} from "vibelang:comptime"; const value=comptime(JSON.parse(` + string(encoded) + `));`
			plan, err := backend.(ComptimePlanner).PlanComptime(ctx, ComptimePlanRequest{Files: []InspectionSource{{Path: "main.ts", Text: source, ScriptKind: "typescript"}}, Target: "test", SchemaRuntimeImport: "bound:schema", Inputs: []ComptimeTextInput{}})
			if err != nil || plan.Complete || len(plan.Diagnostics) != 1 || plan.Diagnostics[0].Code != "VCT1005" || len(plan.Edits) != 0 || len(plan.Calls) != 0 {
				t.Fatalf("%+v %v", plan, err)
			}
		})
	}
	for _, expression := range []string{`"ab".repeat(9007199254740991)`, `"x".repeat(1000000).replaceAll("x","xx")`, `"ß".repeat(600000).toUpperCase()`} {
		t.Run("budget "+expression, func(t *testing.T) {
			source := `import {comptime} from "vibelang:comptime"; const value=comptime(` + expression + `);`
			plan, err := backend.(ComptimePlanner).PlanComptime(ctx, ComptimePlanRequest{Files: []InspectionSource{{Path: "main.ts", Text: source, ScriptKind: "typescript"}}, Target: "test", SchemaRuntimeImport: "bound:schema", Inputs: []ComptimeTextInput{}})
			if err != nil || plan.Complete || len(plan.Diagnostics) != 1 || plan.Diagnostics[0].Code != "VCT1012" || len(plan.Edits) != 0 || len(plan.Calls) != 0 {
				t.Fatalf("%+v %v", plan, err)
			}
		})
	}
}
