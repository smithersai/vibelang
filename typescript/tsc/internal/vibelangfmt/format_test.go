package vibelangfmt

import (
	"bytes"
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

var update = flag.Bool("update", false, "rewrite the golden files of TestFormatGolden")

// forms holds one source per VibeLang form, written as an author might, so
// a test sees each form's TypeScript form and its round trip.
var forms = map[string]string{
	"effect": `effect function load(id: string) {   return try find(id) }
export effect function save(user: User) { try write(user) }
export default effect function () { return 1 }
async function get(url: string) { return await fetch(url) }
class Users {
  effect find(id: string) { return try lookup(id) }
  async load() { return 1 }
}
const tools = { effect five() { return 5 }, effect: 1 }
const each = effect (n: number) => try double(n)
const one = effect n => n
const run = effect {
  try yieldNow()
  return 1
}
const later = Effect.retry(effect { try save(user) }, policy)
`,
	"effect types": `type Find = (id: string) => User!NotFound
type Release = (version: string) => string!!Approval
type Load = () => string!!
function hello(id: string): string!NotFound!Users {
  return getUser(id).name
}
`,
	"declarations": `/** A missing user. */
export error NotFound { id: string }
error Timeout
error Wrapped<T> {
  cause: T
  mutable attempts: number
}
service Users {
  find(id: string): User!NotFound
  region: string
}
control Approval {
  approve(request: string): boolean!!
}
export service Search: SearchApi {
  static readonly layer = Layer.succeed(Search, searchApi)
}
service Prefix: string
service Format: (value: string) => string!!
schema Account {
  id: string
  nickname?: string
  role: "admin" | "member"
}
export schema Code = "root_missing" | "read_failed"
schema Point = { x: number; y?: number }
interface Cart { id: string; mutable items: Array<string>; mutable [key: string]: unknown }
`,
	"data": `/** A parcel on its way (D307). */
export data Delivery {
  Waiting
  /** Handed to the carrier. */
  Sent { tracking: string; carrier?: string }
  Rejected {
    reason: string
    mutable note: string
  }
}
data LoadState<A, E> { Idle; Loaded { value: A }; Failed { error: E } }
data Answer { Yes, No }
function describe(d: Delivery) {
  return match (d) {
    when Delivery.Waiting: "waiting";
    when Delivery.Sent { let tracking }: tracking;
    default: "rejected";
  }
}
`,
	"error classes": `/** The base of a family (D278, D304). */
export abstract error AppError implements Coded {
  _tag: string
  code: string
  mutable attempts: number
  static readonly family = "app"
  constructor(code: string) {
    super({ code: code.trim(), attempts: 0 })
  }
  get label(): string { return this.code }
  override toJSON(): Record<string, unknown> { return { code: this.code } }
}
export error NotFound extends AppError { path: string }
error Timeout extends AppError
error Typed<T extends string> extends AppError implements Coded
schema error FsError { _tag: string; method: string; path?: string }
schema error Missing extends FsError {
  attempts: number
  describe(): string { return this.method }
}
export schema error Plain extends FsError
`,
	"block params": `const UsersLive = Layer.effect(Users) {
  const seen = new Set<string>()
  return { find(id) { return getUser(id) }, region: "eu" }
}
function greetUser(id: string) {
  return withSpan("greetUser") {
    const user = getUser(id)
    return user.name
  }
}
it.live("finds a user") {
  assert.strictEqual(getUser("1").name, "Ada")
}
const traced = (id: string) => withSpan("traced") { return id }
const fresh = Layer.unwrap { return Layer.empty }
`,
	"match and is": `function describe(e: NotFound | Timeout) {
  return match (e) {
    when NotFound and { let id }: ` + "`no user ${id}`" + `;
    when Timeout: "retry";
  }
}
function phase(p: string) { return match (p) { when "a": 1; default: 2; } }
function failed(outcome: Exit.Exit<User, NotFound>) {
  if (outcome is Exit.Failure(let cause) && Cause.hasFails(cause)) return Cause.pretty(cause)
  return outcome is Exit.Success
}
function statement(x: number) {
  match (x) {
    when 1: log("one");
    default: log("other");
  }
}
`,
	"catch and throw": `function nameOrGuest(id: string) {
  return getUser(id).name catch "guest"
}
function nameOrReason(id: string) {
  return getUser(id).name catch (e) => match (e) {
    when NotFound: ` + "`no user ${e.id}`" + `;
  }
}
function find(users: Map<string, User>, id: string) {
  return users.get(id) ?? throw new NotFound({ id })
}
const chained = a() catch b() catch 1
const typed = (x as number) catch 0
`,
	"try clauses": `function describe(id: string) {
  try {
    return getUser(id).name
  } catch (e) {
    return match (e) {
      when NotFound: "missing";
      default: throw e;
    }
  } finally {
    log("done")
  }
}
function auto(version: string) {
  try {
    return release(version)
  } handle Approval.approve(request) {
    resume(true)
  }
}
function answered(version: string) {
  try {
    return release(version)
  } handle Approval.approve(request) {
    resume(request.length > 0)
  } catch (e) {
    return match (e) { when NotFound: "missing"; default: throw e; }
  } finally {
    log("released")
  }
}
function tracked() {
  try {
    return getUser("1")
  } finally (exit) {
    log(` + "`lookup ${exit._tag}`" + `)
  }
}
function single() {
  try { return read() } catch (e) { return e is Gone ? e.id : "other" }
}
`,
	"blocks and fibers": `function label(id: string) {
  const name = do {
    const user = getUser(id)
    if (user.name.length > 3) user.name
    else "short"
  }
  return name
}
function program() {
  provide UsersLive {
    return Users.find("1")
  }
}
function roll(): number!! {
  provide Logger.layer([]), Random = seeded {
    return Random.nextInt()
  }
}
function guarded() {
  uninterruptible {
    const user = getUser("1")
    restore {
      return { user, orders: getOrders(user.id) }
    }
  }
}
function both() {
  const user = fork getUser("1")
  fork {
    while (true) {
      log("tick")
    }
  }
  return [join user, join [user]]
}
function many() {
  const [user, orders] = await.all [getUser("1"), getOrders("1")]
  const pair = await.allSettled { user: getUser("1") }
  return await.race [user, do { sleep("1 second"); "timeout" }]
}
function logAll(ids: string[]) {
  for concurrent(8) (const id of ids) log(getUser(id).name)
  for concurrent (const id of ids) {
    log(id)
  }
}
`,
	// Superseded and retired forms still parse, so the formatter keeps them:
	// the layer declaration (D221), service class (D223), with (D172),
	// select (EK4607), and typed and repeated catch clauses (D216).
	"retired and older forms": `layer UsersLive: Users {
  const directory = Directory()
  find(id) { return directory.get(id) }
  readonly region = "eu"
}
service class Accounts {
  find(id: string): Account!NotFound
}
function f(jobs: Queue.Queue<string>) {
  with UsersLive {
    select {
      case const job = jobs.take(): run(job)
      default: idle()
    }
  }
  const fiber = fork read()
  return await fiber
}
function typed(id: string) {
  try {
    return getUser(id).name
  } catch (e: NotFound) {
    return "missing"
  } catch (e: Timeout | Offline) {
    return "slow"
  } catch (e) {
    return "other"
  } finally {
    log("done")
  }
}
`,
	"pipes and hatches": `function piped() {
  return getUser("1") |> retry(%, Schedule.recurs(2)) |> timeout(%, "1 second")
}
function modulo(n: number) { return n |> % % 2 |> (% ? 1 : 0) }
function nullish(a?: number) { return a ?? 1 |> % + 1 }
function hatches(text: string) {
  const id = sync(crypto.randomUUID())
  const parsed = try((text) => JSON.parse(text), (error) => new BadJson({ error }), text)
  return callback<number>((resume) => resume(parsed + id))
}
`,
	// Module declarations (D283): the body is TypeScript, and a module
	// specifier may be the module's name.
	"module declarations": `module text {
  import { Effect } from "effect"
  export function clean(value: string): string { return value.trim() }
  export const later = async (value: string) => await Promise.resolve(value)
  export default class Counter { count = 0 }
}
module config {
  export const level = await Promise.resolve(3)
}
module setup {
  console.log("setup ran")
}
import Counter, { clean } from text
import setup
import * as settings from config
export { clean as tidy } from text
export * from config
function cleaned(value: string): string!! {
  return sync(() => clean(value)) |> % + settings.level
}
`,
	// A file whose TypeScript form has no import or export of its own, so
	// only the module's body may await.
	"a module that awaits": `module config {
  export const level = await Promise.resolve(3)
}
`,
}

// TestEncodingWritesModuleSpecifiersAsStrings checks that the TypeScript form
// of a file with module declarations keeps each declaration's head as written
// and gives every import and export a string specifier, which dprint's
// TypeScript parser requires after from. Before D283 support the formatter
// refused such a file, changing nothing: "no TypeScript form for VibeLang
// syntax kind 100" (a module) or "101" (an identifier specifier).
func TestEncodingWritesModuleSpecifiersAsStrings(t *testing.T) {
	t.Parallel()
	enc, err := encode("x.vibe", forms["module declarations"])
	if err != nil {
		t.Fatal(err)
	}
	for _, head := range []string{"module text {\n", "module config {\n", "module setup {\n"} {
		if !strings.Contains(enc.text, head) {
			t.Fatalf("the TypeScript form lost %q:\n%s", head, enc.text)
		}
	}
	file := parser.ParseSourceFile(typeScriptOptions, enc.text, core.ScriptKindTS)
	specifiers := 0
	for _, statement := range file.Statements.Nodes {
		var specifier *ast.Node
		switch statement.Kind {
		case ast.KindImportDeclaration:
			specifier = statement.AsImportDeclaration().ModuleSpecifier
		case ast.KindExportDeclaration:
			specifier = statement.AsExportDeclaration().ModuleSpecifier
		default:
			continue
		}
		if specifier.Kind != ast.KindStringLiteral {
			t.Fatalf("a %v specifier in the TypeScript form:\n%s", specifier.Kind, enc.text)
		}
		specifiers++
	}
	if specifiers != 5 {
		t.Fatalf("found %d string specifiers, want 5:\n%s", specifiers, enc.text)
	}
	// TypeScript's import = require takes a module specifier too.
	source := "import legacy = require(text)\n"
	enc, err = encode("x.vibe", source)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(enc.text, `require("./`+enc.sentinel+`text")`) {
		t.Fatalf("require kept its identifier:\n%s", enc.text)
	}
	if decoded, err := enc.decode(enc.text); err != nil || decoded != source {
		t.Fatalf("round trip gave %q, %v", decoded, err)
	}
}

// TestEncodingRoundTrips checks that decoding the TypeScript form of each
// form, unformatted, gives back the source exactly.
func TestEncodingRoundTrips(t *testing.T) {
	t.Parallel()
	for name, source := range forms {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			enc, err := encode(name, source)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(enc.text, "!NotFound") || strings.Contains(enc.text, "|>") || strings.Contains(enc.text, " catch \"") {
				t.Fatalf("VibeLang syntax left in the TypeScript form:\n%s", enc.text)
			}
			decoded, err := enc.decode(enc.text)
			if err != nil {
				t.Fatalf("%v\nTypeScript form:\n%s", err, enc.text)
			}
			if decoded != source {
				t.Fatalf("round trip changed the file:\n%s\nTypeScript form:\n%s", decoded, enc.text)
			}
		})
	}
}

