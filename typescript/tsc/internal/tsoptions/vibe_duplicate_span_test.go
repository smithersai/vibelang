package tsoptions_test

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func TestVibeDuplicateSettingDiagnosticSpans(t *testing.T) {
	for _, name := range []string{"tsconfig.json", "vibe.config.json", "jsconfig.json"} {
		for _, key := range []string{"effectGlobals", "effectModules", "severities", "severity-entry"} {
			for _, value := range []string{`42`, `null`, `"invalid"`, `[]`} {
				t.Run(name+"/"+key+"/"+value, func(t *testing.T) {
					settings := fmt.Sprintf(`%q:true,%q:%s`, key, key, value)
					code := int32(3007)
					if key == "severities" {
						settings = `"severities":{},"severities":` + value
					}
					if key == "severity-entry" {
						settings = `"severities":{"EK4609":"off","EK4609":` + value + "}"
						code = 3006
					}
					text := "{\n" + `"vibe":{` + settings + `},"files":["main.ts"]}`
					fs := vfstest.FromMap(map[string]string{"/p/" + name: text, "/p/main.ts": "export {}"}, tspath.CaseSensitive)
					config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePath("/p/"+name), &core.CompilerOptions{}, nil, fs, nil)
					if len(errors) != 0 {
						t.Fatal(errors)
					}
					if len(config.Errors) != 1 || config.Errors[0].Code() != code {
						t.Fatalf("want EK%d, got %v", code, config.Errors)
					}
					d := config.Errors[0]
					if got := text[d.Pos():d.End()]; got != value {
						t.Fatalf("diagnostic labels overwritten %s instead of winning %s", got, value)
					}
				})
			}
		}
	}
}
