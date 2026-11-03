package tsoptions_test

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func TestVibexWildcardSourcePriority(t *testing.T) {
	rows := []struct {
		name       string
		extensions []string
		winner     string
	}{
		{"vibe-declaration", []string{".vibe", ".d.ts"}, ".vibe"},
		{"vibex-declaration", []string{".vibex", ".d.ts"}, ".vibex"},
		{"vibe-javascript", []string{".vibe", ".js"}, ".vibe"},
		{"vibex-javascript", []string{".vibex", ".js"}, ".vibex"},
		{"vibe-jsx", []string{".vibe", ".jsx"}, ".vibe"},
		{"vibex-jsx", []string{".vibex", ".jsx"}, ".vibex"},
		{"vibe-vibex-and-artifacts", []string{".vibe", ".vibex", ".d.ts", ".js", ".jsx"}, ".vibe"},
		{"native-ts-stays-first", []string{".ts", ".tsx", ".vibe", ".vibex", ".d.ts", ".js", ".jsx"}, ".ts"},
		{"native-tsx-stays-first", []string{".tsx", ".vibe", ".vibex", ".d.ts", ".js", ".jsx"}, ".tsx"},
		{"native-ts-control", []string{".ts", ".d.ts", ".js", ".jsx"}, ".ts"},
		{"native-tsx-control", []string{".tsx", ".d.ts", ".js", ".jsx"}, ".tsx"},
	}
	includes := [][]string{
		{"**/*"},
		{"**/*.d.ts", "**/*.js", "**/*.jsx", "**/*.vibex", "**/*.vibe", "**/*.tsx", "**/*.ts"},
		{"**/*.ts", "**/*.tsx", "**/*.vibe", "**/*.vibex", "**/*.jsx", "**/*.js", "**/*.d.ts"},
	}
	for _, row := range rows {
		for _, allowJS := range []bool{false, true} {
			for _, jsx := range []string{"preserve", "react"} {
				for _, explicit := range []bool{false, true} {
					for order, include := range includes {
						for _, cs := range []tspath.CaseSensitivity{tspath.CaseSensitive, tspath.CaseInsensitive} {
							t.Run(fmt.Sprintf("%s/js=%v/%s/files=%v/order=%d/case=%v", row.name, allowJS, jsx, explicit, order, cs), func(t *testing.T) {
								config := map[string]any{"compilerOptions": map[string]any{"allowJs": allowJS, "jsx": jsx}}
								fsFiles := map[string]string{}
								var names []string
								for _, ext := range row.extensions {
									name := "Panel" + ext
									names = append(names, name)
									fsFiles["/project/"+name] = "export const value = 1;"
								}
								want := []string{"Panel" + row.winner}
								if explicit {
									config["files"] = names
									want = slices.Clone(names)
								} else {
									config["include"] = include
								}
								text, err := json.Marshal(config)
								if err != nil {
									t.Fatal(err)
								}
								fsFiles["/project/tsconfig.json"] = string(text)
								fs := vfstest.FromMap(fsFiles, cs)
								parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
								if len(errors) != 0 {
									t.Fatal(errors)
								}
								var got []string
								for _, name := range parsed.FileNames() {
									got = append(got, strings.TrimPrefix(name.AsString(), "/project/"))
								}
								slices.Sort(got)
								slices.Sort(want)
								if !slices.Equal(got, want) {
									t.Fatalf("roots = %v; want %v", got, want)
								}
							})
						}
					}
				}
			}
		}
	}
}

func TestVibexLiteralWildcardPriority(t *testing.T) {
	for _, source := range []string{".vibe", ".vibex", ".ts", ".tsx"} {
		for _, artifact := range []string{".d.ts", ".js", ".jsx"} {
			for _, literalSource := range []bool{false, true} {
				for _, allowJS := range []bool{false, true} {
					for _, jsx := range []string{"preserve", "react"} {
						t.Run(fmt.Sprintf("%s/%s/source-literal=%v/js=%v/%s", source, artifact, literalSource, allowJS, jsx), func(t *testing.T) {
							sourceName, artifactName := "Panel"+source, "Panel"+artifact
							config := map[string]any{"compilerOptions": map[string]any{"allowJs": allowJS, "jsx": jsx}}
							want := []string{sourceName}
							if literalSource {
								config["files"] = []string{sourceName}
								config["include"] = []string{"**/*" + artifact}
							} else {
								config["files"] = []string{artifactName}
								config["include"] = []string{"**/*" + source}
								want = append(want, artifactName)
							}
							text, err := json.Marshal(config)
							if err != nil {
								t.Fatal(err)
							}
							fs := vfstest.FromMap(map[string]string{
								"/project/tsconfig.json":   string(text),
								"/project/" + sourceName:   "export const value=1;",
								"/project/" + artifactName: "export declare const stale: number;",
							}, tspath.CaseSensitive)
							parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
							if len(errors) != 0 {
								t.Fatal(errors)
							}
							var got []string
							for _, name := range parsed.FileNames() {
								got = append(got, strings.TrimPrefix(name.AsString(), "/project/"))
							}
							slices.Sort(got)
							slices.Sort(want)
							if !slices.Equal(got, want) {
								t.Fatalf("roots=%v want=%v", got, want)
							}
						})
					}
				}
			}
		}
	}
}
