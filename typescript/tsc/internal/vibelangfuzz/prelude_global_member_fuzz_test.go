package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzPreludeGlobalMember enforces 005-services rule 3: "These namespaces
// come in scope with the precedence above, so a subpath namespace whose name
// is a web platform global names Effect's." A bare Response, Headers, Event
// or Worker in a .vibe file is therefore Effect's module, and X.m draws
// TS2339 exactly when the module imported by name in a .ts file does: the
// compiler is compared with itself on two inputs the rule says agree
// (RULES.md 1). When the module lacks m and the global it shadows has it
// (globalThis.X.m type-checks in the .ts file), the error names
// globalThis.X.m; when globalThis.X.m does not type-check, the error must
// not send the reader there. Worker, and any global the DOM lib declares
// (VIP-33's derived ban), is platform code, so its note sends the reader to a
// .ts file instead and never names globalThis.X.m. The input picks the lib (the DOM, a Worker
// runtime's `declare var Response`, as @cloudflare/workers-types writes it,
// or a global class, which globalThis does not carry), the name and the
// member. alchemy's cloudflare-runtime called Response.json in a Worker
// (corpus alchemy-worker-response-json).
func FuzzPreludeGlobalMember(f *testing.F) {
	// Spec rule: docs/design/src/005-services.md#7711ce641e6528fa
	// Chapter 005: Worker resolves to Effect workers namespace and local bindings shadow it (FuzzPreludeGlobalMember).

	// Spec rule: docs/design/src/005-services.md#aa9219057240de73
	// Chapter 005: Worker resolves to Effect workers namespace and local bindings shadow it (FuzzPreludeGlobalMember).

	startShortBudget(f)
	preludeGlobalMemberRuling(f)
	for _, seed := range []string{
		"dom/Response/json", "dom/Response/redirect", "dom/Response/missing",
		"dom/Headers/prototype", "dom/Event/AT_TARGET", "dom/Worker/prototype",
		"workers/Response/json", "workers/Headers/prototype",
		"class/Response/json", "workers/Response/redirect", "workers/Response/missing",
	} {
		f.Add([]byte("prelude-global:" + seed))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckPreludeGlobalMember(t, w, parsePreludeGlobal(data))
	})
}

// TestPreludeGlobalMemberQuoted fails when rule 3 is reworded (RULES.md 9).
func TestPreludeGlobalMemberQuoted(t *testing.T) { preludeGlobalMemberRuling(t) }

const preludeGlobalMemberQuote = "These namespaces come in scope with the precedence above, so a subpath namespace whose name is a web platform global names Effect's."

const preludeHostOriginQuote = "A global is banned when the symbol has a declaration in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, none in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist below."
const preludeOwnDeclarationQuote = "and a project's own `declare var fetch` is not a host declaration."

func preludeGlobalMemberRuling(tb testing.TB) {
	tb.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		tb.Fatal(err)
	}
	if !strings.Contains(string(text), "The ban on `Worker` covers the host binding only: `globalThis.Worker`, `globalThis[\"Worker\"]` and `self.Worker` are `EK4402`.") {
		tb.Fatal("005-services no longer bans the host Worker binding")
	}
	for _, quote := range []string{preludeHostOriginQuote, preludeOwnDeclarationQuote} {
		if !strings.Contains(string(text), quote) {
			tb.Fatalf("005-services no longer says %q", quote)
		}
	}
	if !strings.Contains(string(text), preludeGlobalMemberQuote) {
		tb.Fatalf("005-services rule 3 no longer says %q", preludeGlobalMemberQuote)
	}
}

// preludeGlobalNames are rule 3's web platform globals, with the subpath
// that exports each.
var preludeGlobalNames = []unionChoice{
	{"Response", "effect/ai"},
	{"Headers", "effect/http"},
	{"Event", "effect/eventlog"},
	{"Worker", "effect/workers"},
}

// preludeGlobalMembers are statics of the globals (json, redirect, error,
// prototype, AT_TARGET), names Effect's modules may export, and a name
// neither has.
var preludeGlobalMembers = []string{"json", "redirect", "error", "prototype", "AT_TARGET", "empty", "fromInput", "make", "missing"}

// preludeGlobalLibs are the tsconfig lib and an ambient file of each.
var preludeGlobalLibs = []unionChoice{
	{"dom", ""},
	{"workers", "interface Response { readonly status: number }\ndeclare var Response: {\n  prototype: Response\n  new (body?: string | null): Response\n  json(data: unknown): Response\n  redirect(url: string, status?: number): Response\n}\n"},
	{"class", "declare class Response {\n  constructor(body?: string | null)\n  static json(data: unknown): Response\n  readonly status: number\n}\n"},
}

type preludeGlobalInput struct {
	lib, name unionChoice
	member    string
}