// TestFormatRejects checks the files Format refuses rather than change.
func TestFormatRejects(t *testing.T) {
	t.Parallel()
	identity := func(text string) (string, error) { return text, nil }
	cases := []struct{ name, source, message string }{
		{"syntax error", "const x = (\n", "1:"},
		{"comment between a call and its block", "const v = withSpan(\"x\") /* why */ {\n  return 1\n}\n", "comment inside VibeLang syntax"},
		{"comment between try clauses", "function f() {\n  try {\n    a()\n  } handle Ask.answer(q) {\n    resume(true)\n  } // next\n  catch (e) {\n    c()\n  }\n}\n", "comment between the clauses"},
		// A module body's own syntax errors, which the .vibe file's tree does
		// not hold (D283), are reported at their place in the .vibe file.
		{"syntax error in a module body", "module text {\n  export const a = (\n}\nimport { a } from text\n", "vibelang format: 2:21: module text: Expression expected"},
		{"VibeLang syntax in a module body", "module text {\n  error Bad { reason: string }\n}\n", "vibelang format: 2:3: module text: Unexpected keyword or identifier"},
		{"module declaration below the top level", "function f() {\n  module inner {\n    export const a = 1\n  }\n}\n", "vibelang format: 2:3: module inner is not at the file's top level"},
		{"module declaration without a name", "module {\n  export const a = 1\n}\n", "vibelang format: 1:1: a module declaration needs a name"},
		{"nested module declaration without a name", "function f() {\n  module {\n    export const a = 1\n  }\n}\n", "vibelang format: 2:3: a module declaration needs a name"},
		{"module declared twice", "module text {\n  export const a = 1\n}\nmodule text {\n  export const b = 2\n}\n", "vibelang format: 4:1: module text is declared twice"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			_, err := Format("x.vibe", c.source, identity)
			if err == nil || !strings.Contains(err.Error(), c.message) {
				t.Fatalf("got %v, want an error containing %q", err, c.message)
			}
		})
	}
}

