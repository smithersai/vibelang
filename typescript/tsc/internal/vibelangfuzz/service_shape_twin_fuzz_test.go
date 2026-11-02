package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const serviceShapeTwinTarget = "FuzzServiceShapeTwin"
const serviceShapeTwinQuote = "the TypeScript type annotation supplies the exact Shape; the required body admits only the existing `key` and `defaultValue` members."
const serviceShapeCaptureQuote = "A service's resolved member contracts cannot capture a type parameter from an enclosing scope"
const serviceShapeEmitQuote = "This form adds no shape helper and no namespace"
const serviceShapeContractQuote = "only the generated contract described above is an allowed addition in the emitted declaration"

func TestServiceShapeTwinQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), serviceShapeContractQuote) {
		t.Fatalf("declaration contract authority changed: %q", serviceShapeContractQuote)
	}
	for _, rule := range []struct {
		key, quote string
	}{
		{"quote:whole-shape", serviceShapeTwinQuote},
		{"quote:direct-emit", serviceShapeEmitQuote},
		{"capture", serviceShapeCaptureQuote},
		{"separators", "Members are separated as in an `interface`"},
	} {
		t.Run(rule.key, func(t *testing.T) {
			if !strings.Contains(SpecText("005-services.md"), rule.quote) {
				t.Fatalf("chapter 5 no longer says %q", rule.quote)
			}
		})
	}
}

// This is a static declaration/grammar oracle from VIP-9's whole-shape
// amendment. Compare stock tsc's exported names, types and documentation
// through the shared API gate, including VIP-27's generated contract rule.
func FuzzServiceShapeTwin(f *testing.F) {
	startShortBudget(f)
	// The accepted example keeps its TypeScript 5.9.3 golden in its case;
	// mutation twins use the repository's stock tsc and API comparator.
	w, tsc := NewWorkspace(f), StockTypeScript(f)
	config := strings.Replace(errorTwinConfig, `"skipLibCheck":true`, `"skipLibCheck":false,"types":[]`, 1)
	// Short seeds cover written aliases, defaults, separators and forbidden
	// members; the keyed corpus adds inline and qualified shapes. Long runs
	// seed every type/default/annotation combination.
	if testing.Short() {
		f.Add("readonly-object", uint8(1), uint8(0))
		f.Add("string", uint8(0), uint8(0))
		f.Add("number", uint8(1), uint8(0))
		f.Add("readonly-object", uint8(5), uint8(0))
		f.Add("readonly-object", uint8(0), uint8(1))
		f.Add("readonly-object", uint8(0), uint8(2))
	} else {
		for _, key := range []string{"readonly-object", "mutable-object", "string", "number", "union", "tuple", "function", "mapped", "indexed", "qualified", "metadata-names"} {
			for mode := uint8(0); mode < 4; mode++ {
				f.Add(key, mode, uint8(0))
			}
		}
		for _, mode := range []uint8{4, 5, 8, 9, 10, 11} {
			f.Add("readonly-object", mode, uint8(0))
		}
		for i := uint8(1); i <= 8; i++ {
			f.Add("readonly-object", uint8(0), i)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode, member uint8) {
		defer recoverCompilerPanic(t, serviceShapeTwinTarget)
		types := []string{"{ readonly value: string }", "{ value: string; optional?: number }", "string", "number", "string | number", "readonly [string, number]", "(value: string) => number", "{ readonly [K in 'left' | 'right']?: string }", "{ item: readonly string[] }['item']", "Types.Shape", "{ readonly key: string; readonly defaultValue: number }"}
		keys := []string{"readonly-object", "mutable-object", "string", "number", "union", "tuple", "function", "mapped", "indexed", "qualified", "metadata-names"}
		choice := 0
		for i, k := range keys {
			if key == k {
				choice = i
				break
			}
		}
		if key != keys[choice] && len(key) > 0 {
			choice = int(key[0]) % len(keys)
		}
		key = keys[choice]
		prefix := "import { Context } from \"effect\";\n"
		if key == "qualified" {
			prefix += "export namespace Types { export type Shape = { readonly value: string } }\n"
		}
		shape := "Shape"
		prefix += "export type Shape = " + types[choice] + ";\n"
		if mode&2 != 0 {
			shape = types[choice]
		}
		separator := "; "
		if mode&4 != 0 {
			separator = ", "
		}
		if mode&8 != 0 {
			separator = "\n"
		}
		body := "static readonly key = \"probe/Port\""
		// The amendment requires the written type, even where tsc would
		// expand an inferred primitive alias or mapped type. Annotate the
		// twin's base explicitly so the API oracle tests that contract.
		twin := "const Port_base: Context.ServiceClass<Port, \"probe/Port\", " + shape + "> = Context.Service<Port, " + shape + ">()(\"probe/Port\");\nexport class Port extends Port_base {}\n"
		if mode&1 != 0 {
			body += separator + "static readonly defaultValue = () => undefined as unknown as " + shape
			twin = "export const Port: Context.Reference<" + shape + "> = Context.Reference<" + shape + ">(\"probe/Port\", { defaultValue: () => undefined as unknown as " + shape + " })\n"
		}
		bad := []string{"", "value: string", "static readonly other = 1", "read(): string", "constructor() {}", "[key: string]: string", "get value() { return 1 }", "static {}", "static method() {}"}
		invalid := int(member) % len(bad)
		if invalid != 0 {
			body += separator + bad[invalid]
		}
		source := prefix + "export service Port: " + shape + " { " + body + " }\nexport type Implementation = Context.Service.Shape<typeof Port>;\n"
		counterpart := prefix + twin + "export type Implementation = Context.Service.Shape<typeof Port>;\n"
		if mode&1 == 0 {
			counterpart += "export {};\n"
		}
		gap := fmt.Sprintf("%s/mode-%d/member-%d", key, mode%16, invalid)
		project := Project{Files: map[string]string{"main.vibe": source}, Config: fmt.Sprintf(config, "main.vibe")}
		var c *Compilation
		var err error
		within(t, "compile", func() { c, err = w.CompileOrdered(t.Context(), project, OrderTsc, true) })
		if err != nil {
			t.Fatal(err)
		}
		defer c.Remove()
		if invalid != 0 {
			found := false
			for _, d := range c.Diagnostics {
				if IsEK(d) && d.Code() == 902 {
					found = true
				}
			}
			if !found {
				Gap(t, serviceShapeTwinTarget, "member:"+gap, "VIP-9: %s; expected EK0902, got %v\n%s", serviceShapeTwinQuote, SortedKeys(Keys(c.Dir, c.Diagnostics)), source)
			}
			return
		}
		if c.Program == nil || HasError(c.Diagnostics) {
			Gap(t, serviceShapeTwinTarget, "compile:"+gap, "VIP-9: %s; got %v\n%s", serviceShapeTwinQuote, SortedKeys(Keys(c.Dir, c.Diagnostics)), source)
			return
		}
		stock := Project{Files: map[string]string{"main.ts": counterpart}, Config: fmt.Sprintf(config, "main.ts")}
		dir := emitDeclarationIdentityStock(t, w, tsc, stock)
		defer os.RemoveAll(dir)
		want, err := os.ReadFile(filepath.Join(dir, "__identity_out", "main.d.ts"))
		if err != nil {
			t.Fatal(err)
		}
		got, ok := c.Outputs["__identity_out/main.d.ts"]
		if !ok {
			t.Fatal("missing declaration output", c.Outputs)
		}
		if diff := compareDeclarationOutputs(t,
			map[string]string{"main.d.ts": string(want)},
			map[string]string{"main.d.ts": got}); diff != "" {
			Gap(t, serviceShapeTwinTarget, "api:"+gap, "VIP-9: %s\nAPI comparison:\n%s\nsource:\n%s\ntwin:\n%s", serviceShapeEmitQuote, diff, source, counterpart)
		}
		if strings.Contains(got, "namespace Port") || strings.Contains(got, "Port_shape") || strings.Contains(got, "$Port$Shape") {
			Gap(t, serviceShapeTwinTarget, "extra-shape:"+gap, "VIP-9: %s\n%s", serviceShapeEmitQuote, got)
		}
		ExpectPending(t, serviceShapeTwinTarget, specCorpusKey(t))
	})
}

