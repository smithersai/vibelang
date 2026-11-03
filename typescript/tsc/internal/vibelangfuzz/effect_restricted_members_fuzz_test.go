package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const effectRestrictedMembersQuote = "getters, setters and constructors can't be `effect`"
const effectRestrictedMembersRow = "`effect` on a getter, setter or constructor"

func requireEffectRestrictedMembersQuote(t testing.TB) []byte {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{effectRestrictedMembersQuote, effectRestrictedMembersRow, functionSyntaxQuote, "`effect() { }` alone is a method named `effect`"} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("VIP-1 no longer says %q", quote)
		}
	}
	return chapter
}

func TestEffectRestrictedMembersQuoted(t *testing.T) { requireEffectRestrictedMembersQuote(t) }

// VIP-1 assigns EK0104 to the recognized prefix, independent of property
// spelling, trivia or class/object placement. Ordinary effect/get/set names,
// line breaks after effect and object methods named constructor remain native.
// Parsing is the oracle boundary: malformed prefixes must not become unrelated
// fields or leak to the checker as methods. The CLI case checks public errors.
func FuzzEffectRestrictedMembers(f *testing.F) {
	startShortBudget(f)
	chapter := requireEffectRestrictedMembersQuote(f)
	code := chapterCode(f, chapter, effectRestrictedMembersRow)
	keys := []string{"getter", "setter", "constructor", "get-method", "set-method", "effect-method", "newline", "object-constructor", "computed-constructor"}
	for _, key := range keys {
		for _, mode := range []uint8{0, 3, 6, 9, 16, 19, 22, 32, 35} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		known := false
		for _, k := range keys {
			known = known || k == key
		}
		if !known {
			key = keys[int(mode)%len(keys)]
		}
		gap := []string{" ", "/* prefix */", "\t"}[mode%3]
		name := []string{"x", "'x'", "[('x')]", "#x"}[(mode/3)%4]
		object := mode&16 != 0
		if object && name == "#x" {
			name = "x"
		}
		member, bad := "", true
		switch key {
		case "getter":
			member = "effect" + gap + "get " + name + "() { return 1 }"
		case "setter":
			member = "effect" + gap + "set " + name + "(v: number) {}"
		case "constructor":
			ctor := "constructor"
			if mode&1 != 0 {
				ctor = "'constructor'"
			}
			params := ""
			if mode&32 != 0 {
				params = "value: number = 1"
			}
			member = "effect" + gap + ctor + "(" + params + ") {}"
			object = false
		case "get-method":
			member, bad = "effect"+gap+"get() { return 1 }", false
		case "set-method":
			member, bad = "effect"+gap+"set(v: number) {}", false
		case "effect-method":
			member, bad = "effect() { return 1 }", false
		case "newline":
			member, bad, object = "effect"+gap+"\nget "+name+"() { return 1 }", false, false
		case "object-constructor":
			member, bad, object = "effect"+gap+"constructor() {}", false, true
		case "computed-constructor":
			member, bad = "effect"+gap+"['constructor']() {}", false
		}
		source := "class C { " + member + "; after() {} }"
		if object {
			source = "const o = { " + member + ", after() {} }"
		}
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
		ds := file.Diagnostics()
		if bad {
			if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != code {
				Gap(t, "FuzzEffectRestrictedMembers", "prefix:"+key, "%s; expected EK%04d\n%s\n%v", effectRestrictedMembersQuote, code, source, ds)
			}
		} else if len(ds) != 0 {
			Gap(t, "FuzzEffectRestrictedMembers", "control:"+key, "native method/identifier control rejected\n%s\n%v", source, ds)
		}
	})
}

const effectRestrictedErrorPriorityQuote = "gets the applicable Functions diagnostics and no redundant error-body category diagnostic, including in either error form."

func requireEffectRestrictedErrorPriority(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("003-failures.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), effectRestrictedErrorPriorityQuote) {
		t.Fatal("stale VIP-13/VIP-29 Functions-priority quote")
	}
}

func TestEffectRestrictedErrorMembersQuoted(t *testing.T) { requireEffectRestrictedErrorPriority(t) }

func FuzzEffectRestrictedErrorMembers(f *testing.F) {
	startShortBudget(f)
	requireEffectRestrictedErrorPriority(f)
	keys := []string{"getter", "setter", "constructor", "static-getter", "tag-getter", "computed-tag-getter", "async-getter"}
	for _, key := range keys {
		for mode := range uint8(4) {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		form := "error"
		if mode&1 != 0 {
			form = "schema error"
		}
		gap := " "
		if mode&2 != 0 {
			gap = "/* prefix */"
		}
		member := ""
		switch key {
		case "setter":
			member = "effect" + gap + "set x(v: number) {}"
		case "constructor":
			member = "effect" + gap + "constructor() {}"
		case "static-getter":
			member = "static effect" + gap + "get x() {return 1}"
		case "computed-tag-getter":
			member = "effect" + gap + "get ['_tag']() {return 1}"
		case "async-getter":
			member = "async effect" + gap + "get x() {return 1}"
		case "tag-getter":
			member = "effect" + gap + "get _tag() {return 1}"
		default:
			key, member = "getter", "effect"+gap+"get x() {return 1}"
		}
		source := "export " + form + " E {" + member + "}"
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		found, mixed := 0, 0
		for _, d := range r.Diagnostics {
			if !IsEK(d) {
				continue
			}
			if d.Code() == 104 {
				found++
			}
			if d.Code() == 105 {
				mixed++
			}
			if d.Code() == 1301 || d.Code() == 1302 || d.Code() == 1303 || d.Code() == 1304 || d.Code() == 2117 {
				Gap(t, "FuzzEffectRestrictedErrorMembers", "priority:"+form+":"+key, "%s\n%s\n%v", effectRestrictedErrorPriorityQuote, source, Keys(r.Dir, r.Diagnostics))
			}
		}
		if found != 1 || key == "async-getter" && mixed != 1 {
			Gap(t, "FuzzEffectRestrictedErrorMembers", "prefix:"+form+":"+key, "want exactly one EK0104\n%s\n%v", source, Keys(r.Dir, r.Diagnostics))
		}
	})
}
