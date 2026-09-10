package compiler

import (
	"reflect"
	"strings"
	"testing"
)

const nativeConfigOptions = `"strict":true,"noUncheckedIndexedAccess":true,"exactOptionalPropertyTypes":true,"isolatedModules":true,"verbatimModuleSyntax":true,"useDefineForClassFields":true`

func TestPinnedForkNativeConfigValidation(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	validator := backend.(ConfigValidator)
	for _, tc := range []struct {
		name, source, code, excerpt string
	}{
		{"valid", `{"compilerOptions":{` + nativeConfigOptions + `}}`, "", ""},
		{"JSONC", "// comment\n{\"compilerOptions\":{" + nativeConfigOptions + ",},}", "", ""},
		{"emit option", `{"compilerOptions":{"target":"ES2022",` + nativeConfigOptions + `}}`, "", ""},
		{"unknown", `{"compilerOptions":{"mystery":true,` + nativeConfigOptions + `}}`, "VIBE6003", `"mystery"`},
		{"forbidden false", `{"compilerOptions":{"experimentalDecorators":false,` + nativeConfigOptions + `}}`, "VIBE6002", `"experimentalDecorators"`},
		{"false", `{"compilerOptions":{` + strings.Replace(nativeConfigOptions, `"strict":true`, `"strict":false`, 1) + `}}`, "VIBE6001", `"strict":false`},
		{"duplicate last value", `{"compilerOptions":{` + nativeConfigOptions + `,"strict":false}}`, "VIBE6001", `"strict":false`},
		{"missing", `{"compilerOptions":{}}`, "VIBE6001", "{}"},
		{"null options", `{"compilerOptions":null}`, "VIBE6001", `{"compilerOptions":null}`},
		{"extends is not read", `{"extends":"/this/path/must/not/be/read.json"}`, "VIBE6001", `{"extends":"/this/path/must/not/be/read.json"}`},
		{"empty", "", "VIBE6001", ""},
		{"whitespace", " \n \t", "VIBE6001", ""},
		{"Unicode positions", "// 😀\u2028{\"compilerOptions\":{\"not𝐀nOption\":false," + nativeConfigOptions + "}}", "VIBE6003", `"not𝐀nOption"`},
		{"escaped non-scalar option", `{"compilerOptions":{"str\ud800":true,` + nativeConfigOptions + `}}`, "VIBE6003", `"str\ud800"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := ConfigFile{Path: "configs/../config.json", Text: tc.source}
			got, err := validator.ValidateConfig(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			if tc.code == "" {
				if len(got.Diagnostics) != 0 {
					t.Fatalf("valid config: %+v", got.Diagnostics)
				}
			} else {
				if len(got.Diagnostics) == 0 || got.Diagnostics[0].Code != tc.code || got.Diagnostics[0].File != request.Path {
					t.Fatalf("got=%+v", got)
				}
				for _, issue := range got.Diagnostics {
					if issue.Span == nil || issue.Span.Start < 0 || issue.Span.Start+issue.Span.Length > utf16Extent(tc.source) {
						t.Fatalf("invalid source span: %+v", issue)
					}
				}
				if tc.excerpt != "" {
					start := strings.Index(tc.source, tc.excerpt)
					if start < 0 || got.Diagnostics[0].Span.Start != utf16Extent(tc.source[:start]) || got.Diagnostics[0].Span.Length != utf16Extent(tc.excerpt) {
						t.Fatalf("lost authored span for %q: %+v", tc.excerpt, got.Diagnostics[0])
					}
				}
			}
			// The CLI/tool query cannot diverge from compilation's early gate.
			compiled, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.vibe"}, Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `export const answer = 42;`}}, Lowering: LoweringInternal, ConfigFile: &request,
			})
			if err != nil || !reflect.DeepEqual(compiled.Diagnostics, got.Diagnostics) {
				t.Fatalf("compile/query diverged: %+v vs %+v err=%v", compiled.Diagnostics, got.Diagnostics, err)
			}
		})
	}
	t.Run("malformed JSON never becomes a valid configuration", func(t *testing.T) {
		for _, text := range []string{
			`{"compilerOptions":{` + nativeConfigOptions,
			`{"compilerOptions":{` + nativeConfigOptions + `} garbage}`,
			`{"compilerOptions":{` + strings.Replace(nativeConfigOptions, `true,`, `true `, 1) + `}}`,
		} {
			request := ConfigFile{Path: "tsconfig.json", Text: text}
			got, err := validator.ValidateConfig(ctx, request)
			if err != nil || len(got.Diagnostics) == 0 || !strings.HasPrefix(got.Diagnostics[0].Code, "TS") || got.Diagnostics[0].Phase != PhaseParse {
				t.Fatalf("malformed config accepted: %+v err=%v", got, err)
			}
			compiled, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `export const answer = 42;`}}, Lowering: LoweringInternal, ConfigFile: &request})
			if err != nil || !compiled.EmitSkipped || len(compiled.Artifacts) != 0 || !reflect.DeepEqual(compiled.Diagnostics, got.Diagnostics) {
				t.Fatalf("malformed compile: %+v err=%v", compiled, err)
			}
		}
	})
	t.Run("bounded data only", func(t *testing.T) {
		for _, request := range []ConfigFile{{Text: "{}"}, {Path: "x\x00.json", Text: "{}"}, {Path: "tsconfig.json", Text: strings.Repeat(" ", 2*1024*1024+1)}, {Path: strings.Repeat("x", 16*1024+1), Text: "{}"}} {
			if _, err := validator.ValidateConfig(ctx, request); err == nil {
				t.Fatal("invalid config request accepted")
			}
		}
	})
}
