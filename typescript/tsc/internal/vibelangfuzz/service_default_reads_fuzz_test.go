package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const serviceDefaultReadsTarget = "FuzzServiceDefaultReads"

// Appendix B, the EK4855 row (VIP-9 amended 2026-10-30).
const serviceDefaultReadsQuote = "migration of `static readonly default = shape` to `static readonly defaultValue = () => shape`, including the corresponding type and value reads"

func TestServiceDefaultReadsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("900-appendices.md"), serviceDefaultReadsQuote) {
		t.Fatalf("Appendix B no longer says %q; update the oracle", serviceDefaultReadsQuote)
	}
}

// A read of the legacy member, in a value or a type position. Each key names
// a corpus file; the fuzz bytes choose the declaration and the placement.
type serviceDefaultRead struct{ key, read, kind, shadow string }

var serviceDefaultReads = []serviceDefaultRead{
	{"value", "Flags.default", "value", ""},
	{"value-member", "Flags.default.enabled", "value", ""},
	{"element", "Flags[\"default\"]", "value", ""},
	{"typeof", "typeof Flags.default", "type", ""},
	{"typeof-member", "typeof Flags.default.enabled", "type", ""},
	{"indexed", "(typeof Flags)[\"default\"]", "type", ""},
	{"indexed-member", "(typeof Flags)[\"default\"][\"enabled\"]", "type", ""},
	{"typeof-projection", "(typeof Flags.default)[\"enabled\"]", "type", ""},
	{"typeof-shadow-local", "typeof Flags.default", "type", "local"},
	{"indexed-shadow-local", "(typeof Flags)[\"default\"]", "type", "local"},
	{"typeof-shadow-import", "typeof Flags.default", "type", "import"},
	{"indexed-shadow-import", "(typeof Flags)[\"default\"]", "type", "import"},
	{"typeof-shadow-nested", "typeof Flags.default", "type", "nested"},
	{"indexed-shadow-nested", "(typeof Flags)[\"default\"]", "type", "nested"},
	{"typeof-shadow-parameter", "typeof Flags.default", "type", "parameter"},
	{"indexed-shadow-parameter", "(typeof Flags)[\"default\"]", "type", "parameter"},
}

// serviceDefaultReadsProject writes a service with a legacy default and one
// read of it. annotated writes the member type; identifier initializes it
// from a constant; otherFile puts the read in a second module.
func serviceDefaultReadsProject(form serviceDefaultRead, annotated, identifier, otherFile bool) map[string]string {
	declaration := "export service Flags {\n static readonly key = \"fuzz/Flags\"\n static readonly default"
	if annotated {
		declaration += ": Flags.Shape"
	}
	initializer, prefix := "{ enabled: true, count: 2 }", ""
	if identifier {
		initializer, prefix = "flags", "const flags = { enabled: true, count: 2 }\n"
	}
	declaration += " = " + initializer + "\n enabled: boolean\n count: number\n}\n"
	statement := "export const read = " + form.read + "\n"
	if form.kind == "type" {
		statement = "export type Read = " + form.read + "\n"
	}
	switch form.shadow {
	case "local":
		statement = "type ReturnType<T> = { wrong: true }\n" + statement
	case "import":
		statement = "import type { ReturnType } from \"./shadow.vibe\"\n" + statement
	case "nested":
		statement = "export namespace Reads {\n type ReturnType<T> = { wrong: true }\n" + statement + "}\n"
	case "parameter":
		statement = strings.Replace(statement, "type Read =", "type Read<ReturnType = unknown> =", 1)
	}
	files := map[string]string{"main.vibe": prefix + declaration + statement}
	if otherFile {
		files = map[string]string{"flags.vibe": prefix + declaration, "main.vibe": "import { Flags } from \"./flags.vibe\"\n" + statement}
	}
	if form.shadow == "import" {
		files["shadow.vibe"] = "export type ReturnType<T> = { wrong: true }\n"
	}
	return files
}

