// VIP-30 invalid effective entry recovery with unrelated entries and native options retained.
// VIP-30 invalid effective entry recovery with unrelated entries and native options retained: docs/design/vips/0030-config-files.md#4c8704db13357b17
// VIP-30 invalid effective entry recovery with unrelated entries and native options retained: docs/design/vips/0030-config-files.md#e80f2cba515008b5
// VIP-30 invalid effective entry recovery with unrelated entries and native options retained: docs/design/vips/0030-config-files.md#aa2934cb29a8b6f2
// VIP-30 invalid effective entry recovery with unrelated entries and native options retained: docs/design/vips/0030-config-files.md#2a503a19304df002
// VIP-30 invalid effective entry recovery with unrelated entries and native options retained: docs/design/vips/0030-config-files.md#16cd7c19129f4d61
// VIP-30 invalid effective entry recovery with unrelated entries and native options retained: docs/design/vips/0030-config-files.md#24947322004ae10f
package tsoptions_test

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// Chapter 007 / invalid child severity does not restore base or discard siblings: docs/design/src/007-tooling.md#a93edda2dbfc32e0
// Chapter 007 / invalid child severity does not restore base or discard siblings: docs/design/src/007-tooling.md#69605d417661012f
// Chapter 007 / whole EK3801 and EK38100 severity keys: docs/design/src/007-tooling.md#40032308a488183d
// Chapter 007 / whole EK3801 and EK38100 severity keys: docs/design/src/007-tooling.md#b68573e481f09b49
func TestVibeInvalidSeverityShadowsBase(t *testing.T) {
	for _, code := range []string{"EK0801", "EK3801", "EK38100"} {
		for _, value := range []string{`"bad"`, `""`, `42`, `null`, `true`, `[]`, `{}`} {
			t.Run(code+"/"+value, func(t *testing.T) {
				base := fmt.Sprintf(`{"vibe":{"effectGlobals":false,"severities":{%q:"error","EK4609":"off"}}}`, code)
				text := fmt.Sprintf(`{"extends":"./base.json","vibe":{"effectModules":false,"severities":{%q:%s,"EK0508":"off"}},"files":["main.vibe"]}`, code, value)
				config := vibeConfig(t, text, base)
				if len(config.Errors) != 1 || config.Errors[0].Source() != "EK" || config.Errors[0].Code() != 3006 {
					t.Fatalf("want one EK3006: %v", config.Errors)
				}
				d := config.Errors[0]
				if text[d.Pos():d.End()] != value {
					t.Fatalf("wrong invalid-value span: %s", text[d.Pos():d.End()])
				}
				options := config.CompilerOptions().VibeLang
				want := map[string]string{"EK0508": "off", "EK4609": "off"}
				if !reflect.DeepEqual(options.Severities, want) {
					t.Fatalf("invalid child restored inherited severity: got %v, want %v", options.Severities, want)
				}
				if options.EffectGlobals != core.TSFalse || options.EffectModules != core.TSFalse {
					t.Fatal("independent options lost")
				}
				shown, err := json.Marshal(tsoptions.ConvertToTSConfig(config, "/project/tsconfig.json"))
				if err != nil {
					t.Fatal(err)
				}
				if strings.Contains(string(shown), code) {
					t.Fatalf("showConfig retained invalid override: %s", shown)
				}
				again := vibeConfig(t, string(shown), "{}")
				if len(again.Errors) != 0 || !reflect.DeepEqual(again.CompilerOptions().VibeLang.Severities, want) {
					t.Fatalf("effective settings do not round-trip: %s; %v", shown, again.Errors)
				}
			})
		}
	}
}

