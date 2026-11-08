package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

const serviceDefaultReadsTarget = "FuzzServiceDefaultReads"

// Appendix B, the EK4855 row (VIP-9 amended 2026-10-30).
const serviceDefaultReadsDeclarationsQuote = "Ordinary declarations use the native twin's relative specifiers"

const serviceDefaultReadsQuote = "preserving migration of a service's cached `static readonly default` to an equivalent native `Context.Service` class; retain its key, eager initialization, cached identity, field and type reads, mutable shape members and missing-provider failure, or refuse"

func TestServiceDefaultReadsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), serviceDefaultReadsDeclarationsQuote) {
		t.Fatalf("chapter 7 no longer says %q; update the declaration consumer", serviceDefaultReadsDeclarationsQuote)
	}
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
		statement = "import type { ReturnType } from \"./shadow.js\"\n" + statement
	case "nested":
		statement = "export namespace Reads {\n type ReturnType<T> = { wrong: true }\n" + statement + "}\n"
	case "parameter":
		statement = strings.Replace(statement, "type Read =", "type Read<ReturnType = unknown> =", 1)
	}
	files := map[string]string{"main.vibe": prefix + strings.TrimPrefix(declaration, "export ") + statement}
	if otherFile {
		files = map[string]string{"flags.vibe": prefix + declaration, "main.vibe": "import { Flags } from \"./flags.js\"\n" + statement}
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
	return serviceDefaultReadModuleType(t, r, "main.vibe")
}

func serviceDefaultReadModuleType(t *testing.T, r *Result, name string) string {
	t.Helper()
	file := r.SourceFile(name)
	if file == nil {
		t.Fatalf("%s is not in the program", name)
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
	t.Fatalf("%s declares no read", name)
	return ""
}

// Check the public declaration output as a consumer would: recheck the
// emitted declarations and expand Read/read there, rather than trusting the
// source checker's type alone. Ordinary declarations retain their emitted
// .d.ts names so native relative specifiers resolve as they do for consumers.
func serviceDefaultReadDeclarationType(t *testing.T, w *Workspace, form serviceDefaultRead, r *Result) string {
	t.Helper()
	files := map[string]string{}
	for name, text := range r.Outputs {
		if strings.HasSuffix(name, ".d.ts") {
			name = strings.TrimPrefix(name, "out/")
			files[name] = text
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
	return serviceDefaultReadModuleType(t, declaration, "main.d.ts")
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
