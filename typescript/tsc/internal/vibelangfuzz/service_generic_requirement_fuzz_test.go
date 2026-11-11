package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzServiceGenericRequirement checks service implementations against a
// member-local generic contract whose Effect requirement depends on the
// member's own type parameter, as alchemy's HTTP servers declare
// serve<Req>(handler) returning an Effect that needs
// Exclude<Req, HttpServerRequest>. Chapter 5 allows such a contract and makes
// the Shape the type an implementation has; Appendix B keeps EK3101 for a
// contract that admits no requirements. Every construct means one piece of
// Effect TypeScript, so each cell is judged by its .ts twin: the .vibe
// compiles without an error exactly when tsc accepts the twin. Two rules are
// negative controls whose body needs more than the contract admits.
//
// A key is <rule>/<form>/<host>/<decl>: the contract and the body the member
// returns, how the member is written, where the implementation stands, and
// how the contract is declared.

const serviceGenericTarget = "FuzzServiceGenericRequirement"

var serviceGenericQuotes = []struct{ chapter, text string }{
	{"005-services.md", "A member-local generic parameter is allowed when its contract is independent of outer parameters"},
	{"005-services.md", "`Users.Shape` is the members, the type an implementation has"},
	{"900-appendices.md", "a legacy provider reads a service at call time where its contract admits no requirements"},
	{"000-intro.md", "Every construct means one specific piece of Effect TypeScript, shown beside it in this specification."},
	{"000-intro.md", "| `service S { members }` | `class S extends Context.Service<S, { … }>()(\"key\") {}` |"},
	{"000-intro.md", "| `effect { … }` | `Effect.gen(function* () { … })` |"},
}

const serviceGenericHeader = `import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
export class Request extends Context.Service<Request, { readonly url: string }>()("Request") {}
export class Logger extends Context.Service<Logger, { readonly log: (line: string) => void }>()("Logger") {}
const provideRequest = <Req>(handler: Effect.Effect<void, never, Req>) => Effect.provideService(handler, Request, { url: "/" })
`

const serviceGenericEffectParam = "Effect.Effect<void, never, Req>"

type serviceGenericRule struct {
	name     string
	param    string // the handler parameter's type, over Req
	contract string // the requirement the contract admits, over Req
	body     string // the Effect the member returns, over handler
	accepts  bool   // tsc accepts the twin
}

var serviceGenericRules = []serviceGenericRule{
	{"exclude", serviceGenericEffectParam, "Exclude<Req, Request>", "provideRequest(handler)", true},
	{"exclude-wider", serviceGenericEffectParam, "Exclude<Req, Request> | Logger", "provideRequest(handler)", true},
	{"exclude-plus", serviceGenericEffectParam, "Exclude<Req, Request> | Logger", "Effect.andThen(Effect.service(Logger), provideRequest(handler))", true},
	{"exclude-scope", serviceGenericEffectParam, "Scope.Scope | Exclude<Req, Request>", "Effect.andThen(Effect.addFinalizer(() => Effect.void), provideRequest(handler))", true},
	{"callback", "(url: string) => Effect.Effect<void, never, Req>", "Exclude<Req, Request>", "provideRequest(handler(\"/\"))", true},
	{"identity", serviceGenericEffectParam, "Req", "handler", true},
	{"identity-plus", serviceGenericEffectParam, "Req | Logger", "Effect.andThen(Effect.service(Logger), handler)", true},
	{"negative-exclude", serviceGenericEffectParam, "Exclude<Req, Request>", "handler", false},
	{"negative-plus", serviceGenericEffectParam, "Req", "Effect.andThen(Effect.service(Logger), handler)", false},
}

// A template's twin is empty when the .ts twin is written the same way.
type serviceGenericTemplate struct{ name, vibe, twin string }

func (s serviceGenericTemplate) text(twin bool) string {
	if twin && s.twin != "" {
		return s.twin
	}
	return s.vibe
}

var serviceGenericForms = []serviceGenericTemplate{
	{"block", "serve: (handler) => effect { try {BODY} }", "serve: (handler) => Effect.gen(function* () { yield* {BODY} })"},
	{"arrow", "serve: (handler) => {BODY}", ""},
	{"gen", "serve: (handler) => Effect.gen(function* () { yield* {BODY} })", ""},
	{"method", "serve(handler) { return {BODY} }", ""},
	{"function", "serve: function (handler) { return {BODY} }", ""},
	{"annotated", "serve: <Req>(handler: {PARAM}) => {BODY}", ""},
}

