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
