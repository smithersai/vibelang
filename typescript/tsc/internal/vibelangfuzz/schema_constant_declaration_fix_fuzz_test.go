package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// FuzzSchemaConstantDeclarationFix enforces Chapter 7: "A quick fix is
// offered only when it preserves evaluation order, coldness, types, comments,
// and declaration output; otherwise the diagnostic explains why it has no
// automatic fix." with Chapter 6's "Without one, the same bare alias is
// synthesized": a schema declaration declares typeof X.Type under its name
// unless a written alias stands beside it. The input picks how a module
// declares a Schema.Struct constant (private, exported, through an export
// list or a renamed one, or export default), whether its own type is written
// beside it, how the module refers to it (not at all, as a value, in a type
// query, through Schema.Schema.Type, in an inferred type, or inside a
// function) and whether it stands in a namespace. The compiler is compared
// with itself on two inputs the chapter says must agree: in a project that
// emits declarations, the module and what vibelang --fix writes for it emit
// the same declaration bytes. opencode's xai-responses protocol gained
// type Options = typeof Options.Type when --fix rewrote a private constant
// its exported OptionsInput type queried.
func FuzzSchemaConstantDeclarationFix(f *testing.F) {
	startShortBudget(f)
	schemaConstantDeclarationQuotes(f)
	for _, seed := range schemaConstantDeclarationSeeds {
		f.Add([]byte("schema-decl:" + seed))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckSchemaConstantDeclarationFix(t, w, parseSchemaConstantDeclaration(data))
	})
}

// TestSchemaConstantDeclarationFixQuoted fails when a chapter rewords a
// sentence the oracle quotes (RULES.md 9).
func TestSchemaConstantDeclarationFixQuoted(t *testing.T) { schemaConstantDeclarationQuotes(t) }