var serviceGenericHosts = []serviceGenericTemplate{
	{"layer-effect", "export const ServerLive = Layer.effect(Server, effect {\n  return { {MEMBER} }\n})\n", "export const ServerLive = Layer.effect(Server, Effect.gen(function* () {\n  return { {MEMBER} }\n}))\n"},
	{"layer-succeed", "export const ServerLive = Layer.succeed(Server, { {MEMBER} })\n", ""},
	{"shape", "export const serverImpl: Context.Service.Shape<typeof Server> = { {MEMBER} }\n", ""},
}

const serviceGenericMethodDecl = "export class Server extends Context.Service<Server, {\n  serve<Req = never>(handler: {PARAM}): Effect.Effect<void, never, {REQ}>\n}>()(\"Server\") {}\n"

var serviceGenericDecls = []serviceGenericTemplate{
	{"property", "export class Server extends Context.Service<Server, {\n  serve: <Req = never>(handler: {PARAM}) => Effect.Effect<void, never, {REQ}>\n}>()(\"Server\") {}\n", ""},
	{"method", serviceGenericMethodDecl, ""},
	{"no-default", "export class Server extends Context.Service<Server, {\n  serve: <Req>(handler: {PARAM}) => Effect.Effect<void, never, {REQ}>\n}>()(\"Server\") {}\n", ""},
	{"service", "export service Server {\n  static readonly key = \"Server\"\n  serve<Req = never>(handler: {PARAM}): Effect.Effect<void, never, {REQ}>\n}\n", serviceGenericMethodDecl},
}

type serviceGenericCase struct {
	key              string
	rule             serviceGenericRule
	form, host, decl serviceGenericTemplate
}

func serviceGenericCases() []serviceGenericCase {
	var cases []serviceGenericCase
	for _, rule := range serviceGenericRules {
		for _, form := range serviceGenericForms {
			for _, host := range serviceGenericHosts {
				for _, decl := range serviceGenericDecls {
					key := rule.name + "/" + form.name + "/" + host.name + "/" + decl.name
					cases = append(cases, serviceGenericCase{key: key, rule: rule, form: form, host: host, decl: decl})
				}
			}
		}
	}
	return cases
}

func (c serviceGenericCase) source(twin bool) string {
	fill := strings.NewReplacer("{PARAM}", c.rule.param, "{REQ}", c.rule.contract, "{BODY}", c.rule.body)
	member := fill.Replace(c.form.text(twin))
	host := strings.ReplaceAll(c.host.text(twin), "{MEMBER}", member)
	return serviceGenericHeader + fill.Replace(c.decl.text(twin)) + host
}

// gapKey is the pending key of a cell: <rule>/<host> under a Layer, where
// every member form and contract declaration has one verdict, and
// <rule>/<form>/shape in the annotated const, where the form decides it.
func (c serviceGenericCase) gapKey() string {
	if c.host.name == "shape" {
		return c.rule.name + "/" + c.form.name + "/" + c.host.name
	}
	return c.rule.name + "/" + c.host.name
}

func serviceGenericErrors(t *testing.T, w *Workspace, name, source string) []string {
	t.Helper()
	r, err := w.Compile(t.Context(), Project{Files: map[string]string{name: source}})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	var problems []string
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			problems = append(problems, describe(d))
		}
	}
	return problems
}

// Many cells share a twin: an effect block's twin is Effect.gen, and a
// service declaration's twin is the class with a method signature.
var serviceGenericTwins sync.Map

func serviceGenericTwinErrors(t *testing.T, w *Workspace, source string) []string {
	t.Helper()
	if v, ok := serviceGenericTwins.Load(source); ok {
		return v.([]string)
	}
	problems := serviceGenericErrors(t, w, "main.ts", source)
	serviceGenericTwins.Store(source, problems)
	return problems
}

