package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-34 requires "Existing tools work." LSP 3.17 defines fromRanges as
// "The range at which this item is called." A parser-generated constructor has no written call
// range. Written constructors and factory calls still have their source sites.
const errorCallsEditorQuote = "Existing tools work."

func TestErrorCallHierarchyQuoted(t *testing.T) { errorCallHierarchyQuoted(t) }

func errorCallHierarchyQuoted(t testing.TB) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	// The chapter delegates the editor contract to VIP-34; check its source.
	vip, err := os.ReadFile(SpecPath("../vips/0034-compiler-and-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), "VIP-34") || !strings.Contains(string(vip), errorCallsEditorQuote) {
		t.Fatal("VIP-34 editor citation changed")
	}
}

var errorCallKeys = []string{"witness", "derived-auto", "derived-empty", "derived-generic", "root-auto", "derived-written", "native-written", "native-factory", "schema-root", "schema-computed"}

func errorCallSource(key string, variant uint8) (source, item string, want []string) {
	suffix := fmt.Sprintf("%d", variant%8)
	base, child := "Base"+suffix, "Child"+suffix
	prefix := ""
	if variant&8 != 0 {
		prefix = "export "
	}
	main := "\nexport function main() { return new " + child + "({ x: 0 }) }\n"
	switch key {
	case "witness":
		return "error A { _tag: string }\nerror B extends A { x: number }\nexport function main() { return new B({ x: 0 }) }\n", "B", nil
	case "derived-empty":
		return "error " + base + " { _tag: string; x: number }\n" + prefix + "error " + child + " extends " + base + " {}" + main, child, nil
	case "derived-generic":
		return "error " + base + "<T> { _tag: string; value?: T }\n" + prefix + "error " + child + " extends " + base + "<number> { x: number }" + main, child, nil
	case "root-auto":
		return prefix + "error " + child + " { x: number }" + main, child, nil
	case "schema-computed":
		return "function fieldKey(): \"value\" { return \"value\" }\n" + prefix + "schema error " + child + " { [fieldKey()]: string; x: number }" + main, child, []string{"fieldKey"}
	case "schema-root":
		return prefix + "schema error " + child + " { x: number }" + main, child, nil
	case "derived-written":
		return "error " + base + " { _tag: string }\n" + prefix + "error " + child + " extends " + base + " { x: number; constructor(args: { x: number }) { super(args); tick() } }\nfunction tick() {}" + main, child, []string{base, "tick"}
	case "native-written":
		return "class " + base + " {}\n" + prefix + "class " + child + " extends " + base + " { constructor(args: { x: number }) { super(); tick() } }\nfunction tick() {}" + main, child, []string{base, "tick"}
	case "native-factory":
		return "function makeBase() { return class {} }\n" + prefix + "class " + child + " extends makeBase() {}" + main, child, []string{"makeBase"}
	default:
		fields := "x: number"
		if variant&16 != 0 {
			fields += "; y?: string"
		}
		return "error " + base + " { _tag: string }\n" + prefix + "error " + child + " extends " + base + " { " + fields + " }" + main, child, nil
	}
}

func checkErrorCallHierarchy(t *testing.T, w *Workspace, key string, variant uint8) {
	t.Helper()
	source, name, want := errorCallSource(key, variant)
	files := map[string]string{"main.vibe": source}
	dir, err := toolsWrite(w, Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	program := toolsProgram(w, dir)
	if program == nil {
		t.Fatal("missing program")
	}
	service, _ := toolsService(w, program, toolsFileName(dir, "main.vibe"))
	uri := toolsURI(dir, "main.vibe")
	lines := newToolsLines(source)
	prepare := func(name string) *lsproto.CallHierarchyItem {
		t.Helper()
		// Every declaration has a space immediately before its name.
		offset := strings.Index(source, " "+name)
		if offset < 0 {
			t.Fatalf("no declaration for %s", name)
		}
		result, err := service.ProvidePrepareCallHierarchy(t.Context(), uri, lines.position(offset+1))
		if err != nil {
			t.Fatal(err)
		}
		if result.CallHierarchyItems == nil || len(*result.CallHierarchyItems) != 1 {
			t.Fatalf("%s: prepare %s = %+v", key, name, result)
		}
		return (*result.CallHierarchyItems)[0]
	}
	item := prepare(name)
	calls, err := service.ProvideCallHierarchyOutgoingCalls(t.Context(), item)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	if calls.CallHierarchyOutgoingCalls != nil {
		for _, call := range *calls.CallHierarchyOutgoingCalls {
			found[call.To.Name] = true
			for _, span := range call.FromRanges {
				if span == item.SelectionRange {
					Gap(t, "FuzzErrorCallHierarchySourceSites", "synthetic-error-call-site:"+key, "LSP 3.17 fromRanges: synthetic call to %s at declaration name %v\n%s", call.To.Name, span, source)
				}
			}
		}
	}
	if len(found) != len(want) {
		Gap(t, "FuzzErrorCallHierarchySourceSites", "source-call-targets:"+key, "LSP 3.17: outgoing targets %v, want %v\n%s", found, want, source)
	}
	for _, name := range want {
		if !found[name] {
			Gap(t, "FuzzErrorCallHierarchySourceSites", "written-call-missing:"+key, "LSP 3.17: missing written call to %s\n%s", name, source)
		}
	}

	// The explicit source constructor use must survive in both directions.
	main := prepare("main")
	out, err := service.ProvideCallHierarchyOutgoingCalls(t.Context(), main)
	if err != nil {
		t.Fatal(err)
	}
	if out.CallHierarchyOutgoingCalls == nil || len(*out.CallHierarchyOutgoingCalls) != 1 || (*out.CallHierarchyOutgoingCalls)[0].To.Name != name {
		t.Fatalf("%s: main must call %s: %+v", key, name, out)
	}
	in, err := service.ProvideCallHierarchyIncomingCalls(t.Context(), item, nil)
	if err != nil {
		t.Fatal(err)
	}
	incoming := false
	if in.CallHierarchyIncomingCalls != nil {
		for _, call := range *in.CallHierarchyIncomingCalls {
			if call.From.Name == "main" {
				incoming = true
			}
		}
	}
	if !incoming {
		Gap(t, "FuzzErrorCallHierarchySourceSites", "written-new-missing:"+key, "LSP 3.17: explicit new expression missing from incoming calls\n%s", source)
	}
}

func TestErrorCallHierarchySourceSites(t *testing.T) {
	w := NewWorkspace(t)
	for _, key := range errorCallKeys {
		t.Run(key, func(t *testing.T) { checkErrorCallHierarchy(t, w, key, 0) })
	}
}

func FuzzErrorCallHierarchySourceSites(f *testing.F) {
	startShortBudget(f)
	for _, key := range errorCallKeys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(31))
	}
	errorCallHierarchyQuoted(f)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		known := false
		for _, k := range errorCallKeys {
			if key == k {
				known = true
			}
		}
		if !known {
			if len(key) == 0 {
				key = errorCallKeys[0]
			} else {
				key = errorCallKeys[int(key[0])%len(errorCallKeys)]
			}
		}
		toolsGuard(t, "FuzzErrorCallHierarchySourceSites", func() { checkErrorCallHierarchy(t, w, key, variant) })
	})
}
