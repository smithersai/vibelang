package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
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

// Chapter 7 oracle for EK4832 and EK4837 (keyed corpus: key is the wrapper's
// name above, mode the rest): the fix writes the same text whether or not
// the fixing project sets exactOptionalPropertyTypes, a Schema.optional(S)
// field is fixed and a Schema.optionalKey or own-undefined codec keeps its
// constant, and the fixed file's declarations equal the native source's under
// each setting. The compiler is compared with itself on two inputs chapter 6
// says must agree ("Declarations are identical to the Effect TypeScript twin
// under the same setting"). Mode: bits 0-1 the primitive, 2 a second optional
// field, 3 a Schema.TaggedError class (EK4837) rather than a struct, 4 a
// multi-line fields object, 5 a comment-free JSDoc on the constant.
func FuzzSchemaFixOptionalSetting(f *testing.F) {
	startShortBudget(f)
	requireSchemaFixOptionalSettingQuotes(f)
	w := NewWorkspace(f)
	for _, seed := range []struct {
		key  string
		mode uint16
	}{
		{"optional", 0}, {"optional", 8}, {"mutable-optional", 1 | 4}, {"optional-union-null", 2 | 16},
		{"optional-nested", 0}, {"optionalKey", 3}, {"optional-undefined", 8}, {"optional-union-undefined", 4},
	} {
		f.Add(seed.key, seed.mode)
	}
	f.Fuzz(func(t *testing.T, key string, mode uint16) {
		const target = "FuzzSchemaFixOptionalSetting"
		defer recoverCompilerPanic(t, target)
		wrapper := schemaOptionalWrappers[int(mode>>6)%len(schemaOptionalWrappers)]
		for _, candidate := range schemaOptionalWrappers {
			if candidate.key == key {
				wrapper = candidate
			}
		}
		key = wrapper.key
		primitive := []string{"Schema.String", "Schema.Number", "Schema.Boolean", "Schema.Literal(\"open\")"}[mode&3]
		fields := []string{"value: " + wrapper.wrap(primitive)}
		if mode&4 != 0 {
			fields = append(fields, "extra: Schema.optional(Schema.Number)")
		}
		separator, open, close := ", ", "{ ", " }"
		if mode&16 != 0 {
			separator, open, close = ",\n  ", "{\n  ", "\n}"
		}
		object := open + strings.Join(fields, separator) + close
		doc := ""
		if mode&32 != 0 {
			doc = "/** The decoded shape. */\n"
		}
		var source string
		if mode&8 != 0 {
			source = doc + "export class Shape extends Schema.TaggedError<Shape>()(\"Shape\", " + object + ") {}\n"
		} else {
			source = doc + "export const Shape = Schema.Struct(" + object + ")\nexport type Shape = typeof Shape.Type\n"
		}
		source = "import * as Schema from \"effect/Schema\"\n" + source
		gapKey := fmt.Sprintf("%s:%d", key, mode&63)
		declarations := map[bool]map[string]string{}
		fixed := map[bool]string{}
		for _, exact := range []bool{false, true} {
			project := Project{Files: map[string]string{"main.vibe": source}, Config: schemaOptionalSettingConfig(exact)}
			var before *Compilation
			var err error
			within(t, "compile", func() { before, err = w.CompileOrdered(t.Context(), project, OrderTsc, true) })
			if err != nil {
				t.Fatal(err)
			}
			defer before.Remove()
			if before.Program == nil || HasError(before.Diagnostics) {
				t.Fatalf("invalid generated source: %v\n%s", SortedKeys(Keys(before.Dir, before.Diagnostics)), source)
			}
			declarations[exact] = map[string]string{"source": before.Outputs["out/main.d.ts"]}
			var result *vibelang.FixResult
			within(t, "fix", func() {
				result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
			})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			if len(result.Refused) != 0 {
				Gap(t, target, "refused:"+gapKey, "--fix refused %v\nsource:\n%s", result.Refused, source)
			}
			fixed[exact] = source
			for _, file := range result.Files {
				fixed[exact] = file.Text
			}
		}
		if fixed[false] != fixed[true] {
			Gap(t, target, "setting:"+gapKey, "Chapter 7: %s\nthe fix depends on the fixing project's exactOptionalPropertyTypes\nsource:\n%s\noff:\n%s\non:\n%s", schemaFixOptionalSettingQuote, source, fixed[false], fixed[true])
		}
		after := fixed[true]
		want, checked := wrapper.fixed, true
		if mode&8 != 0 {
			want, checked = wrapper.fixedError > 0, wrapper.fixedError != 0
		}
		if checked && (after != source) != want {
			Gap(t, target, "fix:"+gapKey, "Chapter 7: %s\nfixed=%t, want %t\nsource:\n%s\nfixed:\n%s", schemaFixOptionalSettingQuote, after != source, want, source, after)
		}
		if after == source {
			return
		}
		if strings.Contains(key, "optional") && !strings.Contains(after, "| undefined") {
			Gap(t, target, "spelling:"+gapKey, "Chapter 7: %s\nthe fix did not write name?: T | undefined\nfixed:\n%s", schemaFixOptionalSettingQuote, after)
		}
		for _, exact := range []bool{false, true} {
			project := Project{Files: map[string]string{"main.vibe": after}, Config: schemaOptionalSettingConfig(exact)}
			var compiled *Compilation
			var err error
			within(t, "compile", func() { compiled, err = w.CompileOrdered(t.Context(), project, OrderTsc, true) })
			if err != nil {
				t.Fatal(err)
			}
			defer compiled.Remove()
			if compiled.Program == nil || HasError(compiled.Diagnostics) {
				Gap(t, target, "errors:"+gapKey, "the fixed source reports %v under exactOptionalPropertyTypes=%t\nsource:\n%s\nfixed:\n%s", SortedKeys(Keys(compiled.Dir, compiled.Diagnostics)), exact, source, after)
				continue
			}
			want, got := declarations[exact]["source"], compiled.Outputs["out/main.d.ts"]
			if want == "" || got != want {
				Gap(t, target, fmt.Sprintf("declaration:%s:%t", gapKey, exact), "Chapter 6: %s\nexactOptionalPropertyTypes=%t\nsource:\n%s\nfixed:\n%s\nsource declares:\n%s\nfixed declares:\n%s", schemaOptionalUndefinedArmQuote, exact, source, after, want, got)
			}
		}
	})
}
