package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-55's workflow-body rules, read from the services chapter: a body is a
// plan of durable steps over pure code. Each generated body joins statements
// from a keyed pool; the expected codes are the union of each statement's.
var workflowBodyQuotes = []string{
	"In it, `try` runs a durable step: a call of a task or a workflow, `W.child(…)`, or `try.all`, `try.race` or `try.any` over such calls. Any other operand of `try`, such as a service, `sleep(…)` or `succeed(…)`, is `EK5504`.",
	"A workflow's `effect call` reads no clock (`Date.now()`, `new Date()`, `performance.now()`), no randomness (`Math.random()`, `crypto.randomUUID()`, `crypto.getRandomValues()`) and no module-level `let` or `var` of its file: `EK5505`.",
	"A loop statement, or an assignment, `++` or `--` to a variable, in a workflow's own `effect call` is `EK5506`, once for each loop.",
	"A workflow whose `try W(…)` steps reach the workflow again, directly or through other workflows, is `EK5507`.",
	"`W.to(…)` anywhere but as a `return` operand is `EK5508`.",
}

func workflowBodyRulesQuoted(tb testing.TB) {
	tb.Helper()
	chapter := SpecText("005-services.md")
	for _, quote := range workflowBodyQuotes {
		if !strings.Contains(chapter, quote) {
			tb.Fatalf("workflow body rule changed: %q", quote)
		}
	}
}

func TestWorkflowBodyRulesQuoted(t *testing.T) { workflowBodyRulesQuoted(t) }

// workflowStatement is one statement of a generated body; %d makes its
// bindings unique, and code is what the rules say it draws ("" admits it).
type workflowStatement struct {
	key, source, code string
}

var workflowStatements = []workflowStatement{
	{"step", "const n%d = try Fetch(id)", ""},
	{"all", "const [a%d, b%[1]d] = try.all [Fetch(id), Fetch(`${id}!`)]", ""},
	{"race", "const r%d = try.race [Fetch(id), Child(id)]", ""},
	{"child", "const c%d = try Child.child(id)", ""},
	{"workflow", "const w%d = try Child(id)", ""},
	{"pure", "const p%d = id.length * 2", ""},
	{"branch", "if (id === \"stop%d\") return 0", ""},
	{"helper", "const h%d = double(id.length)", ""},
	{"service", "const u%d = try Users", "EK5504"},
	{"sleep", "try sleep(\"%d millis\")", "EK5504"},
	{"succeed", "const [s%d] = try.all [succeed(1)]", "EK5504"},
	{"clock", "const t%d = Date.now()", "EK5505"},
	{"date", "const d%d = new Date()", "EK5505"},
	{"random", "const q%d = Math.random()", "EK5505"},
	{"module-let", "const m%d = counter", "EK5505"},
	{"for-of", "for (const ch%d of id) { }", "EK5506"},
	{"while", "while (id.length > %d00) { }", "EK5506"},
	{"reassign", "let v%d = 0; v%[1]d = 1", "EK5506"},
	{"increment", "let i%d = 0; i%[1]d++", "EK5506"},
	{"handoff", "const o%d = Self.to(id)", "EK5508"},
	{"self", "const e%d = try Self(id)", "EK5507"},
}

func workflowStatementByKey(key string) workflowStatement {
	if i := slices.IndexFunc(workflowStatements, func(s workflowStatement) bool { return s.key == key }); i >= 0 {
		return workflowStatements[i]
	}
	if key == "" {
		return workflowStatements[0]
	}
	return workflowStatements[int(key[0])%len(workflowStatements)]
}

const workflowBodyPrelude = `let counter = 0
const double = (n: number) => n * 2

service Users { static readonly key = "fuzz/Users"; find(id: string): string!never }

task Fetch {
  static readonly retryPolicy = { initialMs: 1, factor: 2, maxMs: 4, maxAttempts: 2 }
  effect call(id: string): number!string { return id.length }
}

workflow Child {
  effect call(id: string): number!string { return try Fetch(id) }
}
`

func FuzzWorkflowBodyRules(f *testing.F) {
	startShortBudget(f)
	workflowBodyRulesQuoted(f)
	for _, s := range workflowStatements {
		f.Add(s.key, "", "")
		f.Add("step", s.key, "pure")
	}
	f.Add("loop", "self", "clock")
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, first, second, third string) {
		var keys []string
		want := map[string]bool{}
		var body []string
		for i, key := range []string{first, second, third} {
			if i > 0 && key == "" {
				continue
			}
			s := workflowStatementByKey(key)
			keys = append(keys, s.key)
			body = append(body, fmt.Sprintf(s.source, i+1))
			if s.code != "" {
				want[s.code] = true
			}
		}
		source := workflowBodyPrelude + "\nworkflow Self {\n  effect call(id: string): number!string {\n    " + strings.Join(body, "\n    ") + "\n    return 1\n  }\n}\nexport {}\n"
		files := map[string]string{"main.vibe": source}
		r, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := map[string]bool{}
		var other []string
		for _, d := range r.Diagnostics {
			key := diagnosticKey(d)
			if strings.HasPrefix(key, "EK55") {
				got[key] = true
			} else if d.Category() == diagnostics.CategoryError {
				other = append(other, specDiagnosticText(d))
			}
		}
		precise := "body:" + strings.Join(keys, "+")
		if len(other) != 0 {
			Gap(t, "FuzzWorkflowBodyRules", precise+":other", "only the workflow rules may report: %v\n%s", other, Archive(files))
		}
		for code := range want {
			if !got[code] {
				Gap(t, "FuzzWorkflowBodyRules", precise+":missing:"+code, "the rules say %s, the compiler reported %v\n%s", code, got, Archive(files))
			}
		}
		for code := range got {
			if !want[code] {
				Gap(t, "FuzzWorkflowBodyRules", precise+":extra:"+code, "the rules admit this body, the compiler reported %s\n%s", code, Archive(files))
			}
		}
	})
}