// parsePreludeGlobal reads `prelude-global:<lib>/<name>/<member>` (RULES.md
// 11), and otherwise picks from the bytes.
func parsePreludeGlobal(data []byte) preludeGlobalInput {
	find := func(choices []unionChoice, name string) unionChoice {
		for _, c := range choices {
			if c.name == name {
				return c
			}
		}
		return choices[0]
	}
	if rest, ok := strings.CutPrefix(string(data), "prelude-global:"); ok {
		parts := append(strings.Split(rest, "/"), "", "", "")
		member := parts[2]
		if member == "" {
			member = preludeGlobalMembers[0]
		}
		return preludeGlobalInput{find(preludeGlobalLibs, parts[0]), find(preludeGlobalNames, parts[1]), member}
	}
	at := func(i int) int {
		if i < len(data) {
			return int(data[i])
		}
		return 0
	}
	return preludeGlobalInput{preludeGlobalLibs[at(0)%len(preludeGlobalLibs)], preludeGlobalNames[at(1)%len(preludeGlobalNames)], preludeGlobalMembers[at(2)%len(preludeGlobalMembers)]}
}

func (in preludeGlobalInput) config() string {
	lib := `"ESNext"`
	if in.lib.name == "dom" {
		lib = `"ESNext", "DOM"`
	}
	return `{"compilerOptions":{"target":"ES2022","lib":[` + lib + `],"module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true}}`
}

// project is one main file, with the lib's ambient file.
func (in preludeGlobalInput) project(name, text string) Project {
	files := map[string]string{"package.json": `{"type":"module"}`, name: text}
	if in.lib.text != "" {
		files["runtime.d.ts"] = in.lib.text
	}
	return Project{Files: files, Config: in.config()}
}

// CheckPreludeGlobalMember compares bare X.m in a .vibe file with the
// imported module's X.m in a .ts file, and the TS2339's note with whether
// globalThis.X.m type-checks.
func CheckPreludeGlobalMember(t *testing.T, w *Workspace, in preludeGlobalInput) {
	const target = "FuzzPreludeGlobalMember"
	defer recoverCompilerPanic(t, target)
	x, m := in.name.name, in.member
	bare := "export const v = " + x + "." + m + "\n"
	g := &Gaps{Target: target, Input: in.lib.name + "\n" + bare}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/" + target + "/" + name
	}
	// missing returns the text of each TS2339 in file, flattened with its notes.
	missing := func(project Project, file string, allErrors bool) []string {
		r, err := w.Compile(t.Context(), project)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var out []string
		for _, d := range r.Diagnostics {
			if (d.Code() == 2339 || allErrors && d.Category() == diagnostics.CategoryError) && d.File() != nil && strings.HasSuffix(string(d.File().FileName()), "/"+file) {
				var b strings.Builder
				flatten(&b, d, 0)
				out = append(out, b.String())
			}
		}
		return out
	}
	vibe := missing(in.project("main.vibe", bare), "main.vibe", false)
	module := missing(in.project("main.ts", "import { "+x+" } from \""+in.name.text+"\"\n"+bare), "main.ts", false)
	global := missing(in.project("main.ts", "export const v = globalThis."+x+"."+m+"\n"), "main.ts", true)
	if (len(vibe) == 0) != (len(module) == 0) {
		g.Add("feature:prelude-global-member:bare-is-module", "005-services rule 3: %q; bare %s.%s is %s's %s, so it draws TS2339 exactly when the imported module does.\n.vibe: %q\n.ts importing %s: %q", preludeGlobalMemberQuote, x, m, in.name.text, x, vibe, in.name.text, module)
	}
	reach := "globalThis." + x + "." + m
	// VIP-33 (amended 10-29) derives the ban from the declaration: a member of a
	// global the DOM lib declares is EK4402 as globalThis.X.m, so the note sends
	// the reader to a .ts file, as it does for Worker. A Worker runtime's own
	// `declare var Response` is outside the ban, so its note still names globalThis.
	if x == "Worker" || in.lib.name == "dom" {
		if len(vibe) != 0 && len(global) == 0 && !strings.Contains(vibe[0], "platform code, which lives in a .ts file") {
			g.Add("feature:prelude-global-member:note-platform", "005-services and VIP-33 ban the host %s binding: its member note must send the reader to a .ts file:\n%s", x, vibe[0])
		}
		if len(vibe) != 0 && strings.Contains(vibe[0], reach) {
			g.Add("feature:prelude-global-member:note-advises-banned", "VIP-33: %s is EK4402, so the note must not advise it:\n%s", reach, vibe[0])
		}
		g.FinishInput(t, key)
		return
	}
	named := len(vibe) != 0 && strings.Contains(vibe[0], reach)
	switch {
	case len(vibe) != 0 && len(global) == 0 && !named:
		g.Add("feature:prelude-global-member:note-names-global", "%s.%s draws TS2339 on Effect's module, and %s type-checks, but the error does not name it:\n%s", x, m, reach, vibe[0])
	case named && len(global) != 0:
		g.Add("feature:prelude-global-member:note-without-global", "the error names %s, which does not type-check (%q):\n%s", reach, global, vibe[0])
	}
	g.FinishInput(t, key)
}