func schemaConstantDeclarationQuotes(tb testing.TB) {
	tb.Helper()
	for chapter, quote := range map[string]string{
		"007-tooling.md": "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix.",
		"006-data.md":    "Without one, the same bare alias is synthesized",
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			tb.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

// Each seed is export:own:use:scope. Every value of each dimension appears,
// and every reference the declaration file prints meets a private constant.
var schemaConstantDeclarationSeeds = []string{
	"private:none:query:module",
	"private:none:helper:module",
	"private:none:value:module",
	"private:none:inferred:module",
	"private:none:local:module",
	"private:none:none:module",
	"private:alias:query:module",
	"private:none:query:namespace",
	"list:none:none:module",
	"renamed:none:value:module",
	"default:none:none:module",
	"exported:none:none:module",
	"exported:alias:helper:namespace",
	"list:alias:query:module",
}

var (
	schemaDeclExports = []string{"private", "exported", "list", "renamed", "default"}
	schemaDeclOwns    = []string{"none", "alias"}
	schemaDeclUses    = []string{"none", "value", "query", "helper", "inferred", "local"}
	schemaDeclScopes  = []string{"module", "namespace"}
)

type schemaConstantDeclaration struct{ export, own, use, scope string }

func (s schemaConstantDeclaration) key() string {
	return "schema-decl:" + s.export + ":" + s.own + ":" + s.use + ":" + s.scope
}

// parseSchemaConstantDeclaration reads the keyed form,
// `schema-decl:<export>:<own>:<use>:<scope>`, so a saved corpus file keeps
// what it tests (RULES.md 11), and otherwise reads the choices from the bytes.
func parseSchemaConstantDeclaration(data []byte) schemaConstantDeclaration {
	pick := func(values []string, want string, fallback int) string {
		for _, v := range values {
			if v == want {
				return v
			}
		}
		return values[fallback%len(values)]
	}
	at := func(i int) int {
		if i < len(data) {
			return int(data[i])
		}
		return 0
	}
	var s schemaConstantDeclaration
	if rest, ok := strings.CutPrefix(string(data), "schema-decl:"); ok {
		parts := append(strings.Split(rest, ":"), "", "", "", "")
		s = schemaConstantDeclaration{pick(schemaDeclExports, parts[0], 0), pick(schemaDeclOwns, parts[1], 0), pick(schemaDeclUses, parts[2], 0), pick(schemaDeclScopes, parts[3], 0)}
	} else {
		s = schemaConstantDeclaration{schemaDeclExports[at(0)%len(schemaDeclExports)], schemaDeclOwns[at(1)%len(schemaDeclOwns)], schemaDeclUses[at(2)%len(schemaDeclUses)], schemaDeclScopes[at(3)%len(schemaDeclScopes)]}
	}
	if s.scope == "namespace" && s.export == "default" {
		s.export = "private" // a namespace has no default export
	}
	return s
}

// module prints the module: a Schema.Struct constant Item, its own type, a
// reference to it and its export, at the top level or in namespace N.
func (s schemaConstantDeclaration) module() string {
	var lines []string
	constant := "const Item = Schema.Struct({ id: Schema.String })"
	alias := "type Item = typeof Item.Type"
	if s.export == "exported" {
		constant, alias = "export "+constant, "export "+alias
	}
	lines = append(lines, constant)
	if s.own == "alias" {
		lines = append(lines, alias)
	}
	switch s.use {
	case "value":
		lines = append(lines, "export const decodeItem = Schema.decodeUnknownSync(Item)")
	case "query":
		lines = append(lines, "export type ItemInput = typeof Item.Type")
	case "helper":
		lines = append(lines, "export interface Shape { readonly item?: Schema.Schema.Type<typeof Item> }")
	case "inferred":
		lines = append(lines, "export const Wrapped = Schema.Struct({ item: Item })")
	case "local":
		lines = append(lines, "export function itemId() {\n  type T = typeof Item.Type\n  const t: T = { id: \"a\" }\n  return t.id\n}")
	}
	switch s.export {
	case "list":
		lines = append(lines, "export { Item }")
	case "renamed":
		lines = append(lines, "export { Item as PublicItem }")
	case "default":
		lines = append(lines, "export default Item")
	}
	if s.use == "none" && s.export == "private" {
		lines = append(lines, "export const marker = 1")
	}
	body := strings.Join(lines, "\n") + "\n"
	if s.scope == "namespace" {
		body = "export namespace N {\n" + body + "}\n"
	}
	return body
}

const schemaConstantDeclarationConfig = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`

// CheckSchemaConstantDeclarationFix compares the declarations of a module and
// of what --fix writes for it.
func CheckSchemaConstantDeclarationFix(t *testing.T, w *Workspace, s schemaConstantDeclaration) {
	const target = "FuzzSchemaConstantDeclarationFix"
	defer recoverCompilerPanic(t, target)
	source := s.module()
	files := map[string]string{"main.vibe": source, "package.json": `{"type":"module"}`}
	before, err := w.Compile(t.Context(), Project{Files: files, Config: schemaConstantDeclarationConfig})
	if err != nil {
		t.Fatal(err)
	}
	defer before.Remove()
	if !toolsErrorFree(before) {
		t.Fatalf("invalid fixture %s: %v\n%s", s.key(), before.Diagnostics, source)
	}
	fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
	if fixed.Err != nil {
		t.Fatal(fixed.Err)
	}
	written := source
	for name, file := range fixed.Files {
		if strings.HasSuffix(name.AsString(), "/main.vibe") {
			written = file.Text
		}
	}
	after, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": written, "package.json": `{"type":"module"}`}, Config: schemaConstantDeclarationConfig})
	if err != nil {
		t.Fatal(err)
	}
	defer after.Remove()
	if !toolsErrorFree(after) {
		Gap(t, target, "feature:"+s.key()+":compiles", "Chapter 7: a quick fix preserves types; --fix wrote a module with errors %v:\n%s\nfrom:\n%s", after.Diagnostics, written, source)
		return
	}
	if was, now := before.Outputs["out/main.d.ts"], after.Outputs["out/main.d.ts"]; was != now {
		Gap(t, target, "feature:"+s.key(), "Chapter 7: \"A quick fix is offered only when it preserves … declaration output\". --fix changed the declaration:\nbefore:\n%s\nafter:\n%s\nmodule:\n%s\nfixed:\n%s", was, now, source, written)
	}
	ExpectPending(t, target, "feature:"+s.key())
}