// TestFormatRefusesChangedPrograms checks that a formatter that changes the
// program fails the file.
func TestFormatRefusesChangedPrograms(t *testing.T) {
	t.Parallel()
	swapped := func(text string) (string, error) { return strings.Replace(text, "a + b", "a - b", 1), nil }
	if _, err := Format("x.vibe", "const v = withSpan(\"x\") { return a + b }\n", swapped); err == nil || !strings.Contains(err.Error(), "changed the program") {
		t.Fatalf("got %v, want a changed-program error", err)
	}
	// A module body's tree is checked too, though the .vibe file's tree holds
	// none of it.
	if _, err := Format("x.vibe", "module text {\n  export const v = a + b\n}\n", swapped); err == nil || !strings.Contains(err.Error(), "changed the program") {
		t.Fatalf("got %v, want a changed-program error for a module body", err)
	}
	// So is the module an identifier specifier names.
	renamed := func(text string) (string, error) { return strings.Replace(text, "text\"", "texts\"", 1), nil }
	if _, err := Format("x.vibe", "import { clean } from text\n", renamed); err == nil || !strings.Contains(err.Error(), "changed the program") {
		t.Fatalf("got %v, want a changed-program error for a module specifier", err)
	}
}

// TestSameProgram checks what the program comparison ignores and what it
// reports.
func TestSameProgram(t *testing.T) {
	t.Parallel()
	cases := []struct{ name, before, after, message string }{
		{"import order", "import { b } from \"./b\"\nimport { a } from \"a\"\n", "import { a } from \"a\"\nimport { b } from \"./b\"\n", "1:"},
		{"export declaration order", "export { b } from \"./b\"\nexport * from \"./a\"\n", "export * from \"./a\"\nexport { b } from \"./b\"\n", "1:"},
		{"module reference order", "export { a as b } from text\nexport * from config\n", "export * from config\nexport { a as b } from text\n", "1:"},
		{"module body import order", "module text {\n  import { b } from \"./b\"\n  import { a } from \"a\"\n}\n", "module text {\n  import { a } from \"a\"\n  import { b } from \"./b\"\n}\n", "became"},
		{"module body", "module text {\n  export const v = a + b\n}\n", "module text {\n  export const v = a - b\n}\n", "module text: 2:20: operator"},
		{"module body syntax", "module text {\n  export const v = 1\n}\n", "module text {\n  export const v = (\n}\n", "module text: vibelang format: 2:21"},
		{"module reference", "import { a } from text\n", "import { a } from texts\n", "1:19: \"./vibelang-format.vibe.text.js\" became"},
		{"braces around an if's statement", "function f(x: number) {\n  if (x > 1) { return x } else { return 0 }\n  for (const y of [x]) { log(y) }\n}\n", "function f(x: number) {\n  if (x > 1) return x\n  else return 0\n  for (const y of [x]) log(y)\n}\n", ""},
		{"braces that keep an else with its if", "if (a) { if (b) f() } else g()\n", "if (a) if (b) f()\nelse g()\n", "1:1: KindIfStatement has 3 children, then 2"},
		{"braces around a declaration", "if (a) { function f() {} }\n", "if (a) function f() {}\n", "1:8: KindBlock became KindFunctionDeclaration"},
		{"an ASI guard before a parenthesized statement", "function f() {\n  (() => {\n    g()\n  })()\n}\n", "function f() {\n  ;(() => {\n    g()\n  })()\n}\n", ""},
		{"an empty statement that is an if's body", "if (a) ;\nelse g()\n", "if (a) g()\n", "1:1:"},
		{"exports across a statement", "export * from \"./b\"\nconst x = 1\nexport * from \"./a\"\n", "export * from \"./a\"\nconst x = 1\nexport * from \"./b\"\n", "1:15:"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			err := SameProgram(c.before, c.after)
			if c.message == "" && err != nil || c.message != "" && (err == nil || !strings.Contains(err.Error(), c.message)) {
				t.Fatalf("got %v, want %q", err, c.message)
			}
		})
	}
}