func checkServiceGeneric(t *testing.T, w *Workspace, c serviceGenericCase) {
	t.Helper()
	twin := c.source(true)
	twinProblems := serviceGenericTwinErrors(t, w, twin)
	if accepted := len(twinProblems) == 0; accepted != c.rule.accepts {
		t.Fatalf("the TypeScript twin of %s: tsc accepts it %v, the rule expects %v: %s\n%s", c.key, accepted, c.rule.accepts, strings.Join(twinProblems, "; "), twin)
	}
	files := map[string]string{"main.vibe": c.source(false)}
	problems := serviceGenericErrors(t, w, "main.vibe", files["main.vibe"])
	switch {
	case c.rule.accepts && len(problems) > 0:
		Gap(t, serviceGenericTarget, c.gapKey(), "Chapter 5: tsc accepts the twin of %s, whose implementation needs only what its member-local generic contract admits, but the .vibe reports: %s\n%s", c.key, strings.Join(problems, "; "), Archive(files))
	case !c.rule.accepts && len(problems) == 0:
		Gap(t, serviceGenericTarget, c.gapKey(), "Chapter 5: tsc rejects the twin of %s (%s), but the .vibe compiles without an error\n%s", c.key, strings.Join(twinProblems, "; "), Archive(files))
	}
	ExpectPending(t, serviceGenericTarget, c.gapKey())
}

func TestServiceGenericRequirementQuoted(t *testing.T) {
	for _, q := range serviceGenericQuotes {
		r4Quoted(t, q.chapter, q.text)
	}
}

// TestServiceGenericRequirementWitness compiles the alchemy minimum: a Layer
// whose serve member provides Request to a handler, under a contract that
// admits Exclude<Req, Request>, beside its Effect.gen twin.
func TestServiceGenericRequirementWitness(t *testing.T) {
	TestServiceGenericRequirementQuoted(t)
	raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "alchemy-http-generic-serve-requirement.json"))
	if err != nil {
		t.Fatal(err)
	}
	var witness struct{ Source, Main, Twin string }
	if err := json.Unmarshal(raw, &witness); err != nil {
		t.Fatal(err)
	}
	w := NewWorkspace(t)
	if problems := serviceGenericErrors(t, w, "main.ts", witness.Twin); len(problems) > 0 {
		t.Fatalf("tsc rejects the witness's twin: %s", strings.Join(problems, "; "))
	}
	files := map[string]string{"main.vibe": witness.Main}
	if problems := serviceGenericErrors(t, w, "main.vibe", witness.Main); len(problems) > 0 {
		Gap(t, serviceGenericTarget, "witness:alchemy-http-generic-serve-requirement", "Chapter 5: %s: %s\n%s", witness.Source, strings.Join(problems, "; "), Archive(files))
	}
	ExpectPending(t, serviceGenericTarget, "witness:alchemy-http-generic-serve-requirement")
}

func FuzzServiceGenericRequirement(f *testing.F) {
	startShortBudget(f)
	cases := serviceGenericCases()
	for _, key := range pendingSeedInputs(serviceGenericTarget, len(cases), func(i int) (string, string) {
		return cases[i].key, cases[i].gapKey()
	}) {
		f.Add(key)
	}

	f.Add("exclude/block/layer-effect/property")
	f.Add("identity/arrow/layer-succeed/method")
	f.Add("negative-exclude/method/shape/service")
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestServiceGenericRequirementQuoted(t)
		i := slices.IndexFunc(cases, func(c serviceGenericCase) bool { return c.key == key })
		if i < 0 {
			i = len(key) % len(cases)
		}
		checkServiceGeneric(t, w, cases[i])
		ExpectPending(t, serviceGenericTarget, specCorpusKey(t))
	})
}

func TestServiceGenericRequirementNeighborhood(t *testing.T) {
	SkipShortMatrix(t, serviceGenericTarget, "VIBELANG_SERVICE_GENERIC_MATRIX", "the complete rule, form, host and declaration matrix runs separately")
	TestServiceGenericRequirementQuoted(t)
	w := NewWorkspace(t)
	for _, c := range serviceGenericCases() {
		t.Run(c.key, func(t *testing.T) { checkServiceGeneric(t, w, c) })
	}
}

var _ = PendingCompanion(serviceGenericTarget, "TestServiceGenericRequirementWitness")