func TestVibeInvalidSeverityExtendsOrderAndCache(t *testing.T) {
	fs := vfstest.FromMap(map[string]string{
		"/p/a.json":         `{"vibe":{"effectGlobals":false,"severities":{"EK0801":"error","EK4609":"off"}}}`,
		"/p/b.json":         `{"extends":"./a.json","vibe":{"severities":{"EK0801":42,"EK0508":"off"}}}`,
		"/p/c.json":         `{"vibe":{"severities":{"EK0801":"suggestion"}}}`,
		"/p/main.vibe":      "export const n = 1",
		"/p/inherited.json": `{"extends":"./b.json","files":["main.vibe"]}`,
		"/p/diamond.json":   `{"extends":["./a.json","./b.json"],"files":["main.vibe"]}`,
		"/p/replaced.json":  `{"extends":["./a.json","./b.json","./c.json"],"files":["main.vibe"]}`,
		"/p/child.json":     `{"extends":"./b.json","vibe":{"severities":{"EK0801":"warning"}},"files":["main.vibe"]}`,
		"/p/sibling.json":   `{"extends":"./a.json","files":["main.vibe"]}`,
	}, tspath.CaseSensitive)
	cache := &memoCache{}
	for _, name := range []string{"inherited", "diamond", "replaced", "child", "sibling", "diamond"} {
		t.Run(name, func(t *testing.T) {
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePath("/p/"+name+".json"), &core.CompilerOptions{}, nil, fs, cache)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			wantErrors := 0
			if name == "inherited" || name == "diamond" {
				wantErrors = 1
			}
			if len(config.Errors) != wantErrors {
				t.Fatalf("effective config wants %d errors, got %v", wantErrors, config.Errors)
			}
			want := map[string]string{"EK4609": "off", "EK0508": "off"}
			switch name {
			case "replaced":
				want["EK0801"] = "suggestion"
			case "child":
				want["EK0801"] = "warning"
			case "sibling":
				want = map[string]string{"EK0801": "error", "EK4609": "off"}
			}
			if !reflect.DeepEqual(config.CompilerOptions().VibeLang.Severities, want) {
				t.Fatalf("extends order/cache changed: got %v, want %v", config.CompilerOptions().VibeLang.Severities, want)
			}
			if config.CompilerOptions().VibeLang.EffectGlobals != core.TSFalse {
				t.Fatal("unaffected inherited option lost")
			}
		})
	}
}

// VIP-30 / detail 208: validate entries after the extends merge, while retaining
// independent config errors and the winning invalid entry`s source span.
func TestVibeSeverityEffectiveDiagnostics(t *testing.T) {
	for _, name := range []string{"tsconfig.json", "vibe.config.json", "jsconfig.json"} {
		for _, value := range []string{`"bad"`, `42`, `null`, `true`, `[]`, `{}`} {
			for _, mode := range []string{"child", "later-base", "invalid-child", "inherited", "independent-key", "container", "unknown-option"} {
				t.Run(name+"/"+value+"/"+mode, func(t *testing.T) {
					base := fmt.Sprintf(`{"vibe":{"severities":{"EK4609":%s}}}`, value)
					child := `"extends":"./base.json","vibe":{"severities":{"EK4609":"off"}}`
					wantCode := int32(0)
					wantFile := "/p/base.json"
					switch mode {
					case "later-base":
						child = `"extends":["./base.json","./later.json"]`
					case "invalid-child":
						base = `{"vibe":{"severities":{"EK4609":"off"}}}`
						child = fmt.Sprintf(`"extends":"./base.json","vibe":{"severities":{"EK4609":%s}}`, value)
						wantCode, wantFile = 3006, "/p/"+name
					case "inherited":
						child, wantCode = `"extends":"./base.json"`, 3006
					case "independent-key":
						base = fmt.Sprintf(`{"vibe":{"severities":{"EK4609":%s,"EK0508":%s}}}`, value, value)
						wantCode = 3006
					case "container":
						base, wantCode = `{"vibe":{"severities":[]}}`, 3007
					case "unknown-option":
						base, wantCode = `{"vibe":{"unexpected":true}}`, 3007
					}
					fs := vfstest.FromMap(map[string]string{
						"/p/base.json":  base,
						"/p/later.json": `{"vibe":{"severities":{"EK4609":"off"}}}`,
						"/p/" + name:    `{` + child + `,"files":["main.vibe"]}`,
						"/p/main.vibe":  "export const n = 1",
					}, tspath.CaseSensitive)
					config, readErrors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePath("/p/"+name), &core.CompilerOptions{}, nil, fs, nil)
					if len(readErrors) != 0 {
						t.Fatal(readErrors)
					}
					if wantCode == 0 {
						if len(config.Errors) != 0 {
							t.Fatalf("overridden ancestor still fails: %v", config.Errors)
						}
					} else {
						if len(config.Errors) != 1 || config.Errors[0].Source() != "EK" || config.Errors[0].Code() != wantCode {
							t.Fatalf("want one EK%d, got %v", wantCode, config.Errors)
						}
						d := config.Errors[0]
						if d.File() == nil || d.File().FileName().AsString() != wantFile {
							t.Fatalf("wrong diagnostic origin: %v", d)
						}
						if wantCode == 3006 && d.File().Text()[d.Pos():d.End()] != value {
							t.Fatalf("wrong winning value span: %v", d)
						}
					}
				})
			}
		}
	}
}