// serviceDefaultReadType prints the type of the read in main.vibe, as a type
// alias would write it, so an alias name cannot stand in for its type.
func serviceDefaultReadType(t *testing.T, r *Result) string {
	t.Helper()
	file := r.SourceFile("main.vibe")
	if file == nil {
		t.Fatal("main.vibe is not in the program")
	}
	c, done := r.Program.GetTypeChecker(t.Context())
	defer done()
	var found *ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsTypeAliasDeclaration(node) && node.Name().Text() == "Read" {
			found = node.Name()
			return true
		}
		if ast.IsVariableDeclaration(node) && ast.IsIdentifier(node.Name()) && node.Name().Text() == "read" {
			found = node.Name()
			return true
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if found != nil {
		return c.TypeToStringEx(c.GetTypeAtLocation(found), nil, checker.TypeFormatFlagsInTypeAlias|checker.TypeFormatFlagsNoTruncation, nil)
	}
	t.Fatal("main.vibe declares no read")
	return ""
}

// Check the public declaration output as a consumer would: recheck the
// emitted declarations and expand Read/read there, rather than trusting the
// source checker's type alone. Keeping .vibe module names preserves the
// declaration emitter's relative imports in these isolated fixture files.
func serviceDefaultReadDeclarationType(t *testing.T, w *Workspace, form serviceDefaultRead, r *Result) string {
	t.Helper()
	files := map[string]string{}
	for name, text := range r.Outputs {
		if strings.HasSuffix(name, ".d.ts") {
			name = strings.TrimPrefix(name, "out/")
			files[strings.TrimSuffix(name, ".d.ts")+".vibe"] = text
		}
	}
	if len(files) == 0 {
		t.Fatal("no emitted declarations for legacy default read")
	}
	declaration := toolsCompile(t, w, serviceDefaultReadsTarget, files)
	defer declaration.Remove()
	if declaration.Program == nil || !toolsErrorFree(declaration) {
		Gap(t, serviceDefaultReadsTarget, "declaration:compile:"+form.key, "Appendix B %q: emitted declarations do not compile: %v\n%s", serviceDefaultReadsQuote, SortedKeys(Keys(declaration.Dir, declaration.Diagnostics)), Archive(files))
		return ""
	}
	return serviceDefaultReadType(t, declaration)
}

func serviceDefaultReadCodes(r *Result, code int32) int {
	count := 0
	for _, d := range r.Diagnostics {
		if IsEK(d) && d.Code() == code {
			count++
		}
	}
	return count
}

// checkServiceDefaultReads applies the Appendix B row: the original compiles
// with the EK4855 warning only, vibelang --fix rewrites the declaration and
// its reads together, the repaired project compiles with no error and no
// warning left, the read keeps its type, and a second run changes nothing.
func checkServiceDefaultReads(t *testing.T, w *Workspace, form serviceDefaultRead, files map[string]string) {
	t.Helper()
	TestServiceDefaultReadsQuoted(t)
	toolsGuard(t, serviceDefaultReadsTarget, func() {
		before := toolsCompile(t, w, serviceDefaultReadsTarget, files)
		defer before.Remove()
		if before.Program == nil || !toolsErrorFree(before) {
			Gap(t, serviceDefaultReadsTarget, "original:"+form.key, "Appendix B %q: the original does not compile: %v\n%s", serviceDefaultReadsQuote, SortedKeys(Keys(before.Dir, before.Diagnostics)), Archive(files))
			return
		}
		if serviceDefaultReadCodes(before, 4855) == 0 {
			Gap(t, serviceDefaultReadsTarget, "warning:"+form.key, "Appendix B %q: no EK4855 on the legacy default\n%s", serviceDefaultReadsQuote, Archive(files))
			return
		}
		typeBefore := serviceDefaultReadType(t, before)
		declarationBefore := serviceDefaultReadDeclarationType(t, w, form, before)
		config := toolsConfig(w, before.Dir)
		if config == nil || len(config.Errors) > 0 {
			t.Fatalf("config: %v", config)
		}
		var result *vibelang.FixResult
		toolsRun(t, serviceDefaultReadsTarget, "fix", Archive(files), nil, func() {
			result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
		})
		if result.Err != nil {
			Gap(t, serviceDefaultReadsTarget, "fix:error:"+form.key, "Appendix B %q: --fix failed: %v\n%s", serviceDefaultReadsQuote, result.Err, Archive(files))
			return
		}
		if len(result.Refused) > 0 {
			Gap(t, serviceDefaultReadsTarget, "fix:refused:"+form.key, "Appendix B %q: --fix refused %v\n%s", serviceDefaultReadsQuote, result.Refused, Archive(files))
			return
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			rel := strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")
			if _, own := files[rel]; !own {
				Gap(t, serviceDefaultReadsTarget, "fix:scope:"+form.key, "Appendix B %q: --fix changed %s\n%s", serviceDefaultReadsQuote, rel, Archive(files))
				return
			}
			fixed[rel] = file.Text
		}
		after := toolsCompile(t, w, serviceDefaultReadsTarget, fixed)
		defer after.Remove()
		if after.Program == nil || !toolsErrorFree(after) {
			Gap(t, serviceDefaultReadsTarget, "fix:new-error:"+form.key, "Appendix B %q: the repaired project reports %v\n%s\nfixed:\n%s", serviceDefaultReadsQuote, SortedKeys(Keys(after.Dir, after.Diagnostics)), Archive(files), Archive(fixed))
			return
		}
		if n := serviceDefaultReadCodes(after, 4855); n > 0 {
			Gap(t, serviceDefaultReadsTarget, "fix:incomplete:"+form.key, "Appendix B %q: %d EK4855 left after --fix\n%s\nfixed:\n%s", serviceDefaultReadsQuote, n, Archive(files), Archive(fixed))
			return
		}
		if typeAfter := serviceDefaultReadType(t, after); typeAfter != typeBefore {
			Gap(t, serviceDefaultReadsTarget, "fix:type:"+form.key, "Appendix B %q: the read was %s and is %s after --fix\n%s\nfixed:\n%s", serviceDefaultReadsQuote, typeBefore, typeAfter, Archive(files), Archive(fixed))
			return
		}
		if declarationAfter := serviceDefaultReadDeclarationType(t, w, form, after); declarationAfter != declarationBefore {
			Gap(t, serviceDefaultReadsTarget, "fix:declaration:"+form.key, "Appendix B %q: the exported declaration was %s and is %s after --fix\n%s\nfixed:\n%s", serviceDefaultReadsQuote, declarationBefore, declarationAfter, Archive(files), Archive(fixed))
			return
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) > 0 {
			Gap(t, serviceDefaultReadsTarget, "fix:fixed-point:"+form.key, "Appendix B %q: a second --fix changes %v (%v)\n%s", serviceDefaultReadsQuote, again.Order, again.Err, Archive(fixed))
			return
		}
		ExpectPending(t, serviceDefaultReadsTarget, form.key)
	})
}

func TestServiceDefaultReads(t *testing.T) {
	w := NewWorkspace(t)
	for _, form := range serviceDefaultReads {
		t.Run(form.key, func(t *testing.T) {
			checkServiceDefaultReads(t, w, form, serviceDefaultReadsProject(form, true, false, false))
		})
	}
}

// The input is the form key and one byte: bit 0 writes no member type, bit 1
// initializes from a constant, bit 2 reads from another module.
func FuzzServiceDefaultReads(f *testing.F) {
	startShortBudget(f)
	for _, form := range serviceDefaultReads {
		if form.shadow == "" {
			f.Add(form.key, uint8(0))
		}
	}
	f.Add("value", uint8(4))
	f.Add("typeof", uint8(4))
	f.Add("indexed", uint8(3))
	for _, scope := range []string{"local-shadow", "import-shadow", "value-only"} {
		f.Add("typeof:"+scope, uint8(0))
		f.Add("indexed-member:"+scope, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		base, scope, _ := strings.Cut(key, ":")
		i := slices.IndexFunc(serviceDefaultReads, func(form serviceDefaultRead) bool { return form.key == base })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(serviceDefaultReads)
		}
		form := serviceDefaultReads[i]
		files := serviceDefaultReadsProject(form, choice&1 == 0, choice&2 != 0, choice&4 != 0)
		if scope != "" {
			scopes := []string{"local-shadow", "import-shadow", "value-only"}
			if !slices.Contains(scopes, scope) {
				scope = scopes[int(scope[0])%len(scopes)]
			}
			TestChapter007ServiceReadHygieneQuoted(t)
			chapter007ServiceReadScope(files, scope)
			form.key += ":" + scope
		}
		checkServiceDefaultReads(t, w, form, files)
		ExpectPending(t, serviceDefaultReadsTarget, specCorpusKey(t))
	})
}