// FuzzServiceShapeCapture reads the existing chapter 5 capture rule, applying
// it to whole-shape annotations and preserving locally bound polymorphism.
func FuzzServiceShapeCapture(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for _, key := range []string{"direct", "aliased", "erased", "typeof", "defaulted", "member-local", "concrete"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		defer recoverCompilerPanic(t, "FuzzServiceShapeCapture")
		before, typ, capture := "", "A", true
		switch key {
		case "aliased":
			before, typ = "type Shape = { readonly value: A };", "Shape"
		case "erased":
			before, typ, capture = "type Shape<U> = string;", "Shape<A>", false
		case "typeof":
			before, typ = "const value = null as unknown as { value: A };", "typeof value"
		case "defaulted":
			before, typ = "type Shape<U = A> = { value: U };", "Shape"
		case "member-local":
			typ, capture = "{ identity<A>(value: A): A }", false
		case "concrete":
			typ, capture = "{ readonly value: number }", false
		default:
			key = "direct"
		}
		if variant&1 != 0 {
			typ = "{ readonly wrapped: " + typ + " }"
		}
		source := "function make<A>() { " + before + " service Port: " + typ + " { static readonly key = \"probe/Capture\" }; return Port }"
		c, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer c.Remove()
		found := false
		for _, d := range c.Diagnostics {
			if IsEK(d) && d.Code() == 3005 {
				found = true
			}
		}
		gap := fmt.Sprintf("%s/wrapped-%d", key, variant&1)
		if capture && !found || !capture && HasError(c.Diagnostics) {
			Gap(t, "FuzzServiceShapeCapture", gap, "Chapter 5: %s; capture=%t, got %v\n%s", serviceShapeCaptureQuote, capture, SortedKeys(Keys(c.Dir, c.Diagnostics)), source)
		}
		ExpectPending(t, "FuzzServiceShapeCapture", specCorpusKey(t))
	})
}
