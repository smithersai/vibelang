package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

// FuzzUnionDataMember compares ordinary factory values with native TypeScript
// under VIP-1/detail303. Keep the historical alchemy resource, generic
// constraint, array, later-inference and Function controls, and compare
// each data-only and callable-twin program with its own native counterpart.
func FuzzUnionDataMember(f *testing.F) {
	startShortBudget(f)
	requireNativeFactoryQuote(f)
	for _, data := range unionDataForms {
		for _, holder := range unionHolders {
			f.Add([]byte("union-data:" + data.name + "/plat-generic/" + holder.name + "/resource"))
		}
	}
	// A required or optional witness infers number. The generic callable's
	// platform: number cannot take platform: true, even though its permissive
	// instantiation could (alchemy-28). Explicit and later-fixed arguments
	// make the same distinction.
	for _, data := range unionDataForms {
		for _, holder := range unionHolders {
			f.Add([]byte("union-data:" + data.name + "/plat-generic/" + holder.name + "/platform-resource"))
		}
	}
	f.Add([]byte("union-data:plain/plat/direct/record"))
	for _, holder := range unionHolders {
		f.Add([]byte("union-data:generic/function/" + holder.name + "/resource"))
	}
	f.Add([]byte("union-data:generic/function/direct/record"))
	for _, holder := range unionHolders {
		f.Add([]byte("union-data:generic/plat/" + holder.name + "/platform-resource"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckUnionDataMember(t, w, parseUnionData(data))
	})
}

// TestUnionDataMemberQuoted pins the current keyword-only function rule.
func TestUnionDataMemberQuoted(t *testing.T) { requireNativeFactoryQuote(t) }

type unionChoice struct{ name, text string }

// Each data member is a type Like<R>; each callable member a type Plat<R>.
var unionDataForms = []unionChoice{
	{"plain", "export interface Like<R> { readonly kind: string }"},
	{"generic", "export interface Like<R> { readonly witness: R }"},
	{"optional", "export interface Like<R> { readonly witness?: R }"},
}

var unionCallables = []unionChoice{
	{"plat", "export interface Plat<R> { (id: string, props: number): any; readonly platform: true }"},
	{"plat-generic", "export interface Plat<R> { (id: string, props: number): any; readonly platform: R }"},
	{"none", ""},
	{"function", "export type Plat<R> = Function"},
}

// functionTwin checks a distinct native callable destination beside Function.
var functionTwin = unionChoice{"any-function", "export type Plat<R> = (...args: any) => any"}

// P stands for the parameter's type: U for the union, or Like<any> alone.
var unionHolders = []unionChoice{
	{"direct", "export const take = <W>(cls: P<W>): number => 1"},
	{"constrained", "export const take = <T extends P<any>>(cls: T): number => 1"},
	{"array", "export const take = <W>(all: P<W>[]): number => all.length"},
	{"constrained-array", "export const take = <T extends P<any>>(all: T[]): number => all.length"},
	{"explicit", "export const take = <W>(cls: P<W>): number => 1"},
	{"explicit-array", "export const take = <W>(all: P<W>[]): number => all.length"},
	{"later", "export const take = <W>(cls: P<NoInfer<W>>, output: () => W): number => 1"},
	{"later-array", "export const take = <W>(all: P<NoInfer<W>>[], output: () => W): number => all.length"},
}

var unionValues = []unionChoice{
	{"resource", "export const Thing: Res<number> = Object.assign((_id: string) => Effect.succeed(1), { kind: \"thing\", witness: 1 })"},
	{"record", "export const Thing = { kind: \"thing\", witness: 1 }"},
	// Fits the callable member too, so its plain signature reaches the value.
	{"platform-resource", "export const Thing: Res<number> & { readonly platform: true } = Object.assign((_id: string) => Effect.succeed(1), { kind: \"thing\", witness: 1, platform: true as const })"},
}

type unionDataInput struct{ data, callable, holder, value unionChoice }

// parseUnionData reads `union-data:<data>/<callable>/<holder>/<value>`
// (RULES.md 11), and otherwise picks from the bytes.
func parseUnionData(data []byte) unionDataInput {
	find := func(choices []unionChoice, name string) unionChoice {
		for _, c := range choices {
			if c.name == name {
				return c
			}
		}
		return choices[0]
	}
	if rest, ok := strings.CutPrefix(string(data), "union-data:"); ok {
		parts := append(strings.Split(rest, "/"), "", "", "", "")
		return unionDataInput{find(unionDataForms, parts[0]), find(unionCallables, parts[1]), find(unionHolders, parts[2]), find(unionValues, parts[3])}
	}
	at := func(i int) int {
		if i < len(data) {
			return int(data[i])
		}
		return 0
	}
	return unionDataInput{unionDataForms[at(0)%len(unionDataForms)], unionCallables[at(1)%len(unionCallables)], unionHolders[at(2)%len(unionHolders)], unionValues[at(3)%len(unionValues)]}
}

// project writes lib.ts and main.vibe; union says whether the parameter
// names the union or the data member alone.
func (in unionDataInput) project(union bool) map[string]string {
	member := "Like"
	if union && in.callable.text != "" {
		member = "U"
	}
	holder := strings.ReplaceAll(in.holder.text, "P<", member+"<")
	call := "take(Thing)"
	if strings.HasSuffix(in.holder.name, "array") {
		call = "take([Thing, Thing])"
	}
	if strings.HasPrefix(in.holder.name, "explicit") {
		call = strings.Replace(call, "take(", "take<number>(", 1)
	}
	if strings.HasPrefix(in.holder.name, "later") {
		call = strings.TrimSuffix(call, ")") + ", () => 1)"
	}
	lib := []string{
		`import * as Effect from "effect/Effect"`,
		"export interface Res<R> { (id: string): Effect.Effect<R>; readonly kind: string; readonly witness: R }",
		in.data.text,
	}
	if in.callable.text != "" {
		lib = append(lib, in.callable.text, "export type U<R> = Like<R> | Plat<R>")
	}
	lib = append(lib, holder, in.value.text)
	return map[string]string{
		"package.json": `{"type":"module"}`,
		"lib.ts":       strings.Join(lib, "\n") + "\n",
		"main.vibe":    "import { Thing, take } from \"./lib.ts\"\n\nexport const taken = " + call + "\n",
	}
}

const unionDataConfig = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true,"allowImportingTsExtensions":true}}`

// CheckUnionDataMember keeps actual TypeScript assignability for every
// destination; Function need not be interchangeable with a call signature.
func CheckUnionDataMember(t *testing.T, w *Workspace, in unionDataInput) {
	const target = "FuzzUnionDataMember"
	defer recoverCompilerPanic(t, target)
	unionFiles := in.project(true)
	g := &Gaps{Target: target, Input: unionFiles["lib.ts"] + "\n" + unionFiles["main.vibe"]}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/" + target + "/" + name
	}
	codes := func(files map[string]string) []string {
		r, err := w.Compile(t.Context(), Project{Files: files, Config: unionDataConfig})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var out []string
		for _, d := range r.Diagnostics {
			if d.Category().Name() == "error" {
				out = append(out, fmt.Sprintf("%s%d", d.Source(), d.Code()))
			}
		}
		slices.Sort(out)
		return out
	}
	nativeCodes := func(files map[string]string) []string {
		native := make(map[string]string, len(files))
		for name, text := range files {
			if name == "main.vibe" {
				name = "main.ts"
			}
			native[name] = text
		}
		return codes(native)
	}
	check := func(key string, files map[string]string) {
		vibe, native := codes(files), nativeCodes(files)
		if !slices.Equal(vibe, native) {
			g.Add(key+":"+in.holder.name, "VIP-1/detail303: %q; ordinary factory values follow native TypeScript assignability. Native: %v; VibeLang: %v\n%s\n%s", nativeFactoryQuote, native, vibe, files["lib.ts"], files["main.vibe"])
		}
	}
	requireNativeFactoryQuote(t)
	check("plain-call", unionFiles)
	if in.callable.name == "function" {
		twin := in
		twin.callable = functionTwin
		check("function-twin", twin.project(true))
	} else {
		check("data-call", in.project(false))
	}
	g.FinishInput(t, key)
}
