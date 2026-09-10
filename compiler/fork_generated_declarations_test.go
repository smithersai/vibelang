package compiler

import (
	"reflect"
	"strings"
	"testing"
)

func TestPinnedForkNativeDeclarationText(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	declarations := backend.(DeclarationCompiler)
	row := DeclarationRows{Failures: []string{"Missing"}, Requirements: []string{"Clock"}}
	const source = "export declare function run(): string;\n"
	const annotated = "/** @vibelangModule {\"version\":2,\"runtimes\":[]} */\n/** @vibelangEffects {\"version\":2,\"failures\":[\"Missing\"],\"requirements\":[\"Clock\"],\"convention\":\"eager\"} */\n" + source
	got, err := declarations.DeclarationText(ctx, DeclarationTextRequest{Operation: "annotate", Path: "/generated/library.d.mts", Text: source, Effects: map[string]DeclarationRows{"run": row}})
	if err != nil || got.Text != annotated {
		t.Fatalf("canonical annotation: %+v err=%v", got, err)
	}
	read, err := declarations.DeclarationText(ctx, DeclarationTextRequest{Operation: "read", Path: "/generated/library.d.mts", Text: got.Text})
	if err != nil || !reflect.DeepEqual(read.Effects, map[string]DeclarationRows{"run": row}) {
		t.Fatalf("read rows: %+v err=%v", read, err)
	}

	for _, tc := range []struct{ name, source, runtime, want string }{
		{"named alias", `import {Result as R} from "sdk"; export declare function run(): R<string, never> | R<never, Missing>;`, "sdk", `R<string, Missing>`},
		{"namespace", `import * as NS from "sdk"; export declare function run(): Promise<NS.Result<string, never> | NS.Result<never, Missing>>;`, "sdk", `Promise<NS.Result<string, Missing>>`},
		{"import type", `export declare const run: () => import("sdk").Result<string, never> | import("sdk").Result<never, Missing>;`, "sdk", `import("sdk").Result<string, Missing>`},
		{"user Result", `interface Result<A,E>{a:A;e:E} export declare function run(): Result<string, never> | Result<never, Missing>;`, "sdk", ""},
		{"wrong import export", `import {Other as Result} from "sdk"; export declare function run(): Result<string, never> | Result<never, Missing>;`, "sdk", ""},
		{"wrong runtime", `import {Result} from "foreign"; export declare function run(): Result<string, never> | Result<never, Missing>;`, "sdk", ""},
		{"authored correlated union", `import {Result} from "sdk"; export declare function run(): Result<string, Missing> | Result<number, Error>;`, "sdk", ""},
		{"parameter is not return", `import {Result} from "sdk"; export declare function run(x: Result<string, never> | Result<never, Missing>): number;`, "sdk", ""},
		{"same empty channel", `import {Result} from "sdk"; export declare function run(): Result<string, never> | Result<number, never>;`, "sdk", ""},
		{"wrapper depth", `import {Result} from "sdk"; export declare function run(): ` + strings.Repeat("A<", 9) + `Result<string, never> | Result<never, Missing>` + strings.Repeat(">", 9) + `;`, "sdk", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := declarations.DeclarationText(ctx, DeclarationTextRequest{Operation: "normalize", Path: "/generated/main.d.mts", Text: tc.source, Effects: map[string]DeclarationRows{"run": row}, Runtimes: []string{tc.runtime}})
			if err != nil {
				t.Fatal(err)
			}
			if tc.want == "" && got.Text != tc.source || tc.want != "" && !strings.Contains(got.Text, tc.want) {
				t.Fatalf("unsafe normalization: %s", got.Text)
			}
		})
	}
	for _, text := range []string{
		`/** @vibelangEffects {"version":1,"failures":[],"requirements":["Clock"]} */ export declare function old(): number;`,
		`/** @vibelangEffects {"version":2,"failures":[],"requirements":["Clock"],"convention":"eager"} */ export declare function old(): number;`,
	} {
		got, err := declarations.DeclarationText(ctx, DeclarationTextRequest{Operation: "read", Path: "/generated/old.d.ts", Text: text})
		if err != nil || !reflect.DeepEqual(got.Effects["old"].Requirements, []string{"Clock"}) {
			t.Fatalf("historical/current inspection: %+v err=%v", got, err)
		}
	}
	for _, tc := range []struct {
		name    string
		request DeclarationTextRequest
	}{
		{"unknown operation", DeclarationTextRequest{Operation: "guess", Path: "/generated/x.d.ts"}},
		{"relative path", DeclarationTextRequest{Operation: "read", Path: "x.d.ts"}},
		{"malformed syntax", DeclarationTextRequest{Operation: "read", Path: "/generated/x.d.ts", Text: "export declare function ("}},
		{"source budget", DeclarationTextRequest{Operation: "read", Path: "/generated/x.d.ts", Text: strings.Repeat(" ", 2*1024*1024+1)}},
		{"row duplicates", DeclarationTextRequest{Operation: "annotate", Path: "/generated/x.d.ts", Text: source, Effects: map[string]DeclarationRows{"run": {Failures: []string{"Missing", "Missing"}, Requirements: []string{}}}}},
		{"null row", DeclarationTextRequest{Operation: "annotate", Path: "/generated/x.d.ts", Text: source, Effects: map[string]DeclarationRows{"run": {}}}},
		{"contradictory row", DeclarationTextRequest{Operation: "annotate", Path: "/generated/x.d.ts", Text: annotated, Effects: map[string]DeclarationRows{"run": {Failures: []string{}, Requirements: []string{}}}}},
		{"read overrides", DeclarationTextRequest{Operation: "read", Path: "/generated/x.d.ts", Text: source, Runtimes: []string{"sdk"}}},
		{"duplicate module", DeclarationTextRequest{Operation: "read", Path: "/generated/x.d.ts", Text: strings.Repeat("/** @vibelangModule {\"version\":2,\"runtimes\":[]} */\n", 2) + source}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := declarations.DeclarationText(ctx, tc.request); err == nil {
				t.Fatal("invalid declaration input accepted")
			}
		})
	}
}

