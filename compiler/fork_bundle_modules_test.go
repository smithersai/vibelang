package compiler

import (
	"strings"
	"testing"
)

func TestPinnedForkBundleModuleAnalysis(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(BundleModulesAnalyzer)
	request := func(source string) BundleModulesRequest {
		return BundleModulesRequest{Files: []TranspileSource{{Path: "main.ts", Text: source}, {Path: "lib/value.ts", Text: "export const value = 42;"}},
			RuntimeSpecifier: "test:runtime", RuntimeHelpers: []string{"__vsRegisterError", "__vsPerform", "ResultType"}, RegistrationExport: "__vsRegisterError"}
	}
	for _, tc := range []struct{ name, source, refusal string }{
		{"empty", "", ""},
		{"relative import", `import { value } from "./lib/value.ts"; export { value };`, ""},
		{"relative re-export", `export { value } from "./lib/value.ts";`, ""},
		{"relative wildcard re-export", `export * from "./lib/value.ts";`, ""},
		{"relative namespace re-export", `export * as values from "./lib/value.ts";`, ""},
		{"relative dynamic import", `export const value = import("./lib/value.ts");`, ""},
		{"relative import equals", `import value = require("./lib/value.ts");`, ""},
		{"relative require", `const value = require("./lib/value.ts");`, ""},
		{"type query erased", `type T = import("not-present").T;`, ""},
		{"allowed helper", `import { __vsPerform } from "test:runtime";`, ""},
		{"aliased helper", `import { __vsPerform as perform } from "test:runtime";`, ""},
		{"type helper", `import type { ResultType } from "test:runtime";`, ""},
		{"named type helper", `import { type ResultType } from "test:runtime";`, ""},
		{"external import", `import { value } from "external";`, "imports external module 'external'"},
		{"external wildcard", `export * from "external";`, "imports external module 'external'"},
		{"external namespace", `export * as x from "external";`, "imports external module 'external'"},
		{"external re-export", `export { x } from "external";`, "imports external module 'external'"},
		{"external dynamic import", `import("external");`, "imports external module 'external'"},
		{"external import equals", `import value = require("external");`, "imports external module 'external'"},
		{"computed dynamic import", `const name = "./lib/value.ts"; import(name);`, "non-literal import specifier"},
		{"template dynamic import", "import(`./lib/value.ts`);", "non-literal import specifier"},
		{"missing dynamic argument", `import();`, "non-literal import specifier"},
		{"missing closure file", `import { x } from "./missing.ts";`, "outside the checked source closure"},
		{"no extension substitution", `import { value } from "./lib/value.js";`, "outside the checked source closure"},
		{"no directory substitution", `import { value } from "./lib";`, "outside the checked source closure"},
		{"no escape", `import { x } from "../outside.ts";`, "escapes the checked source closure"},
		{"no host path", `import { x } from "/host.ts";`, "imports external module"},
		{"external raw require", `require("external");`, "imports external module 'external'"},
		{"computed raw require", `require(name);`, "non-literal import specifier"},
		{"shadowed require", `function f(require: (x: string) => number) { return require("not-an-import") }`, ""},
		{"host import meta", `export const url = import.meta.url;`, "import.meta"},
		{"runtime default", `import runtime from "test:runtime";`, "named bindings"},
		{"runtime namespace", `import * as runtime from "test:runtime";`, "named bindings"},
		{"runtime side effect", `import "test:runtime";`, "named bindings"},
		{"runtime mixed default", `import runtime, { __vsPerform } from "test:runtime";`, "named bindings"},
		{"runtime named re-export", `export { __vsPerform } from "test:runtime";`, "re-exports the compiler-owned"},
		{"runtime wildcard re-export", `export * from "test:runtime";`, "re-exports the compiler-owned"},
		{"runtime namespace re-export", `export * as x from "test:runtime";`, "re-exports the compiler-owned"},
		{"runtime dynamic import", `import("test:runtime");`, "imports external module"},
		{"runtime import equals", `import x = require("test:runtime");`, "imports external module"},
		{"unknown helper", `import { absent } from "test:runtime";`, "does not provide"},
		{"unknown type helper", `import type { absent } from "test:runtime";`, "does not provide"},
		{"invalid lowered syntax", `const x = ;`, "invalid lowered TypeScript"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := analyzer.BundleModules(ctx, request(tc.source))
			if err != nil || (len(got.Diagnostics) == 0) != (tc.refusal == "") || len(got.Registrations) != 0 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			if tc.refusal != "" && !strings.Contains(got.Diagnostics[0].Message, tc.refusal) {
				t.Fatalf("wanted %q, got=%+v", tc.refusal, got)
			}
		})
	}
	const prelude = `import { __vsRegisterError as register } from "test:runtime"; class Failed extends Error {}`
	for _, tc := range []struct{ name, source, identity, refusal string }{
		{"read issued identity", prelude + `register(Failed, "issued:Failed");`, "issued:Failed", ""},
		{"cooked identity", prelude + `register(Failed, "issued:\u0046ailed");`, "issued:Failed", ""},
		{"same registration twice", prelude + `register(Failed, "issued:Failed"); register(Failed, "issued:Failed");`, "issued:Failed", ""},
		{"parameter shadows imported binding", prelude + `function fake(register: Function) { register(Failed, "forged"); } register(Failed, "issued:Failed");`, "issued:Failed", ""},
		{"block shadows imported binding", prelude + `{ const register = (...args: any[]) => {}; register(Failed, "forged"); } register(Failed, "issued:Failed");`, "issued:Failed", ""},
		{"catch shadows imported binding", prelude + `try {} catch(register) { register(Failed, "forged"); } register(Failed, "issued:Failed");`, "issued:Failed", ""},
		{"shadowed same spelling only", prelude + `function fake(register: Function) { register(Failed, "forged"); }`, "", ""},
		{"not a runtime binding", `function __vsRegisterError(...args: any[]) {} class Failed {} __vsRegisterError(Failed, "forged");`, "", ""},
		{"type-only does not confer value authority", `import type { __vsRegisterError as register } from "test:runtime"; class Failed {} register(Failed, "forged");`, "", ""},
		{"malformed class", prelude + `register(class {}, "issued:Failed");`, "", "cannot read a compiler-issued identity"},
		{"computed identity", prelude + `register(Failed, "issued:" + "Failed");`, "", "cannot read a compiler-issued identity"},
		{"too few arguments", prelude + `register(Failed);`, "", "cannot read a compiler-issued identity"},
		{"too many arguments", prelude + `register(Failed, "issued:Failed", 42);`, "", "cannot read a compiler-issued identity"},
		{"conflicting registration", prelude + `register(Failed, "first"); register(Failed, "second");`, "", "two nominal identities"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := analyzer.BundleModules(ctx, request(tc.source))
			if err != nil || (len(got.Diagnostics) == 0) != (tc.refusal == "") {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			if tc.refusal != "" && !strings.Contains(got.Diagnostics[0].Message, tc.refusal) {
				t.Fatalf("wanted %q, got=%+v", tc.refusal, got)
			}
			if tc.identity == "" {
				if len(got.Registrations) != 0 {
					t.Fatalf("invented identity: %+v", got)
				}
			} else if len(got.Registrations) != 1 || got.Registrations[0] != (BundleRegistration{Path: "main.ts", ClassName: "Failed", Identity: tc.identity}) {
				t.Fatalf("lost compiler-issued identity: %+v", got)
			}
		})
	}
	t.Run("cross module ambiguity refuses all registrations", func(t *testing.T) {
		r := request(prelude + `register(Failed, "first");`)
		r.Files[1].Text = prelude + `register(Failed, "second");`
		got, err := analyzer.BundleModules(ctx, r)
		if err != nil || len(got.Diagnostics) != 1 || got.Diagnostics[0].Path != "lib/value.ts" || !strings.Contains(got.Diagnostics[0].Message, "two nominal identities") || len(got.Registrations) != 0 {
			t.Fatalf("got=%+v err=%v", got, err)
		}
	})
	for _, mutate := range []func(*BundleModulesRequest){
		func(r *BundleModulesRequest) { r.Files = nil },
		func(r *BundleModulesRequest) { r.Files = make([]TranspileSource, 4097) },
		func(r *BundleModulesRequest) { r.Files[1].Path = r.Files[0].Path },
		func(r *BundleModulesRequest) { r.Files[0].Path = "./main.ts" },
		func(r *BundleModulesRequest) { r.Files[0].Path = "main.vibe" },
		func(r *BundleModulesRequest) { r.Files[0].Path = "main.vibe.ts" },
		func(r *BundleModulesRequest) { r.Files[0].Path = "main.d.ts" },
		func(r *BundleModulesRequest) { r.Files[0].Path = "../main.ts" },
		func(r *BundleModulesRequest) { r.RuntimeSpecifier = "./runtime.ts" },
		func(r *BundleModulesRequest) { r.RuntimeHelpers = nil },
		func(r *BundleModulesRequest) { r.RuntimeHelpers = []string{"__vsRegisterError", "__vsRegisterError"} },
		func(r *BundleModulesRequest) { r.RuntimeHelpers = []string{""} },
		func(r *BundleModulesRequest) { r.RegistrationExport = "missing" },
	} {
		t.Run("invalid boundary", func(t *testing.T) {
			r := request("")
			mutate(&r)
			if got, err := analyzer.BundleModules(ctx, r); err == nil {
				t.Fatalf("invalid request accepted: %+v", got)
			}
		})
	}
}
