package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func retainedErrorMigrationQuoted(t testing.TB) {
	t.Helper()
	text := SpecText("004-match.md")
	if !strings.Contains(SpecText("007-tooling.md"), "types, comments, and declaration output") {
		t.Fatal("missing preserving-fix declaration oracle")
	}
	for _, quote := range []string{"any extractor is `EK0704`", "call-only predicate", "declared return iterable"} {
		if !strings.Contains(text, quote) {
			t.Fatalf("missing migration oracle: %s", quote)
		}
	}
}

func TestRetainedErrorMigrationQuoted(t *testing.T) { retainedErrorMigrationQuoted(t) }

// Detail 100 rejects ordinary-class extractors; detail 94 admits call-only
// extraction. The preserving migration must reach that admitted form while
// keeping directives, comments, types and the fixer's idempotence guarantee.
// Mutate module bindings, arity, binding kind, namespaces and occupied names.
func FuzzRetainedErrorMigration(f *testing.F) {
	startShortBudget(f)
	retainedErrorMigrationQuoted(f)
	for _, seed := range []struct{ module, choices string }{{"csv", "000000"}, {"headers", "111111"}, {"socket", "222222"}, {"csv", "012345"}, {"headers", "543210"}, {"socket", "654321"}} {
		f.Add("retained-error-migration:" + seed.module + ":" + seed.choices)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		toolsGuard(t, "FuzzRetainedErrorMigration", func() {
			choices := strings.TrimPrefix(key, "retained-error-migration:")
			moduleKey, rest, keyed := strings.Cut(choices, ":")
			if keyed {
				choices = rest
			}
			if len(choices) == 0 {
				return
			}
			pick := func(n int) byte { return choices[n%len(choices)] }
			modules := []struct{ path, name string }{{"encoding/Csv", "CsvError"}, {"http/Headers", "HeaderParseError"}, {"socket/Socket", "SocketError"}}
			module := modules[int(pick(0))%len(modules)]
			switch moduleKey {
			case "csv":
				module = modules[0]
			case "headers":
				module = modules[1]
			case "socket":
				module = modules[2]
			}
			binding := "let"
			if pick(1)%2 != 0 {
				binding = "const"
			}
			pattern := ""
			switch pick(2) % 3 {
			case 1:
				pattern = binding + " value"
			case 2:
				pattern = binding + " first, " + binding + " second"
			}
			alias := fmt.Sprintf("Module%d", pick(3)%8)
			body := "/* KEEP */ export function inspect(s:unknown):boolean{return match(s){when " + alias + "." + module.name + "(" + pattern + "):true;default:false;}}\n"
			body += "export function extracted(s:unknown):infer _ {return match(s){when " + alias + "." + module.name + "(let value):value;default:undefined;}}\n"
			reference := "/* KEEP */ export function inspect(s:unknown):boolean{return false;}\n" +
				"export function extracted(s:unknown){return s instanceof " + alias + "." + module.name + " ? s : undefined;}\n"
			if pick(4)%2 != 0 {
				body = "export namespace Nested {" + body + "}\n"
				reference = "export namespace Nested {" + reference + "}\n"
			}
			source := "import * as " + alias + " from \"effect/" + module.path + "\";\n"
			if pick(5)%2 != 0 {
				source = "\"use client\";\n" + source + "const $legacyError=1, $legacyExtract=2, $legacyMatcherKey=3;\n"
			}
			files := map[string]string{"main.vibe": source + body, "reference.ts": source + reference}
			original := toolsCompile(t, w, "FuzzRetainedErrorMigration", files)
			defer original.Remove()
			if !toolsErrorFree(original) {
				t.Fatalf("invalid generated source: %v", SortedKeys(Keys(original.Dir, original.Diagnostics)))
			}
			config := toolsConfig(w, original.Dir)
			ordinary := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			if ordinary.Err != nil || len(ordinary.Files) != 0 {
				Gap(t, "FuzzRetainedErrorMigration", "migration:ordinary-write", "ordinary --fix changed a valid guard: %+v", ordinary)
			}
			migrated := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{MigrationOnly: true})
			if migrated.Err != nil || len(migrated.Files) != 1 || len(migrated.Refused) != 0 {
				Gap(t, "FuzzRetainedErrorMigration", "migration:missing", "preserving migration failed: %+v\n%s", migrated, Archive(files))
			}
			fixed := maps.Clone(files)
			for name, file := range migrated.Files {
				rel := strings.TrimPrefix(name.AsString(), filepath.ToSlash(original.Dir)+"/")
				if rel != "main.vibe" {
					Gap(t, "FuzzRetainedErrorMigration", "migration:scope", "migration wrote an unowned file: %s", rel)
				}
				fixed[rel] = file.Text
				if strings.Count(file.Text, "KEEP") != 1 {
					Gap(t, "FuzzRetainedErrorMigration", "migration:comment", "migration lost or duplicated its comment")
				}
				if strings.HasPrefix(source, "\"use client\"") && !strings.HasPrefix(file.Text, "\"use client\"") {
					Gap(t, "FuzzRetainedErrorMigration", "migration:directive", "migration moved its directive")
				}
			}
			after := toolsCompile(t, w, "FuzzRetainedErrorMigration", fixed)
			defer after.Remove()
			if !toolsErrorFree(after) {
				Gap(t, "FuzzRetainedErrorMigration", "migration:new-error", "migration introduced diagnostics: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), Archive(fixed))
			}
			declared, ok := after.Outputs["out/main.d.ts"]
			expected, refok := after.Outputs["out/reference.d.ts"]
			if !ok || !refok || declared != expected {
				Gap(t, "FuzzRetainedErrorMigration", "migration:declarations", "preserving migration changed inferred public declarations\nreference:\n%s\nmigrated:\n%s\n%s", expected, declared, Archive(fixed))
			}
			calls := 0
			for _, file := range after.Program.GetSourceFiles() {
				if !strings.HasSuffix(file.FileName().AsString(), "/main.vibe") {
					continue
				}
				c, done := after.Program.GetTypeCheckerForFile(t.Context(), file)
				var visit func(*ast.Node) bool
				visit = func(node *ast.Node) bool {
					if ast.IsCallExpression(node) && len(node.Arguments()) == 2 && ast.IsIdentifier(node.Expression()) && node.Expression().Flags&ast.NodeFlagsReparsed != 0 && node.Expression().Text() == "$extract" {
						calls++
						if len(c.GetSignaturesOfType(c.TypeOfPatternMatcher(node.Arguments()[0]), checker.SignatureKindConstruct)) != 0 {
							Gap(t, "FuzzRetainedErrorMigration", "migration:class-extractor", "preserving migration still emits a class extractor forbidden by detail 100")
						}
					}
					return node.ForEachChild(visit)
				}
				file.AsNode().ForEachChild(visit)
				done()
			}
			if calls == 0 {
				Gap(t, "FuzzRetainedErrorMigration", "migration:lost-extraction", "migration lost its extraction test:\n%s", Archive(fixed))
			}
			again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{MigrationOnly: true})
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				Gap(t, "FuzzRetainedErrorMigration", "migration:idempotence", "migration is not idempotent: %+v", again)
			}
		})
	})
}