func TestPinnedForkNativeGeneratedDeclarations(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	declarations := backend.(DeclarationCompiler)
	t.Run("typed output graph and literal identity", func(t *testing.T) {
		request := GeneratedDeclarationsRequest{Project: GeneratedProjectRequest{CurrentDirectory: "/generated", Files: []GeneratedProjectFile{
			{Path: "/generated/main.mjs", Text: `import {answer} from "./dep.js"; export const tag: "vibelang/runtime" = "vibelang/runtime"; export const result: number = answer;`},
			{Path: "/generated/dep.js", Text: `export const answer: number = 42;`},
		}}}
		got, err := declarations.EmitGeneratedDeclarations(ctx, request)
		if err != nil || !got.OK || len(got.Outputs) != 2 || len(got.Diagnostics) != 0 {
			t.Fatalf("graph emit: %+v err=%v", got, err)
		}
		if got.Outputs[0].Path != "/generated/dep.d.ts" || got.Outputs[1].Path != "/generated/main.d.mts" || !strings.Contains(got.Outputs[1].Text, `tag: "vibelang/runtime"`) {
			t.Fatalf("declaration identity: %+v", got)
		}
		request.Project.Files[1].Text = `// 😀` + "\u2028" + `export const 𝐀: number = "bad";`
		got, err = declarations.EmitGeneratedDeclarations(ctx, request)
		if err != nil || got.OK || len(got.Outputs) != 0 {
			t.Fatalf("emitted invalid root: %+v err=%v", got, err)
		}
		for _, issue := range got.Diagnostics {
			if issue.Code == "TS2322" && (issue.Span == nil || issue.Span.Length != 2) {
				t.Fatalf("lost UTF-16 span: %+v", issue)
			}
		}
	})
	t.Run("foreign declaration copy acquires no metadata", func(t *testing.T) {
		file := GeneratedProjectFile{Path: "/generated/foreign.d.mts", Text: "export declare class Plain { get value(): number; }\n"}
		got, err := declarations.EmitGeneratedDeclarations(ctx, GeneratedDeclarationsRequest{Project: GeneratedProjectRequest{CurrentDirectory: "/generated", Files: []GeneratedProjectFile{file}}})
		if err != nil || !got.OK || !reflect.DeepEqual(got.Outputs, []GeneratedProjectFile{file}) {
			t.Fatalf("foreign metadata inflation: %+v err=%v", got, err)
		}
	})
	t.Run("nested callable and accessor contracts", func(t *testing.T) {
		const row = `/** @vibelangEffects {"version":2,"failures":[],"requirements":["Clock"],"convention":"eager"} */ `
		file := GeneratedProjectFile{Path: "/generated/library.ts", Text: `export function factory() { return ` + row + `() => 42; } export const resource = { ` + row + `get value() { return 1; } };`}
		got, err := declarations.EmitGeneratedDeclarations(ctx, GeneratedDeclarationsRequest{Project: GeneratedProjectRequest{CurrentDirectory: "/generated", Files: []GeneratedProjectFile{file}}, Metadata: map[string]GeneratedDeclarationMetadata{file.Path: {Effects: map[string]DeclarationRows{}}}})
		if err != nil || !got.OK || len(got.Outputs) != 1 {
			t.Fatalf("callable emit: %+v err=%v", got, err)
		}
		text := got.Outputs[0].Text
		if strings.Count(text, "@vibelangModule") != 1 || strings.Count(text, "@vibelangEffects") != 2 || !strings.Contains(text, `@vibelangAccessor {"version":1,"enumerable":true}`) || !strings.Contains(text, "get value(): number") {
			t.Fatalf("lost nested contract: %s", text)
		}
	})
	for _, tc := range []struct {
		name    string
		request GeneratedDeclarationsRequest
	}{
		{"output collision", GeneratedDeclarationsRequest{Project: GeneratedProjectRequest{CurrentDirectory: "/generated", Files: []GeneratedProjectFile{{Path: "/generated/a.ts", Text: "export const x=1;"}, {Path: "/generated/a.js", Text: "export const y=2;"}}}}},
		{"metadata outside roots", GeneratedDeclarationsRequest{Project: GeneratedProjectRequest{CurrentDirectory: "/generated", Files: []GeneratedProjectFile{}}, Metadata: map[string]GeneratedDeclarationMetadata{"/generated/not-present.ts": {}}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := declarations.EmitGeneratedDeclarations(ctx, tc.request); err == nil {
				t.Fatal("invalid declaration request accepted")
			}
		})
	}
}
