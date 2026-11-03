package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// D34's correspondence rule pairs preserved declarations with their own
// source. A synthetic declaration for a written loop binding is not the
// outer declaration merely because both bindings have the same name.
func TestOutputsShadowedHeadBindingMappings(t *testing.T) {
	heads := []struct{ key, text string }{
		{"for-of", "for (const %[1]s of []) {}"},
		{"for-in", "for (const %[1]s in {}) {}"},
		{"array-head", "for (const [%[1]s] of [[]]) {}"},
		{"object-head", "for (const { value: %[1]s } of []) {}"},
		{"nested-head", "for (const { value: [%[1]s] } of []) {}"},
		{"rest-head", "for (const [...%[1]s] of [[]]) {}"},
		{"parameter", "function read(%[1]s: number) {}"},
	}
	for _, head := range heads {
		for _, name := range []string{"x", "item", "π"} {
			t.Run(head.key+"/"+name, func(t *testing.T) {
				outer := "const " + name + " = 3;"
				writtenHead := fmt.Sprintf(head.text, name)
				source := outer + "\n" + writtenHead + "\n\n"
				column := UTF16Len(writtenHead[:strings.Index(writtenHead, name)])
				for _, tc := range []struct {
					key, generated string
					line, column   int
					bad            bool
				}{
					{"head-helper", "{\n  let " + name + ";\n}\n", 1, column, false},
					{"outer-wrong", outer + "\n", 1, column, true},
					{"helper-outside-statements", "{\n  let " + name + ";\n}\n", 3, 0, true},
				} {
					t.Run(tc.key, func(t *testing.T) {
						line, col := 0, 0
						if tc.key != "outer-wrong" {
							line, col = 1, 2
						}
						m := bindingIdentityMap(t, line, col, tc.line, tc.column)
						g := &Gaps{}
						(&OutputChecker{G: g}).checkStatementMappings("main.js", tc.generated, source, 0, m)
						if g.Any() != tc.bad {
							t.Fatalf("gaps %v, want failure %v", g.found, tc.bad)
						}
					})
				}
				g := &Gaps{}
				(&OutputChecker{G: g}).checkStatementMappings("main.js", outer+"\n", source, 0, SourceMap{})
				if !g.Any() {
					t.Fatal("unmapped preserved outer declaration was accepted")
				}
			})
		}
	}
}

// Name-only pairing still guards a unique declaration whose initializer was
// lowered: a map into an unrelated real statement must remain a failure.
func TestOutputsUniqueBindingMappingControls(t *testing.T) {
	const source = "const unique = 1;\nconst unrelated = 2;\n"
	const generated = "const unique = lowered();\n"
	for _, tc := range []struct {
		key  string
		line int
		bad  bool
	}{{"own", 0, false}, {"unrelated", 1, true}} {
		t.Run(tc.key, func(t *testing.T) {
			g := &Gaps{}
			(&OutputChecker{G: g}).checkStatementMappings("main.js", generated, source, 0, bindingIdentityMap(t, 0, 0, tc.line, 0))
			if g.Any() != tc.bad {
				t.Fatalf("gaps %v, want failure %v", g.found, tc.bad)
			}
		})
	}
}

func bindingIdentityMap(t *testing.T, generatedLine, generatedColumn, sourceLine, sourceColumn int) SourceMap {
	t.Helper()
	gen := sourcemap.NewGenerator("main.js", "", tspath.RootedDirectoryPath("/"), tspath.CaseSensitive)
	index := gen.AddSource(tspath.RootedFilePath("/main.vibe"))
	if err := gen.AddSourceMapping(generatedLine, core.UTF16Offset(generatedColumn), index, sourceLine, core.UTF16Offset(sourceColumn)); err != nil {
		t.Fatal(err)
	}
	return SourceMap{Mappings: gen.RawSourceMap().Mappings}
}

// Keep the original corpus case unchanged and run the existing compile/map
// oracle, rather than inventing a special expectation for its source bytes.
func TestOutputsRunningHeadSourceMapRegression(t *testing.T) {
	for _, seed := range CaseSeeds() {
		if seed.Name != "cov-ch002b-running-head-environment" {
			continue
		}
		files := make(map[string]string, len(seed.Files))
		for name, text := range seed.Files {
			files[name] = text
		}
		files["tsconfig.json"] = withEmitters(files["tsconfig.json"])
		archive := Archive(files)
		seedNames.Store(archive, "case "+seed.Name)
		CheckCompile(t, NewWorkspace(t), "FuzzCompile", archive)
		return
	}
	t.Fatal("exact named acceptance case is missing")
}

// Parser-created parameters can stand on an error's written name without
// being written bindings themselves. They must not make a real unique args
// binding ambiguous and hide its intentionally wrong lowered mapping.
func TestOutputsSyntheticAnchorsDoNotHideWrongMappings(t *testing.T) {
	for _, written := range []string{"args", `\u0061rgs`} {
		t.Run(written, func(t *testing.T) {
			source := "const " + written + " = 1;\nconst unrelated = 2;\nerror Child extends Base { value: number }\n"
			const generated = "const args = lowered();\n"
			for _, tc := range []struct {
				key  string
				line int
				bad  bool
			}{
				{"own", 0, false}, {"wrong", 1, true},
			} {
				t.Run(tc.key, func(t *testing.T) {
					g := &Gaps{}
					(&OutputChecker{G: g}).checkStatementMappings("main.js", generated, source, 0, bindingIdentityMap(t, 0, 0, tc.line, 0))
					if g.Any() != tc.bad {
						t.Fatalf("gaps %v, want failure %v", g.found, tc.bad)
					}
				})
			}
		})
	}
}

// A source name that reparsing also uses for a data constructor remains a
// real binding; duplicate companion views must not erase correspondence.
func TestOutputsWrittenCompanionBindingMappings(t *testing.T) {
	for _, tc := range []struct{ key, source, generated string }{
		{"data", "data Choice { One }\nconst unrelated = 2;\n", "const Choice = lowered();\n"},
		{"unicode", "const π = 1;\nconst unrelated = 2;\n", "const π = lowered();\n"},
		{"escaped", `const \u0075nique = 1;` + "\nconst unrelated = 2;\n", "const unique = lowered();\n"},
	} {
		t.Run(tc.key, func(t *testing.T) {
			for _, mapping := range []struct {
				key  string
				line int
				bad  bool
			}{{"own", 0, false}, {"wrong", 1, true}} {
				t.Run(mapping.key, func(t *testing.T) {
					g := &Gaps{}
					(&OutputChecker{G: g}).checkStatementMappings("main.js", tc.generated, tc.source, 0, bindingIdentityMap(t, 0, 0, mapping.line, 0))
					if g.Any() != mapping.bad {
						t.Fatalf("gaps %v, want failure %v", g.found, mapping.bad)
					}
				})
			}
		})
	}
}

func TestOutputsEscapedHeadBindingMapping(t *testing.T) {
	const source = `const \u0078 = 3;` + "\n" + `for (const \u0078 of []) {}` + "\n"
	const generated = "{\n  let x;\n}\n"
	g := &Gaps{}
	(&OutputChecker{G: g}).checkStatementMappings("main.js", generated, source, 0, bindingIdentityMap(t, 1, 2, 1, 11))
	if g.Any() {
		t.Fatalf("escaped written loop binding was paired with its outer binding: %v", g.found)
	}
}
