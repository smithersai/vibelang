package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// FuzzUnionDataMember enforces D430: "a call signature or method of the
// target whose return type is neither definitely an Effect nor a union with
// such a member is not matched by a source signature or method whose return
// type is definitely an Effect: that check is EK4301". A value that only a
// union target's member with no call signature takes meets no call
// signature of the target, so it draws exactly the diagnostics it draws
// when the parameter names that member alone. This compares the compiler
// with itself on two inputs the ruling says agree (RULES.md 1). The input
// picks the data member (plain, generic with a required or an optional
// witness), the callable member (plain, generic, none), how the parameter
// holds the union (directly, a type parameter it constrains, an array of
// either) and the value (an Effect-returning resource class, a record, a
// resource the callable member also takes, which stays EK4301).
// alchemy's Provider.effect(Resource, …) and Provider.collection([Account,
// Certificate]) pass resource classes this way (corpus
// alchemy-union-data-member-generic).
//
// The callable member Function is checked against D513: "a destination whose
// type is a function type returning a type that is not definitely an Effect,
// `Function`, or a type parameter that only the function fixes whose
// constraint is one of these, gives the plain form". Function and
// (...args: any) => any are in the same row, so a union with one reports
// what the union with the other does (corpus
// union-data-member-function-constrained, React's useCallback<T extends
// Function> shape).
func FuzzUnionDataMember(f *testing.F) {
	startShortBudget(f)
	unionDataMemberRuling(f)
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

// TestUnionDataMemberQuoted fails when D430 is reworded (RULES.md 9).
func TestUnionDataMemberQuoted(t *testing.T) { unionDataMemberRuling(t) }

const unionDataMemberQuote = "a call signature or method of the target whose return type is neither definitely an Effect nor a union with such a member is not matched by a source signature or method whose return type is definitely an Effect: that check is EK4301"

const functionDestinationQuote = "a destination whose type is a function type returning a type that is not definitely an Effect, `Function`, or a type parameter that only the function fixes whose constraint is one of these, gives the plain form"

func unionDataMemberRuling(tb testing.TB) {
	tb.Helper()
	text, err := os.ReadFile(filepath.Join(Root(), "docs/design/history/DECISIONS.md"))
	if err != nil {
		tb.Fatal(err)
	}
	if !strings.Contains(string(text), unionDataMemberQuote) {
		tb.Fatalf("D430 no longer says %q", unionDataMemberQuote)
	}
	if !strings.Contains(string(text), functionDestinationQuote) {
		tb.Fatalf("D513 no longer says %q", functionDestinationQuote)
	}
}

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

// functionTwin is the callable member D513 puts in Function's row.
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

// CheckUnionDataMember compares the codes of the union program with those of
// the data-member program. A value the callable member also takes meets that
// member's call signature, which returns any, so D430 requires EK4301,
// including through a type parameter's declared constraint (D513). A generic
// callable whose marker is incompatible with the inferred witness is instead
// excluded by the completed call's instantiation.
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
	union := codes(unionFiles)
	if in.callable.name == "function" {
		twin := in
		twin.callable = functionTwin
		if other := codes(twin.project(true)); !slices.Equal(other, union) {
			g.Add("feature:union-function-member", "D513: %q; Function and (...args: any) => any give the same form, so the two unions report the same codes.\nwith Function: %v\nwith (...args: any) => any: %v\n%s\n%s", functionDestinationQuote, union, other, unionFiles["lib.ts"], unionFiles["main.vibe"])
		}
		g.FinishInput(t, key)
		return
	}
	// A direct generic callable matches the inferred marker only when W
	// comes solely from platform (the phantom/plain data member). Witnesses,
	// explicit number, and the later callback fix W to number instead.
	markerMismatch := in.callable.name == "plat-generic" &&
		!strings.HasPrefix(in.holder.name, "constrained") &&
		(in.data.name != "plain" || strings.HasPrefix(in.holder.name, "explicit") || strings.HasPrefix(in.holder.name, "later"))
	if in.value.name == "platform-resource" && in.callable.text != "" && !markerMismatch {
		if !slices.Contains(union, "EK4301") {
			g.Add("feature:union-callable-member", "D430: %q; the union's callable member takes %s, and its call signature returns any, so the Effect-returning value is EK4301.\nunion: %v\n%s\n%s", unionDataMemberQuote, in.value.name, union, unionFiles["lib.ts"], unionFiles["main.vibe"])
		}
		g.FinishInput(t, key)
		return
	}
	alone := codes(in.project(false))
	if !slices.Equal(alone, union) {
		g.Add("feature:union-data-member", "D430: %q; the union's callable member takes no %s, so the program reports what the data member alone does.\ndata member alone: %v\nunion: %v\n%s\n%s", unionDataMemberQuote, in.value.name, alone, union, unionFiles["lib.ts"], unionFiles["main.vibe"])
	}
	g.FinishInput(t, key)
}
