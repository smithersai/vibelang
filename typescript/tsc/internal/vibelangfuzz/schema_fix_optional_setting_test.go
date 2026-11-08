package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

// Chapter 7: the quick fixes write forms whose meaning does not depend on a
// compiler option another project compiling the same file may set
// differently.
const schemaFixOptionalSettingQuote = "A fix writes a form whose meaning does not depend on a compiler option that another project compiling the same file may set differently: a `Schema.optional(S)` field becomes `name?: T | undefined`, which maps to `Schema.optional(S)` under either `exactOptionalPropertyTypes` setting, while `Schema.optionalKey(S)`, which no spelling maps back to under both, keeps its TypeScript form, and a struct field whose codec has its own `undefined` arm, such as `Schema.optional(Schema.Undefined)`, keeps its constant."

// Chapter 6: the spelling's mapping.
const schemaOptionalUndefinedArmQuote = "Thus `name?: string | undefined` maps to `Schema.optional(Schema.String)`, including its public codec type."

func requireSchemaFixOptionalSettingQuotes(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("007-tooling.md"), schemaFixOptionalSettingQuote) {
		t.Fatalf("Chapter 7 no longer says %q; update the oracle", schemaFixOptionalSettingQuote)
	}
	if !strings.Contains(SpecText("006-data.md"), schemaOptionalUndefinedArmQuote) {
		t.Fatalf("Chapter 6 no longer says %q; update the oracle", schemaOptionalUndefinedArmQuote)
	}
}

func TestSchemaFixOptionalSettingQuoted(t *testing.T) { requireSchemaFixOptionalSettingQuotes(t) }

// schemaOptionalWrappers are the field codecs the target writes around a
// primitive P, by key, with whether EK4832's fix writes a struct of them
// (fixed) and whether EK4837's fix writes a schema error of them (fixedError:
// 1 yes, -1 no, 0 either, checked only for declaration identity). A
// Schema.optional(S) field has the spelling name?: T | undefined; a
// Schema.optionalKey field has none. An optional codec with its own
// undefined arm keeps a struct constant, while a schema error may name it by
// a constant, which the written undefined arm leaves as it is.
var schemaOptionalWrappers = []struct {
	key        string
	wrap       func(p string) string
	fixed      bool
	fixedError int
}{
	{"required", func(p string) string { return p }, true, 1},
	{"optional", func(p string) string { return "Schema.optional(" + p + ")" }, true, 1},
	{"mutable-optional", func(p string) string { return "Schema.mutableKey(Schema.optional(" + p + "))" }, true, 0},
	{"optional-union-null", func(p string) string { return "Schema.optional(Schema.Union([" + p + ", Schema.Null]))" }, true, 1},
	{"optional-nested", func(p string) string { return "Schema.optional(Schema.Struct({ inner: Schema.optional(" + p + ") }))" }, true, 1},
	{"optional-array", func(p string) string { return "Schema.optional(Schema.Array(" + p + "))" }, true, 1},
	{"optionalKey", func(p string) string { return "Schema.optionalKey(" + p + ")" }, false, -1},
	{"optional-undefined", func(p string) string { return "Schema.optional(Schema.Undefined)" }, false, 0},
	{"optional-union-undefined", func(p string) string { return "Schema.optional(Schema.Union([" + p + ", Schema.Undefined]))" }, false, 0},
}

// schemaOptionalSettingConfig is the declaration-emitting project of one
// main.vibe under exactOptionalPropertyTypes exact.
func schemaOptionalSettingConfig(exact bool) string {
	return fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"declaration":true,"emitDeclarationOnly":true,"outDir":"out","exactOptionalPropertyTypes":%t},"files":["main.vibe"]}`, exact)
}
