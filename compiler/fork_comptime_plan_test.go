package compiler

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestPinnedForkComptimePlan(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	planner := backend.(ComptimePlanner)
	makeRequest := func(text string) ComptimePlanRequest {
		return ComptimePlanRequest{Files: []InspectionSource{{Path: "main.ts", Text: text, ScriptKind: "typescript"}}, Target: "typescript-node", Inputs: []ComptimeTextInput{}, SchemaRuntimeImport: "bound:schema"}
	}
	apply := func(source string, edits []ComptimePlanEdit) string {
		t.Helper()
		units := utf16.Encode([]rune(source))
		var output strings.Builder
		cursor := 0
		for _, edit := range edits {
			if edit.At.File != "main.ts" && edit.At.File != "main.vibe" {
				continue
			}
			start, end := edit.At.Span.Start, edit.At.Span.Start+edit.At.Span.Length
			if start < cursor || end > len(units) {
				t.Fatal("invalid edit order", edits)
			}
			output.WriteString(string(utf16.Decode(units[cursor:start])))
			output.WriteString(edit.Text)
			cursor = end
		}
		output.WriteString(string(utf16.Decode(units[cursor:])))
		return output.String()
	}
	execute := func(source string, plan ComptimePlanResult) string {
		t.Helper()
		text := apply(source, plan.Edits)
		transpiled, err := backend.(Transpiler).Transpile(ctx, TranspileRequest{Files: []TranspileSource{{Path: "main.ts", Text: text}}, Options: Options{"target": "esnext", "module": "esnext"}})
		if err != nil || len(transpiled.Files) != 1 || transpiled.Files[0].EmitSkipped || len(transpiled.Files[0].Diagnostics) > 0 {
			t.Fatalf("%+v %v; source=%s", transpiled, err, text)
		}
		return runComptimeProgram(t, CompileResult{Artifacts: []Artifact{{Path: "main.js", Content: []byte(transpiled.Files[0].JavaScript)}}})
	}
	for _, tc := range []struct{ name, body, use, want string }{
		{"scalar", "return 40+2", "String(value)", "42"},
		{"native conditional scope", "const x=40;if(const x=2;x>0){return x+40}else{return x}", "String(value)", "42"},
		{"loop and mutation", "let total=0;for(let i=0;i<7;i++){total+=i};return total*2", "String(value)", "42"},
		{"object order", "return {z:1,a:2,10:3,2:4}", "JSON.stringify(value)", `{"2":4,"10":3,"z":1,"a":2}`},
		{"shared allocations", "const leaf={n:42};return {left:leaf,right:leaf}", "String(value.left===value.right)+':'+value.left.n", "true:42"},
		{"distinct allocations", "return {left:{n:42},right:{n:42}}", "String(value.left===value.right)", "false"},
		{"prototype key", `return JSON.parse('{"__proto__":{"n":42},"z":1}')`, "String(Object.hasOwn(value,'__proto__'))+':'+value.__proto__.n", "true:42"},
		{"Unicode data", "return {'🐱':'😀é'}", "JSON.stringify(value)", `{"🐱":"😀é"}`},
		{"JSON preserves property order", "return JSON.stringify({z:1,a:2})", "value", `{"z":1,"a":2}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import {comptime} from "vibelang:comptime";const value=comptime(()=>{` + tc.body + `})();export function main(){return ` + tc.use + `}`
			request := makeRequest(source)
			if tc.name == "native conditional scope" {
				request.Files[0].Path = "main.vibe"
			}
			plan, err := planner.PlanComptime(ctx, request)
			if err != nil || !plan.Complete || len(plan.Calls) != 1 {
				t.Fatalf("%+v %v", plan, err)
			}
			if !json.Valid([]byte(plan.Calls[0].ValueJSON)) {
				t.Fatal(plan.Calls[0].ValueJSON)
			}
			if got := execute(source, plan); got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
	t.Run("a marker is never invoked merely by being passed", func(t *testing.T) {
		source := `import {comptime} from "vibelang:comptime"; const never=comptime(()=>{while(true){}return 0});export function main(){return 42}`
		plan, err := planner.PlanComptime(ctx, makeRequest(source))
		if err != nil || !plan.Complete || len(plan.Calls) != 0 || execute(source, plan) != "42" {
			t.Fatalf("%+v %v", plan, err)
		}
	})
	t.Run("binding identity leaves lexical imposters ordinary", func(t *testing.T) {
		source := `import {comptime as build} from "vibelang:comptime";const value=build(40);function main(){function build(n:number){return n+2}return build(value)}export {main}`
		plan, err := planner.PlanComptime(ctx, makeRequest(source))
		if err != nil || !plan.Complete || len(plan.Calls) != 1 || execute(source, plan) != "42" {
			t.Fatalf("%+v %v", plan, err)
		}
	})
	t.Run("only reached text reads are requested and indexed", func(t *testing.T) {
		source := `import {comptime,embed} from "vibelang:comptime";const value=comptime(()=>{if(comptime.target==="typescript-node"){const name=embed("./name.txt");return embed(name)}return embed("./unselected.txt")})();export function main(){return value}`
		request := makeRequest(source)
		for _, selected := range []struct{ specifier, text string }{{"./name.txt", "./answer.txt"}, {"./answer.txt", "42"}} {
			plan, err := planner.PlanComptime(ctx, request)
			if err != nil || plan.Complete || len(plan.Calls) != 0 || len(plan.Edits) != 0 || len(plan.Diagnostics) != 0 || len(plan.Reads) != 1 || plan.Reads[0].Specifier != selected.specifier {
				t.Fatalf("%+v %v", plan, err)
			}
			request.Inputs = append(request.Inputs, ComptimeTextInput{File: "main.ts", Specifier: selected.specifier, Text: selected.text})
		}
		plan, err := planner.PlanComptime(ctx, request)
		if err != nil || !plan.Complete || len(plan.Calls) != 1 || len(plan.Calls[0].Inputs) != 2 || plan.Calls[0].Inputs[0] != 0 || plan.Calls[0].Inputs[1] != 1 || execute(source, plan) != "42" {
			t.Fatalf("%+v %v", plan, err)
		}
	})
	t.Run("missing input never reads an ambient file", func(t *testing.T) {
		request := makeRequest(`import {comptime,embed} from "vibelang:comptime";export const value=comptime(embed("/etc/passwd"));`)
		plan, err := planner.PlanComptime(ctx, request)
		if err != nil || plan.Complete || len(plan.Reads) != 1 || len(plan.Calls) != 0 {
			t.Fatalf("%+v %v", plan, err)
		}
		request.Inputs = []ComptimeTextInput{{File: "main.ts", Specifier: "/etc/passwd", Error: "outside compiler root"}}
		plan, err = planner.PlanComptime(ctx, request)
		if err != nil || plan.Complete || len(plan.Diagnostics) != 1 || plan.Diagnostics[0].Code != "VCT1004" || !strings.Contains(plan.Diagnostics[0].Message, "outside compiler root") {
			t.Fatalf("%+v %v", plan, err)
		}
	})
	t.Run("source observations name captured initializers in their own module", func(t *testing.T) {
		request := makeRequest("// 🐱\r\nimport {comptime} from 'vibelang:comptime';import {config} from './data.vibe';const value=comptime(config);")
		request.Files = append(request.Files, InspectionSource{Path: "data.vibe", Text: "// 😀\nexport const config={z:42,a:1};", ScriptKind: "typescript"})
		plan, err := planner.PlanComptime(ctx, request)
		if err != nil || !plan.Complete || len(plan.Calls) != 1 {
			t.Fatalf("%+v %v", plan, err)
		}
		origin := plan.Calls[0].MappedOrigin
		if origin.File != "data.vibe" || origin.Span.Start != utf16Extent("// 😀\nexport const config=") || origin.Span.Length != 10 {
			t.Fatal(origin)
		}
	})
	t.Run("cross-module failures point at the actual authored operation", func(t *testing.T) {
		request := makeRequest(`import {comptime} from "vibelang:comptime";import {work} from "./data.vibe";export const value=comptime(work)();`)
		request.Files = append(request.Files, InspectionSource{Path: "data.vibe", Text: "// 🐱\nexport function work(){return Date.now()}", ScriptKind: "typescript"})
		plan, err := planner.PlanComptime(ctx, request)
		if err != nil || plan.Complete || len(plan.Diagnostics) != 1 || plan.Diagnostics[0].At.File != "data.vibe" || plan.Diagnostics[0].Code != "VCT1004" {
			t.Fatalf("%+v %v", plan, err)
		}
	})
	t.Run("native checked schema and generated type alias plans", func(t *testing.T) {
		for _, source := range []string{
			`import {comptime} from "vibelang:comptime";import {Schema} from "vibelang:schema";type T={z:number};const value=comptime(Schema.derive<T>());`,
			`import {comptime} from "vibelang:comptime";const T=comptime({z:42});const value:T={z:42};`,
		} {
			plan, err := planner.PlanComptime(ctx, makeRequest(source))
			if err != nil || !plan.Complete || len(plan.Calls) != 1 {
				t.Fatalf("%+v %v", plan, err)
			}
			text := apply(source, plan.Edits)
			if strings.Contains(source, "Schema") {
				if !strings.Contains(text, "__vsSchema<T>") || !strings.Contains(text, "bound:schema") {
					t.Fatal(text)
				}
			} else {
				if !strings.Contains(text, "type T =") || strings.Contains(text, "const T=") {
					t.Fatal(text)
				}
			}
		}
	})
	for _, source := range []string{
		`import {comptime} from "vibelang:comptime";const good=comptime(42),bad=comptime(Math.random());`,
		`import {comptime} from "vibelang:comptime";const bad=comptime(()=>{while(true){}return 0})();`,
		`import {comptime} from "vibelang:comptime";const value=comptime(()=>{if(var x=1;x){return x}else{return 0}})();`,
		`import {comptime} from "vibelang:comptime";const value=comptime(Promise.resolve(1));`,
		`import {comptime} from "vibelang:comptime";const value=comptime(()=>{return process.env.HOME})();`,
	} {
		t.Run("fail closed "+source, func(t *testing.T) {
			plan, err := planner.PlanComptime(ctx, makeRequest(source))
			if err != nil || plan.Complete || len(plan.Diagnostics) == 0 || len(plan.Calls) > 0 || len(plan.Edits) > 0 {
				t.Fatalf("%+v %v", plan, err)
			}
		})
	}
}

func TestPinnedForkComptimePhaseBoundaries(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	planner := backend.(ComptimePlanner)
	for _, operation := range []string{`comptime.target`, `embed("./value.txt")`} {
		for _, call := range []string{`read()`, `[0].map(read)[0]`} {
			t.Run("retained helper "+operation+call, func(t *testing.T) {
				source := `import {comptime} from "vibelang:comptime";import {read} from "./helper.js";export const value=comptime(()=>` + call + `)();`
				parameters := ""
				if strings.Contains(call, "map") {
					parameters = "value,index,all"
				}
				helper := `import {comptime,embed} from "vibelang:comptime";export function read(` + parameters + `){return ` + operation + `}`
				plan, err := planner.PlanComptime(ctx, ComptimePlanRequest{Files: []InspectionSource{
					{Path: "main.ts", Text: source, ScriptKind: "typescript"}, {Path: "helper.ts", Text: helper, ScriptKind: "typescript"}},
					Target: "test", Inputs: []ComptimeTextInput{{File: "helper.ts", Specifier: "./value.txt", Text: "42"}}, SchemaRuntimeImport: "bound:schema"})
				if err != nil || plan.Complete || len(plan.Reads) != 0 || len(plan.Calls) != 0 || len(plan.Edits) != 0 {
					t.Fatalf("%+v %v", plan, err)
				}
				found := false
				for _, issue := range plan.Diagnostics {
					found = found || issue.Code == "VCT1006" && issue.At.File == "helper.ts"
				}
				if !found {
					t.Fatal(plan.Diagnostics)
				}
			})
		}
	}
	t.Run("phase-only inline callback is actually erased", func(t *testing.T) {
		source := `import {comptime,embed} from "vibelang:comptime";const value=comptime(()=>[0].map(value=>embed("./value.txt"))[0])();`
		plan, err := planner.PlanComptime(ctx, ComptimePlanRequest{Files: []InspectionSource{{Path: "main.ts", Text: source, ScriptKind: "typescript"}},
			Target: "test", Inputs: []ComptimeTextInput{{File: "main.ts", Specifier: "./value.txt", Text: "42"}}, SchemaRuntimeImport: "bound:schema"})
		if err != nil || !plan.Complete || len(plan.Calls) != 1 || len(plan.Calls[0].Inputs) != 1 || plan.Calls[0].Inputs[0] != 0 {
			t.Fatalf("%+v %v", plan, err)
		}
	})
	for _, module := range []string{"vibelang:comptime", "vibelang:schema"} {
		code, phaseCode := "VIBE1906", "VCT1006"
		if module == "vibelang:schema" {
			code, phaseCode = "VCT1203", "VCT1203"
		}
		for _, form := range []string{
			`export * from "MODULE";`,
			`export * as compiler from "MODULE";`,
			`export {comptime} from "MODULE";`,
			`import compiler = require("MODULE");`,
			`export import compiler = require("MODULE");`,
			`const pending = import("MODULE");`,
			"const pending = import(`MODULE`);",
		} {
			source := strings.ReplaceAll(form, "MODULE", module)
			t.Run(source, func(t *testing.T) {
				plan, err := planner.PlanComptime(ctx, ComptimePlanRequest{Files: []InspectionSource{{Path: "main.vibe", Text: source, ScriptKind: "typescript"}},
					Target: "test", Inputs: []ComptimeTextInput{}, SchemaRuntimeImport: "bound:schema"})
				if err != nil || plan.Complete || len(plan.Calls) > 0 || len(plan.Edits) > 0 {
					t.Fatalf("%+v %v", plan, err)
				}
				found := false
				for _, issue := range plan.Diagnostics {
					found = found || issue.Code == phaseCode
				}
				if !found {
					t.Fatal(plan.Diagnostics)
				}
				result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Files: comptimeSources(source), Lowering: LoweringInternal})
				if err != nil {
					t.Fatal(err)
				}
				requireComptimeDiagnostic(t, result, code)
			})
		}
	}
	for _, tc := range []struct{ source, file, kind, code, needle string }{
		{"\ncomptime(1);", "main.ts", "typescript", "VCT1001", "comptime"},
		{`import {Schema} from "vibelang:schema";`, "main.js", "javascript", "VCT1203", "import"},
		{`import {Schema} from "vibelang:schema";`, "main.jsx", "jsx", "VCT1203", "import"},
		{`import {comptime} from "vibelang:comptime";function grow(n){return grow(n+1)}const value=comptime(()=>grow(0))();`, "main.ts", "typescript", "VCT1012", "function grow"},
	} {
		t.Run(tc.source+tc.file, func(t *testing.T) {
			plan, err := planner.PlanComptime(ctx, ComptimePlanRequest{Files: []InspectionSource{{Path: tc.file, Text: tc.source, ScriptKind: tc.kind}},
				Target: "test", Inputs: []ComptimeTextInput{}, SchemaRuntimeImport: "bound:schema"})
			if err != nil || plan.Complete || len(plan.Diagnostics) != 1 || plan.Diagnostics[0].Code != tc.code ||
				plan.Diagnostics[0].At.Span.Start != strings.Index(tc.source, tc.needle) {
				t.Fatalf("%+v %v", plan, err)
			}
		})
	}
}