// TestFormatModuleBodyAsTypeScript checks that a module declaration's body
// formats exactly as the same statements in a .ts file, imports preserved,
// indented one level inside the braces.
func TestFormatModuleBodyAsTypeScript(t *testing.T) {
	formatter := dprintFormatter(t)
	body := "import { b } from './b.ts'\nimport { a } from \"a\"\n\n  export function f(x: number) { if (x > 1) { return [a, b] } return [] }\nexport type T = { x: number, y: string }\n"
	alone, err := formatter(body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(alone, "import { b } from \"./b.ts\"\nimport { a } from \"a\"\n") {
		t.Fatalf("dprint changed the import order of a .ts file:\n%s", alone)
	}
	got, err := Format("x.vibe", "module text {\n"+body+"}\n", formatter)
	if err != nil {
		t.Fatal(err)
	}
	var want strings.Builder
	want.WriteString("module text {\n")
	for line := range strings.Lines(alone) {
		if strings.TrimSpace(line) != "" {
			want.WriteString("  ")
		}
		want.WriteString(line)
	}
	want.WriteString("}\n")
	if got != want.String() {
		t.Fatalf("formatted:\n%s\nwant:\n%s", got, want.String())
	}
}

// TestFormatModuleBodiesAtLineWidth checks that a module body whose line
// ends near the line width, where formatting the body alone and then
// indenting it could disagree, formats the same way twice.
func TestFormatModuleBodiesAtLineWidth(t *testing.T) {
	formatter := dprintFormatter(t)
	for width := 118; width <= 121; width++ {
		call := "export const greeting = (name: string, place: string) => Effect.succeed(`hello ${name} ${place}`, extra, more)"
		call = strings.Replace(call, "extra", "extra"+strings.Repeat("x", width-len(call)), 1)
		object := "export const config = { alpha: 1, beta: \"two\", gamma: [1, 2, 3], delta: { epsilon: true }, zeta: \"\" }"
		object = strings.Replace(object, `zeta: ""`, `zeta: "`+strings.Repeat("y", width-len(object))+`"`, 1)
		for _, line := range []string{call, object} {
			source := "module text {\n  " + line + "\n}\n"
			once, err := Format("x.vibe", source, formatter)
			if err != nil {
				t.Fatal(err)
			}
			twice, err := Format("x.vibe", once, formatter)
			if err != nil {
				t.Fatal(err)
			}
			if once != twice {
				t.Errorf("a %d-character line is not idempotent:\n%s\nthen:\n%s", len(line), once, twice)
			}
		}
	}
}

// TestFormatModuleCases formats the main.vibe of each compiler case that
// declares modules and compiles, and checks that the result is stable.
func TestFormatModuleCases(t *testing.T) {
	formatter := dprintFormatter(t)
	inputs, err := filepath.Glob(filepath.Join("..", "..", "..", "vibelang", "cases", "module-declaration*", "main.vibe"))
	if err != nil || len(inputs) == 0 {
		t.Skipf("no module declaration cases: %v", err)
	}
	for _, input := range inputs {
		t.Run(filepath.Base(filepath.Dir(input)), func(t *testing.T) {
			source, err := os.ReadFile(input)
			if err != nil {
				t.Fatal(err)
			}
			once, err := Format(input, string(source), formatter)
			if strings.HasPrefix(string(source), "// expect: EK4408\n") {
				if err == nil || !strings.Contains(err.Error(), "a module declaration needs a name") {
					t.Fatalf("expected the nameless-module syntax refusal, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			twice, err := Format(input, once, formatter)
			if err != nil {
				t.Fatal(err)
			}
			if once != twice {
				t.Fatalf("not idempotent:\n%s\nthen:\n%s", once, twice)
			}
		})
	}
}

// dprintFormatter formats TypeScript with the dprint named by VIBELANG_DPRINT
// and testdata/dprint.json, the Smithers repository's TypeScript style. The
// tests that need it skip without it.
func dprintFormatter(t *testing.T) TypeScriptFormatter {
	t.Helper()
	binary := os.Getenv("VIBELANG_DPRINT")
	if binary == "" {
		t.Skip("set VIBELANG_DPRINT to a dprint binary to run the formatter tests")
	}
	config, err := filepath.Abs(filepath.Join("testdata", "dprint.json"))
	if err != nil {
		t.Fatal(err)
	}
	return func(text string) (string, error) {
		command := exec.Command(binary, "fmt", "--config", config, "--stdin", "file.ts")
		command.Stdin = strings.NewReader(text)
		var stdout, stderr bytes.Buffer
		command.Stdout, command.Stderr = &stdout, &stderr
		if err := command.Run(); err != nil {
			return "", &formatterError{err: err, stderr: stderr.String()}
		}
		return stdout.String(), nil
	}
}

type formatterError struct {
	err    error
	stderr string
}

func (e *formatterError) Error() string { return e.err.Error() + ": " + e.stderr }

// TestFormatGolden formats each testdata/format/*.vibe file, compares the
// result with its .golden file, and checks that formatting the result again
// changes nothing.
func TestFormatGolden(t *testing.T) {
	formatter := dprintFormatter(t)
	inputs, err := filepath.Glob(filepath.Join("testdata", "format", "*.vibe"))
	if err != nil || len(inputs) == 0 {
		t.Fatalf("no golden inputs: %v", err)
	}
	for _, input := range inputs {
		t.Run(filepath.Base(input), func(t *testing.T) {
			source, err := os.ReadFile(input)
			if err != nil {
				t.Fatal(err)
			}
			got, err := Format(input, string(source), formatter)
			if err != nil {
				t.Fatal(err)
			}
			golden := strings.TrimSuffix(input, ".vibe") + ".golden"
			if *update {
				if err := os.WriteFile(golden, []byte(got), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			want, err := os.ReadFile(golden)
			if err != nil {
				t.Fatalf("%v (run with -update to write it)", err)
			}
			if got != string(want) {
				t.Fatalf("formatted:\n%s\nwant:\n%s", got, want)
			}
			again, err := Format(golden, got, formatter)
			if err != nil {
				t.Fatal(err)
			}
			if again != got {
				t.Fatalf("formatting is not idempotent; the second pass gives:\n%s", again)
			}
		})
	}
}

// TestFormatForms formats every form and checks that the result is stable
// and the same program.
func TestFormatForms(t *testing.T) {
	formatter := dprintFormatter(t)
	for name, source := range forms {
		t.Run(name, func(t *testing.T) {
			once, err := Format(name, source, formatter)
			if err != nil {
				t.Fatal(err)
			}
			twice, err := Format(name, once, formatter)
			if err != nil {
				t.Fatal(err)
			}
			if once != twice {
				t.Fatalf("not idempotent:\n%s\nthen:\n%s", once, twice)
			}
		})
	}
}

var vibeBlock = regexp.MustCompile("(?s)```vibe[^\n]*\n(.*?)```")

// TestFormatDocsCorpus formats every vibe block of the user docs that parses,
// and checks that formatting succeeds, keeps the program, and is stable.
func TestFormatDocsCorpus(t *testing.T) {
	formatter := dprintFormatter(t)
	docs := filepath.Join("..", "..", "..", "..", "docs", "user", "src")
	var pages []string
	err := filepath.WalkDir(docs, func(path string, entry os.DirEntry, err error) error {
		if err == nil && !entry.IsDir() && strings.HasSuffix(path, ".md") {
			pages = append(pages, path)
		}
		return err
	})
	if err != nil {
		t.Skipf("no user docs: %v", err)
	}
	formatted, skipped := 0, 0
	for _, page := range pages {
		text, err := os.ReadFile(page)
		if err != nil {
			t.Fatal(err)
		}
		for i, match := range vibeBlock.FindAllStringSubmatch(string(text), -1) {
			source := match[1]
			if _, err := encode(page, source); err != nil && strings.Contains(err.Error(), "vibelang format: ") && !strings.Contains(err.Error(), "internal error") && !strings.Contains(err.Error(), "comment") {
				skipped++
				continue // a block that does not parse, such as one showing a syntax error
			}
			name := filepath.Base(page) + "#" + strconv.Itoa(i)
			once, err := Format(name, source, formatter)
			if err != nil {
				t.Errorf("%s: %v\n%s", name, err, source)
				continue
			}
			twice, err := Format(name, once, formatter)
			if err != nil {
				t.Errorf("%s: second pass: %v\n%s", name, err, once)
				continue
			}
			if once != twice {
				t.Errorf("%s: not idempotent:\n%s\nthen:\n%s", name, once, twice)
			}
			formatted++
		}
	}
	t.Logf("formatted %d docs blocks from %d pages; skipped %d that do not parse", formatted, len(pages), skipped)
	if formatted < 500 {
		t.Fatalf("formatted only %d docs blocks", formatted)
	}
}

// TestFormatModuleBodiesTheHostLeavesUnchanged checks that a module whose
// body the TypeScript formatter returns as it is, as a dprint host without a
// TypeScript plugin answers, formats to itself every time.
func TestFormatModuleBodiesTheHostLeavesUnchanged(t *testing.T) {
	unchanged := func(text string) (string, error) { return text, nil }
	for _, source := range []string{
		"module disk {\n  export const read = (path: string): string => path\n}\n",
		"module disk {\n  import { readFileSync } from \"node:fs\"\n\n  export const read = (path: string): string => readFileSync(path, \"utf8\")\n}\n\nimport { read } from disk\n\nexport const text = read(\"a\")\n",
	} {
		got, err := Format("x.vibe", source, unchanged)
		if err != nil {
			t.Fatal(err)
		}
		if got != source {
			t.Errorf("formatted:\n%s\nwant:\n%s", got, source)
		}
	}
}

// Windows formatters may return CRLF while protected VibeLang text retains LF.
func TestWindowsLineEndings(t *testing.T) {
	for name, input := range forms {
		t.Run(name, func(t *testing.T) {
			source := strings.ReplaceAll(input, "\n", "\r\n")
			got, err := Format("windows.vibe", source, func(text string) (string, error) {
				return text, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(strings.ReplaceAll(got, "\r\n", ""), "\n") {
				t.Fatalf("mixed line endings: %q", got)
			}
		})
	}
}

func TestWindowsSingleLineModule(t *testing.T) {
	source := "module text { export const n = 1 }\r\n"
	got, err := Format("windows.vibe", source, func(text string) (string, error) { return text, nil })
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.ReplaceAll(got, "\r\n", ""), "\n") {
		t.Fatalf("mixed line endings: %q", got)
	}
}
