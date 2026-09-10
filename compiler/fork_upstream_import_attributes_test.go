package compiler

import (
	"strings"
	"testing"
)

// Upstream ee72eb0 adds TS1558. Pin the actual compiler behavior at both
// delivery profiles so a pin refresh cannot keep an older native executable
// or ignore an explicit request to check an ambient declaration. The spec
// leaves skipLibCheck configurable; the VibeLang profile defaults it to true.
func TestPinnedForkUpstreamImportAttributeModifiers(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, profile := range []struct {
		name     string
		entry    string
		kind     FileKind
		lowering LoweringMode
	}{
		{"typescript", "main.ts", FileKindTypeScript, LoweringTypeScript},
		{"vibelang", "main.vibe", FileKindVibeLang, LoweringInternal},
	} {
		for _, item := range []struct {
			name       string
			attributes string
			code       string
		}{
			{"readonly-first", `readonly type: "css"`, "TS1558"},
			{"readonly-later", `type: "css", readonly kind: "data"`, "TS1558"},
			{"other-invalid-modifier", `public type: "css"`, "TS1070"},
			{"plain-attributes", `type: "css"`, ""},
		} {
			t.Run(profile.name+"/"+item.name, func(t *testing.T) {
				declaration := `declare module "*.css" with { ` + item.attributes + ` } { const content: string; export default content; }`
				result, err := backend.Compile(ctx, CompileRequest{
					RootNames: []string{profile.entry, "styles.d.ts"},
					Files: []SourceFile{
						{Path: profile.entry, Kind: profile.kind, Text: "export const answer = 42"},
						{Path: "styles.d.ts", Kind: FileKindTypeScript, Text: declaration},
					},
					Lowering: profile.lowering,
					Options:  Options{"module": "ESNext", "noEmitOnError": true, "skipLibCheck": false},
				})
				if err != nil {
					t.Fatal(err)
				}
				if item.code == "" {
					if len(result.Diagnostics) != 0 || result.EmitSkipped || len(result.Artifacts) == 0 {
						t.Fatalf("valid attributes must compile and emit: %+v", result)
					}
					return
				}
				if len(result.Diagnostics) != 1 || result.Diagnostics[0].Code != item.code {
					t.Fatalf("want exactly %s, got %+v", item.code, result.Diagnostics)
				}
				if !result.EmitSkipped || len(result.Artifacts) != 0 {
					t.Fatal("invalid ambient attributes must suppress the complete project emit")
				}
				if item.code == "TS1558" && !strings.Contains(result.Diagnostics[0].Message, "readonly") {
					t.Fatalf("the upstream diagnostic lost its message: %+v", result.Diagnostics[0])
				}
			})
		}
	}
}

func TestPinnedForkSkipLibCheckOptions(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	compile := func(options Options) (CompileResult, error) {
		return backend.Compile(ctx, CompileRequest{
			RootNames: []string{"main.vibe", "dependency.d.ts"},
			Files: []SourceFile{
				{Path: "main.vibe", Kind: FileKindVibeLang, Text: "export const answer = 42"},
				{Path: "dependency.d.ts", Kind: FileKindTypeScript, Text: "declare const externalValue: MissingDeclarationType"},
			},
			Lowering: LoweringInternal, Options: options,
		})
	}
	for _, item := range []struct {
		name    string
		options Options
		checked bool
	}{
		{"default-skips", Options{}, false},
		{"true-skips", Options{"skipLibCheck": true}, false},
		{"false-checks", Options{"skipLibCheck": false}, true},
	} {
		t.Run(item.name, func(t *testing.T) {
			result, err := compile(item.options)
			if err != nil {
				t.Fatal(err)
			}
			if item.checked {
				if len(result.Diagnostics) != 1 || result.Diagnostics[0].Code != "TS2304" || !result.EmitSkipped || len(result.Artifacts) != 0 {
					t.Fatalf("explicit checking must refuse the invalid declaration and suppress emit: %+v", result)
				}
			} else if len(result.Diagnostics) != 0 || result.EmitSkipped || len(result.Artifacts) == 0 {
				t.Fatalf("the configured declaration-checking exemption was not respected: %+v", result)
			}
		})
	}
	for _, item := range []struct {
		name  string
		value any
	}{
		{"string", "false"}, {"number", 0}, {"null", nil},
		{"array", []any{}}, {"object", map[string]any{}},
	} {
		t.Run("invalid-"+item.name, func(t *testing.T) {
			if result, err := compile(Options{"skipLibCheck": item.value}); err == nil || !strings.Contains(err.Error(), "must be a boolean") {
				t.Fatalf("invalid skipLibCheck value was not refused: %+v, %v", result, err)
			}
		})
	}
}
