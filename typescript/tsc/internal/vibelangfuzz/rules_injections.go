package vibelangfuzz

// A ruleInjection violates exactly one rule of Chapter 28's registry, as
// Hephaestus (Chaliasos et al., PLDI 2022) and Thalia inject one type error
// into a well-typed program: placed in any slot it lists, in any host, it
// must draw its code at its text and no other error.
//
// In Decls, Text and Files, $$ stands for a suffix that varies the names an
// injection declares. Text is the violation; ⟦…⟧ marks the part the
// diagnostic must stand in when it is narrower than all of Text. Quote is
// words of the code's registry row, the clause the injection violates;
// TestSpecRuleTable checks that the row still says them, so a row that
// changes sends its injections back for review.
type ruleInjection struct {
	Code  int32
	Name  string
	Quote string
	Slots []string
	Decls string            // .vibe top-level declarations the text needs; never reported
	Text  string            // the violation
	Files map[string]string // more files, such as a .ts module that Decls imports
	DOM   bool              // the text uses a DOM global
	Flat  bool              // the text must stand directly in its slot, not in a nested block
	// Category is the category of this form when it is not the code's
	// default, as EK4408's warning for a name collision; Quote names it.
	Category string
	// MaxReports is how many diagnostics one violation may draw, where the
	// row's wording names more than one site, as two services that share a
	// key do; zero means one.
	MaxReports int
	// Site "file" lets the diagnostic stand anywhere in the injected text's
	// file, for a row that reports a fact about the whole program.
	Site string
}

// Key returns the injection's pending key, such as "ek:EK4601/await-call".
func (inj *ruleInjection) Key() string {
	return "ek:" + specCodeName(inj.Code) + "/" + inj.Name
}

var (
	top        = []string{slotTop, slotFile}
	stmt       = []string{slotEffect, slotPlain}
	effectOnly = []string{slotEffect}
)

// loadDecl is an Effect function: it runs an Effect, so a call of it runs a
// program (Chapter 13). A written `number!!` contract alone would not make it
// one: a body that runs nothing under `!!` keeps the plain path (Chapter 15).
const loadDecl = "function load$$() {\n  yieldNow();\n  return 1;\n}"

var ruleInjections = []*ruleInjection{
	// Chapter 13: a module's top level declares.
	{Code: 1001, Name: "top-call", Quote: "A module's top level runs a program", Slots: top,
		Decls: loadDecl, Text: "export const top$$ = load$$();"},
	{Code: 1001, Name: "top-provide", Quote: "A module's top level runs a program", Slots: top,
		Decls: "service Nm$$ {\n  name(): string!!\n}\nconst NmLive$$ = Layer.succeed(Nm$$, { name() { return \"Ada\"; } });",
		Text:  "provide NmLive$$ {\n  const inside$$ = 1;\n}"},
	{Code: 1001, Name: "top-provide-calls", Quote: "A module's top level runs a program", Slots: top,
		Decls: "service Nm$$ {\n  name(): string!!\n}\nconst NmLive$$ = Layer.succeed(Nm$$, { name() { return \"Ada\"; } });",
		Text:  "provide NmLive$$ {\n  Console.log(Nm$$.name());\n}"},
	{Code: 1001, Name: "top-throw", Quote: "or a throw can escape it", Slots: top,
		Decls: "error Bad$$", Text: "if (1 + 1 === 2) throw new Bad$$();"},
	{Code: 1001, Name: "field-initializer", Quote: "a class field's initializer or a default parameter value runs a program", Slots: []string{slotMember},
		Decls: loadDecl, Text: "readonly field$$ = load$$();"},
	{Code: 1001, Name: "default-parameter", Quote: "a class field's initializer or a default parameter value runs a program", Slots: top,
		Decls: loadDecl, Text: "export function defaulted$$(n = load$$()) {\n  return n;\n}"},
	{Code: 1001, Name: "default-throw", Quote: "a throw expression in a parameter default included", Slots: top,
		Decls: "error Bad$$", Text: "export function defaultedThrow$$(n: number = throw new Bad$$()) {\n  return n;\n}"},
	{Code: 1001, Name: "static-block", Quote: "or a constructor, an accessor, or a static block runs a program", Slots: top,
		Decls: loadDecl, Text: "export class Static$$ {\n  static {\n    load$$();\n  }\n}"},

	// Chapters 8 and 10: function* declares a producer.
	{Code: 1002, Name: "effect-gen", Quote: "A `function*` passed to an API whose parameter returns a library Generator or Iterator, such as `Effect.gen`", Slots: effectOnly,
		Text: "const gen$$ = Effect.gen(function* () {\n  return 1;\n});"},

	// Chapter 10: a call already waits (D283); an async function means what it
	// means in TypeScript (VIP-1), so only for await and await using remain.
	{Code: 1003, Name: "for-await", Quote: "`async`, `for await`, or `await using`", Slots: effectOnly,
		Text: "for await (const x$$ of [1, 2]) {\n  Console.log(x$$);\n}"},

	// Chapter 6: using needs a block a program runs.
	{Code: 1004, Name: "top-using", Quote: "`using` at a module's top level", Slots: top,
		Decls: "declare function open$$(path: string): Disposable;", Text: "using log$$ = open$$(\"/tmp/app.log\");"},
	{Code: 1004, Name: "static-using", Quote: "or in a class static block", Slots: top,
		Decls: "declare function open$$(path: string): Disposable;", Text: "export class Registry$$ {\n  static {\n    using scope = open$$(\"/tmp/registry\");\n  }\n}"},

	// Chapter 13: a runner inside code a fiber runs.
	{Code: 1005, Name: "run-promise", Quote: "A runner inside code that a fiber runs", Slots: effectOnly,
		Decls: "function later$$() {\n  sleep(\"1 millis\");\n  return \"later\";\n}", Text: "runPromise(later$$());"},

	// Chapter 5: pipes (D156).
	{Code: 1006, Name: "no-topic", Quote: "A pipe whose body does not use its topic", Slots: stmt,
		Text: "const label$$ = \"name\" |> \"anonymous\";"},
	{Code: 1007, Name: "topic-outside", Quote: "`%` outside every pipe's body", Slots: stmt,
		Text: "const half$$ = % / 2;"},

	// Chapter 4: the old keyword of provide (D172).
	{Code: 1009, Name: "with", Quote: "a `provide` block written with its old keyword, `with`", Slots: effectOnly,
		Decls: "service Nm$$ {\n  name(): string!!\n}\nconst NmLive$$ = Layer.succeed(Nm$$, { name() { return \"Ada\"; } });",
		Text:  "with NmLive$$ {\n  Console.log(Nm$$.name());\n}"},

	// Chapter 3: a throw expression takes a unary operand (D186).
	{Code: 1010, Name: "throw-binary", Quote: "An unparenthesized throw expression is, or ends, a binary operator's left operand", Slots: effectOnly,
		Decls: "error Fail$$ { code: string }\nfunction fail$$(): string!Fail$$! {\n  throw new Fail$$({ code: \"unknown\" });\n}",
		Text:  "const equal$$ = fail$$() catch (f) => throw f.code === \"unknown\";"},

	// Chapter 15: effect is not installed (D4).
	{Code: 1011, Name: "no-effect", Quote: "A function compiles to an Effect, but the program cannot find effect's Effect type", Slots: []string{slotNoEffect},
		Text: "export function broken$$(n: number) {\n  if (n < 0) throw \"negative\";\n  return n;\n}"},

	// Chapter 13: a call that never succeeds is stored.
	{Code: 1012, Name: "stored-never", Quote: "a call that runs and never succeeds is stored in a variable", Slots: effectOnly,
		Decls: "const forever$$ = () => {\n  while (true) {\n    sleep(\"1 second\");\n  }\n};",
		Text:  "const never$$ = forever$$();"},

	// Chapters 3, 4, 9, 11: a comma in a class body (D278, D307).
	{Code: 1013, Name: "error-comma", Quote: "A comma after a field of an `error`", Slots: top,
		Text: "error Stock$$ { sku: string, available: number }"},
	{Code: 1013, Name: "data-comma", Quote: "or after a variant or a variant's field of a `data` declaration", Slots: top,
		Text: "data Point$$ {\n  Flat { x: number, y: number }\n}"},

	// Chapter 13: yield* outside a generator.
	{Code: 1015, Name: "yield-star", Quote: "yield* outside a generator", Slots: effectOnly,
		Decls: "function name$$(): string!! {\n  return \"x\";\n}", Text: "const value$$ = yield* name$$();"},

	// Chapter 13: an unexported main that nothing references.
	{Code: 1016, Name: "unexported-main", Quote: "an otherwise valid module defines a zero-argument, unexported `main` that nothing references", Slots: []string{slotFile},
		Text: "function main() {\n  Console.log(\"hello\");\n}"},

	// Chapter 4: provide is a statement.
	{Code: 1017, Name: "provide-expression", Quote: "`provide` used as an expression instead of a statement", Slots: effectOnly,
		Text: "const n$$ = provide Layer.empty { return 1 };"},

	// Chapters 2 and 14: contracts.
	{Code: 2001, Name: "throw-escapes", Quote: "An expected failure escapes the written contract", Slots: top,
		Decls: "error NotFound$$ { id: string }", Text: "export function find$$(id: string): string!! {\n  if (id === \"\") throw new NotFound$$({ id });\n  return id;\n}"},
	{Code: 2001, Name: "call-escapes", Quote: "An expected failure escapes the written contract", Slots: top,
		Decls: "error NotFound$$ { id: string }\nfunction lookup$$(id: string): string!NotFound$$! {\n  if (id === \"\") throw new NotFound$$({ id });\n  return id;\n}",
		Text:  "export function find$$(id: string): string!! {\n  return lookup$$(id);\n}"},
	{Code: 2002, Name: "requirement-escapes", Quote: "A requirement escapes the written contract", Slots: top,
		Decls: "service Outside$$ { value: number }", Text: "export function needs$$(): number!! {\n  return Outside$$().value;\n}"},
	{Code: 2003, Name: "plain-runs-effect", Quote: "A plain annotation on a function or method whose body runs an Effect", Slots: top,
		Decls: loadDecl, Text: "export function bare$$(): number {\n  load$$();\n  return 1;\n}"},
	{Code: 2003, Name: "plain-throw", Quote: "or a plain annotation on a function, or a generator method, whose throw or trusted call's listed failure can escape", Slots: top,
		Decls: "error Bad$$", Text: "export function check$$(n: number): number {\n  if (n < 0) throw new Bad$$();\n  return n;\n}"},
	{Code: 2003, Name: "plain-method", Quote: "A plain annotation on a function or method whose body runs an Effect", Slots: []string{slotMember},
		Decls: loadDecl, Text: "bare$$(): number {\n    return load$$();\n  }"},
	{Code: 2003, Name: "constructor-throw", Quote: "or a throw or listed failure that can escape a constructor, an accessor or a class static block", Slots: top,
		Decls: "error Bad$$", Text: "export class Checked$$ {\n  constructor(n: number) {\n    if (n < 0) throw new Bad$$();\n  }\n}"},

	// Chapter 3: a catch that cannot catch an expected failure (D238, D282).
	{Code: 2004, Name: "dead-catch", Quote: "a catch whose try block has E = `never`, in an Effect or a plain function", Slots: stmt,
		Text: "try {\n  const inner$$ = 1;\n} catch (e) {\n  const caught$$ = 2;\n}"},
	{Code: 2004, Name: "dead-catch-expression", Quote: "or a catch expression with no expected errors", Slots: stmt,
		Text: "const constant$$ = 1 catch 2;"},

	// Chapter 9: resumeWith runs at the perform site.
	{Code: 2005, Name: "resume-with-service", Quote: "A `resumeWith` program that needs a service", Slots: top,
		Decls: "service Secret$$ {\n  read(): string!!\n}\ncontrol Ask$$ {\n  ask(question: string): string!!\n}",
		Text:  "function secret$$() {\n  try {\n    return Ask$$.ask(\"password\");\n  } handle Ask$$.ask(question) {\n    resumeWith(() => Secret$$.read());\n  }\n}"},

	// Chapter 17: a jump out of finally.
	{Code: 2006, Name: "continue-finally", Quote: "A `return`, `break`, or `continue` that leaves a `finally` block", Slots: stmt,
		Text: "for (const item$$ of [1, 2]) {\n  try {\n    const seen$$ = item$$;\n  } finally {\n    continue;\n  }\n}"},
	{Code: 2006, Name: "return-finally", Quote: "A `return`, `break`, or `continue` that leaves a `finally` block", Slots: top,
		Text: "export function swallow$$(n: number) {\n  try {\n    return n;\n  } finally {\n    return -1;\n  }\n}"},

	// Chapter 14: declarations without bodies need Effect contracts.
	{Code: 2101, Name: "service-bare", Quote: "A service or control method without a body whose return type is not an Effect type", Slots: top,
		Text: "service Bare$$ {\n  find(id: string): string\n}"},
	{Code: 2101, Name: "control-bare", Quote: "A service or control method without a body whose return type is not an Effect type", Slots: top,
		Text: "control Ask$$ {\n  ask(question: string): string\n}"},
	{Code: 2102, Name: "recursive-success", Quote: "A recursive Effect function whose success, catch-variable, or return type needs a contract", Slots: top,
		Decls: "error Negative$$ { n: number }",
		Text:  "export function countDown$$(n: number) {\n  if (n < 0) throw new Negative$$({ n });\n  if (n === 0) return 0;\n  return countDown$$(n - 1) + 1;\n}"},

	// Chapter 4: declarations of services and layers.
	{Code: 2103, Name: "service-body", Quote: "A member of a `service` or `control` declaration with a body or an initializer", Slots: top,
		Text: "service Users$$ {\n  find(id: string): string!!\n  describe(id: string) {\n    return id;\n  }\n}"},
	{Code: 2103, Name: "service-initializer", Quote: "A member of a `service` or `control` declaration with a body or an initializer", Slots: top,
		Text: "service Region$$ {\n  region = \"eu\"\n}"},
	{Code: 2103, Name: "shape-self", Quote: "or any instance member of `service Name: Type`", Slots: top,
		Text: "interface Api$$ {\n  find(query: string): string!!\n}\nservice Search$$: Api$$ {\n  limit: number\n}"},
	{Code: 2104, Name: "layer-setup-after", Quote: "A setup statement of an old `layer` declaration that follows one of its members", Slots: top,
		Decls: "service Counter$$ {\n  next(): number!!\n}",
		Text:  "layer CounterLive$$: Counter$$ {\n  next() {\n    return 1;\n  }\n  const start = 0\n}"},

	// Chapter 3: retired typed catch clauses.
	{Code: 2105, Name: "untagged-clause", Quote: "A retired typed catch clause whose type has a member without a literal `_tag`", Slots: effectOnly,
		Decls: "error Busy$$", Text: "try {\n  throw new Busy$$();\n} catch (e: Error) {\n  Console.log(\"error\");\n}"},
	{Code: 2106, Name: "clause-after-all", Quote: "A retired catch clause after one that catches every failure", Slots: effectOnly,
		Decls: "error Busy$$\nerror Offline$$",
		Text:  "try {\n  if (1 + 1 === 2) throw new Busy$$();\n  throw new Offline$$();\n} catch (e) {\n  Console.log(\"any\");\n} catch (e: Busy$$) {\n  Console.log(\"busy\");\n}"},

	// Chapter 9: handle statements.
	{Code: 2107, Name: "handle-service", Quote: "A handle clause whose control is not a control declaration", Slots: top,
		Decls: "service Users$$ {\n  find(id: string): string!!\n}",
		Text:  "function handled$$() {\n  try {\n    return Users$$.find(\"1\");\n  } handle Users$$.find(id) {\n    resume(\"Ada\");\n  }\n}"},
	{Code: 2108, Name: "missing-clause", Quote: "A handle statement that leaves an operation of a control it handles without a clause", Slots: top,
		Decls: "control Approval$$ {\n  approve(request: string): boolean!!\n  note(text: string): void!!\n}",
		Text:  "function partial$$() {\n  try {\n    return Approval$$.approve(\"x\");\n  } handle Approval$$.approve(request) {\n    resume(true);\n  }\n}"},
	{Code: 2108, Name: "two-clauses", Quote: "or gives one two clauses", Slots: top,
		Decls: "control Approval$$ {\n  approve(request: string): boolean!!\n}",
		Text:  "function twice$$() {\n  try {\n    return Approval$$.approve(\"x\");\n  } handle Approval$$.approve(request) {\n    resume(true);\n  } handle Approval$$.approve(request) {\n    resume(false);\n  }\n}"},

	// Chapter 11: schema fields.
	{Code: 2109, Name: "function-field", Quote: "A field of a `schema` declaration whose type has no schema form", Slots: top,
		Text: "schema Hooked$$ {\n  callback: () => void\n}"},

	// Chapter 9: handle(...) and resume's result (D97).
	{Code: 2110, Name: "resume-result", Quote: "A clause of a `handle(...)` call reads the result of a `resume` that is not its last step", Slots: top,
		Decls: "control Steps$$ {\n  first(): void!!\n  second(): void!!\n}\nfunction work$$() {\n  Steps$$.first();\n  Steps$$.second();\n  return 42;\n}",
		Text:  "export function expression$$() {\n  return handle(() => work$$(), Steps$$, {\n    first(k) {\n      const n: number = resume(k, undefined);\n      return n.toFixed(1);\n    },\n    second(k) {\n      return \"early\";\n    }\n  });\n}"},

	// Chapter 6: restore needs uninterruptible.
	{Code: 2111, Name: "restore-outside", Quote: "A `restore` block that no `uninterruptible` block of the same function encloses", Slots: effectOnly,
		Text: "restore {\n  sleep(\"1 millis\");\n}"},

	// Chapter 3: retired catch spellings (D216, D217).
	{Code: 2112, Name: "typed-clause", Quote: "a catch clause that tests a failure's type, `catch (e: NotFound)`", Slots: effectOnly,
		Decls: "error NotFound$$\nfunction load$$(): string!NotFound$$! {\n  throw new NotFound$$();\n}",
		Text:  "try {\n  Console.log(load$$());\n} catch (e: NotFound$$) {\n  Console.log(\"missing\");\n}"},
	{Code: 2112, Name: "typed-expression", Quote: "including an expression handler", Slots: effectOnly,
		Decls: "error NotFound$$\nfunction load$$(): string!NotFound$$! {\n  throw new NotFound$$();\n}",
		Text:  "const named$$ = load$$() catch (e: NotFound$$) => \"missing\";"},
	{Code: 2113, Name: "cause-clause", Quote: "a catch clause typed `Cause`", Slots: effectOnly,
		Decls: "error NotFound$$\nfunction load$$(): string!NotFound$$! {\n  throw new NotFound$$();\n}",
		Text:  "try {\n  Console.log(load$$());\n} catch (cause: Cause) {\n  Console.log(\"fallback\");\n}"},
	{Code: 2114, Name: "catch-in-hatch", Quote: "A catch expression, `x catch y` or `x catch (e) => …`, inside a hatch body", Slots: effectOnly,
		Text: "const parsed$$ = sync(() => JSON.parse(\"{}\") catch null);"},
	{Code: 2114, Name: "catch-in-hatch-statement", Quote: "A catch expression, `x catch y` or `x catch (e) => …`, inside a hatch body", Slots: []string{slotHatch, slotAsyncHatch},
		Text: "const parsed$$ = JSON.parse(\"{}\") catch null;"},

	// Chapter 3: error families (D278, D279, D304).
	{Code: 2117, Name: "base-without-tag", Quote: "a subclass whose base's tag type does not include the subclass's name", Slots: top,
		Text: "error Base$$ { code: string }\nerror Child$$ extends Base$$ { extra: number }"},
	{Code: 2117, Name: "extends-class", Quote: "an error that extends a class that is not an error", Slots: top,
		Text: "class Plain$$ {\n  readonly x = 1;\n}\nerror Child$$ extends Plain$$"},
	{Code: 2117, Name: "own-tag", Quote: "a concrete error whose `_tag` field's type does not include its own name", Slots: top,
		Text: "error Named$$ { _tag: \"Other\" }"},
	{Code: 2118, Name: "fields-no-constructor", Quote: "A subclass that declares fields and no constructor, whose base's constructor takes something other than one object of fields", Slots: top,
		Decls: "error Base$$ {\n  _tag: string\n  code: string\n  constructor(code: string, note: string) {\n    super({ code: `${code}:${note}` });\n  }\n}",
		Text:  "error Child$$ extends Base$$ { extra: number }"},

	// Chapter 9: a resumed clause's return and the answer type (D351).
	{Code: 2119, Name: "answer-type", Quote: "A `return` of a handle statement's clause that some path reaches after a non-tail `resume`", Slots: top,
		Decls: "control Step$$ {\n  go(): void!!\n}",
		Text:  "export function unsound$$() {\n  try {\n    Step$$.go();\n    Step$$.go();\n    return 1;\n  } handle Step$$.go() {\n    return resume().toFixed(0);\n  }\n}"},

	// Chapter 4: old spellings (D221, D223).
	{Code: 2120, Name: "service-class", Quote: "a `service class` or `control class` declaration", Slots: top,
		Text: "service class Names$$ {\n  name(): string!!\n}"},
	{Code: 2120, Name: "control-class", Quote: "a `service class` or `control class` declaration", Slots: top,
		Text: "control class Approval$$ {\n  approve(request: string): boolean!!\n}"},
	{Code: 2121, Name: "layer", Quote: "a `layer` declaration, the old spelling", Slots: top,
		Decls: "service Names$$ {\n  name(): string!!\n}", Text: "layer NamesLive$$: Names$$ {\n  name() { return \"Ada\" }\n}"},

	// Chapter 11: data declarations (D307).
	{Code: 2122, Name: "no-variants", Quote: "A `data` declaration without variants", Slots: top,
		Text: "data Empty$$ {}"},
	{Code: 2123, Name: "twice", Quote: "A `data` declaration that declares a variant twice", Slots: top,
		Text: "data Twice$$ {\n  Same\n  Same { x: string }\n}"},
	{Code: 2124, Name: "dollar-is", Quote: "a variant named `$is` or `$match`", Slots: top,
		Text: "data Reserved$$ {\n  $is\n  Fine\n}"},
	{Code: 2124, Name: "tag-field", Quote: "a variant's field named `_tag`", Slots: top,
		Text: "data Reserved$$ {\n  Tagged { _tag: string }\n}"},
	{Code: 2125, Name: "method", Quote: "A member of a `data` variant that is not a field", Slots: top,
		Text: "data Members$$ {\n  Method { run(): void }\n}"},
	{Code: 2125, Name: "mutable", Quote: "or a `mutable` field", Slots: top,
		Text: "data Members$$ {\n  Mutable { mutable count: number }\n}"},
	{Code: 2126, Name: "five-parameters", Quote: "A `data` declaration with more than four type parameters", Slots: top,
		Text: "data Five$$<A, B, C, D, E> {\n  Five { a: A; e: E }\n}"},
	{Code: 2126, Name: "constrained", Quote: "or a constrained one", Slots: top,
		Text: "data Bound$$<A extends string> {\n  Bound { a: A }\n}"},
	{Code: 2127, Name: "unknown-variant", Quote: "`Name.Variant` where `Name` is a data type without that variant", Slots: stmt,
		Decls: "data Delivery$$ {\n  Waiting\n  Sent { tracking: string }\n}",
		Text:  "const typo$$ = Delivery$$.Snet({ tracking: \"parcel-8\" });"},

	// Chapters 3 and 17: throw takes a failure, not a Cause (D406).
	{Code: 2140, Name: "throw-cause", Quote: "A `throw` whose operand's type is a Cause type", Slots: top,
		Text: "function rethrown$$(cause: Cause<string>) {\n  throw cause;\n}"},

	// Chapter 4: services are keys.
	{Code: 3001, Name: "shared-key", Quote: "Two services share a key", Slots: top,
		MaxReports: 2,
		Text:       "function first$$() {\n  abstract class Local$$ {\n    abstract value(): Effect<number, never, never>\n  }\n  return Local$$;\n}\nfunction second$$() {\n  abstract class Local$$ {\n    abstract value(): Effect<string, never, never>\n  }\n  return Local$$;\n}"},
	{Code: 3002, Name: "extends-service", Quote: "A class extends a service", Slots: top,
		Decls: "service Users$$ {\n  find(id: string): string!!\n}", Text: "class UsersInMemory$$ extends Users$$ {}"},
	{Code: 3003, Name: "new-service", Quote: "`new` on a service", Slots: stmt,
		Decls: "service Users$$ {\n  find(id: string): string!!\n}", Text: "const users$$ = new Users$$();"},
	{Code: 3004, Name: "instanceof-service", Quote: "`instanceof` on a service", Slots: stmt,
		Decls: "service Users$$ {\n  find(id: string): string!!\n}", Text: "const isUsers$$ = ({} as unknown) instanceof Users$$;"},
	{Code: 3005, Name: "generic-service", Quote: "A generic service class", Slots: top,
		Text: "service Box$$<T>: ReadonlyArray<T>"},
	{Code: 3006, Name: "static-shadow", Quote: "A static member with the same name as a service member", Slots: top,
		Decls: "interface SearchApi$$ {\n  find(query: string): string!!\n}",
		Text:  "service Search$$: SearchApi$$ {\n  static find(query: string) {\n    return query;\n  }\n}"},
	{Code: 3101, Name: "per-call-lookup", Quote: "A provider looks a service up per call where the contract allows no requirements", Slots: top,
		Decls: "service Database$$ {\n  query(sql: string): string!!\n}\nservice Audit$$ {\n  record(entry: string): void!!\n}\nservice Users$$ {\n  find(id: string): string!!\n}",
		Text:  "export const UsersAudited$$ = Layer.effect(Users$$) {\n  const db = Database$$();\n  return {\n    find(id) {\n      Audit$$.record(id);\n      return db.query(id);\n    }\n  };\n}"},
	{Code: 3201, Name: "runner-missing", Quote: "No provider for a required service", Slots: top,
		Decls: "service Mailer$$ {\n  send(to: string): void!!\n}\nfunction welcome$$() {\n  Mailer$$.send(\"ada\");\n}",
		Text:  "Effect.runFork(() => welcome$$());"},
	{Code: 3202, Name: "two-providers", Quote: "Two providers for one service", Slots: top,
		Decls: "service Users$$ {\n  find(id: string): string!!\n}\nconst UsersLive$$ = Layer.succeed(Users$$, { find: (id) => `live-${id}` });\nconst UsersTest$$ = Layer.succeed(Users$$, { find: (id) => `test-${id}` });",
		Text:  "export const App$$ = wire(UsersLive$$, UsersTest$$);"},
	{Code: 3203, Name: "cycle", Quote: "Providers form a cycle", Slots: top,
		Decls: "service Cache$$ {\n  get(key: string): string!!\n}\nservice Database$$ {\n  query(sql: string): string!!\n}\nconst CacheLive$$ = Layer.effect(Cache$$) {\n  const db = Database$$();\n  return { get: (key) => db.query(key) };\n}\nconst DatabaseLive$$ = Layer.effect(Database$$) {\n  const cache = Cache$$();\n  return { query: (sql) => cache.get(sql) };\n}",
		Text:  "export const App$$ = wire(CacheLive$$, DatabaseLive$$);"},
	{Code: 3204, Name: "opaque-layer", Quote: "A `wire` argument whose type does not name its outputs", Slots: top,
		Decls: "service Users$$ {\n  find(id: string): string!!\n}\nconst UsersOpaque$$: Layer.Any = Layer.succeed(Users$$, { find: (id) => `user-${id}` });",
		Text:  "export const App$$ = wire(UsersOpaque$$);"},
	{Code: 3205, Name: "entry-needs", Quote: "An entry module's `main` needs a service that nothing provides when the host starts the module", Slots: []string{slotFile},
		Decls: "service Needed$$ {\n  value: number\n}", Text: "export function main() {\n  return Needed$$().value;\n}"},
	{Code: 3206, Name: "two-platforms", Quote: "A file names a second, different platform with a platform import", Slots: []string{slotFile},
		Text: "import \"vibelang/platform/node\"\nimport \"vibelang/platform/browser\"\n\nexport function main() {\n  Console.log(\"two\");\n}"},
	{Code: 3207, Name: "string-provider", Quote: "A provider that is not a layer, a non-empty list of layers, a `Context`, or `Key = value`", Slots: effectOnly,
		Text: "const notALayer$$ = \"x\";\nprovide notALayer$$ {\n  Console.log(\"inside\");\n}"},
	{Code: 3207, Name: "any-provider", Quote: "or `any`", Slots: effectOnly,
		Text: "const anything$$: any = 1;\nprovide anything$$ {\n  Console.log(\"inside\");\n}"},

	// Chapters 8, 9 and 16: handlers cover their own fiber (D402).
	{Code: 4201, Name: "forked-operation", Quote: "A control operation inside a combinator that runs it on another fiber", Slots: top,
		Decls: "control Approval$$ {\n  approve(request: string): boolean!!\n}",
		Text:  "function approveAll$$(ids: ReadonlyArray<string>) {\n  return Effect.forEach(ids, (id) => Approval$$.approve(id), { concurrency: 4 });\n}"},
	{Code: 4202, Name: "typescript-control", Quote: "A TypeScript function whose R holds a control operation", Slots: effectOnly,
		Decls: "import { retryApproval$$ } from \"./approvals$$.js\"",
		Files: map[string]string{
			"approval$$.vibe": "export control Approval$$ {\n  approve(request: string): boolean!!\n}\n",
			"approvals$$.ts":  "import { Effect } from \"effect\"\nimport type { Approval$$ } from \"./approval$$.js\"\nexport declare function retryApproval$$(request: string): Effect.Effect<boolean, never, Approval$$>\n",
		},
		Text: "const released$$ = retryApproval$$(\"deploy\");"},

	// Chapters 10 and 16: only a plain function fits a synchronous callback.
	{Code: 4301, Name: "map-pauses", Quote: "a function literal at a destination of the plain form whose body can pause", Slots: stmt,
		Decls: "function double$$(n: number) {\n  yieldNow();\n  return n * 2;\n}", Text: "const doubled$$ = [1, 2].map((n) => double$$(n));"},
	{Code: 4301, Name: "map-throws", Quote: "or let a `throw` or a trusted call's listed failure escape", Slots: stmt,
		Decls: "error Negative$$", Text: "const checked$$ = [1, -2].map((n) => {\n  if (n < 0) throw new Negative$$();\n  return n;\n});"},

	// Chapter 10: TypeScript at the edges.
	{Code: 4401, Name: "plain-call", Quote: "a plain TypeScript call in code a fiber runs", Slots: effectOnly,
		Decls: "import { data$$ } from \"./plain$$.js\"",
		Files: map[string]string{"plain$$.ts": "export function data$$() {\n  return 42;\n}\n"},
		Text:  "const value$$ = data$$();"},
	{Code: 4402, Name: "console", Quote: "A Node.js global or a web global that does I/O, run or held as a value", Slots: stmt, DOM: true,
		Text: "console.log(\"hello\");"},
	{Code: 4402, Name: "fetch", Quote: "A Node.js global or a web global that does I/O, run or held as a value", Slots: stmt, DOM: true,
		Text: "const response$$ = fetch(\"https://example.com\");"},
	{Code: 4402, Name: "held-timer", Quote: "run or held as a value", Slots: stmt, DOM: true,
		Text: "const timer$$ = setTimeout;"},
	{Code: 4402, Name: "local-storage", Quote: "A Node.js global or a web global that does I/O, run or held as a value", Slots: stmt, DOM: true,
		Text: "const stored$$ = localStorage.getItem(\"key\");"},
	{Code: 4403, Name: "date-now", Quote: "a clock or randomness read", Slots: stmt,
		Text: "const now$$ = Date.now();"},
	{Code: 4403, Name: "math-random", Quote: "a clock or randomness read", Slots: stmt,
		Text: "const roll$$ = Math.random();"},
	{Code: 4403, Name: "new-date", Quote: "a clock or randomness read", Slots: stmt,
		Text: "const today$$ = new Date();"},
	{Code: 4405, Name: "reads-local", Quote: "A hatch's TypeScript reads a binding the `.vibe` file declares outside the hatch", Slots: stmt,
		Text: "const base$$ = 2;\nconst sum$$ = ⟦sync(() => base$$ + 1)⟧;"},
	{Code: 4405, Name: "reads-module-binding", Quote: "a local, a parameter, or a module declaration", Slots: []string{slotEffect, slotHatch},
		Decls: "const limit$$ = 10;", Text: "const over$$ = ⟦sync(() => limit$$ + 1)⟧;"},
	{Code: 4406, Name: "trust-tag", Quote: "A call whose D23-tagged TypeScript declaration changes the emitted failure contract", Slots: effectOnly,
		Decls: "import { parseTagged$$ } from \"./tagged$$.js\"",
		Files: map[string]string{"tagged$$.ts": "export class TaggedFailure$$ extends Error {\n  readonly _tag = \"TaggedFailure$$\"\n}\n/**\n * @vibelang trusted\n * @throws {TaggedFailure$$} when the text is empty\n */\nexport const parseTagged$$ = (text: string): string => {\n  if (text === \"\") throw new TaggedFailure$$()\n  return text\n}\n"},
		Text:  "const parsed$$ = parseTagged$$(\"x\");"},
	{Code: 4407, Name: "missing-module", Quote: "A module specifier written as an identifier, `from text`, names no module declaration of the file", Slots: top,
		Text: "import { other$$ } from missing$$"},
	{Code: 4408, Name: "nameless", Quote: "or has no name (`module { … }`)", Slots: top,
		Text: "module {\n  export const n = 1;\n}"},
	{Code: 4408, Name: "exported", Quote: "A module declaration that is nested, exported", Slots: top,
		Text: "export module text$$ {\n  export const n = 1;\n}"},
	{Code: 4408, Name: "nested", Quote: "A module declaration that is nested", Slots: top,
		Text: "namespace outer$$ {\n  module inner$$ {\n    export const n = 1;\n  }\n}"},
	{Code: 4408, Name: "collision", Quote: "or a module name shared with a value binding of the file (warning, D303)", Slots: top, Category: CategoryWarning,
		Text: "module text$$ {\n  export const n = 1;\n}\nconst text$$ = 2;"},
	{Code: 4409, Name: "any-call", Quote: "what an Effect function or a program returns is a call of a value of type `any`", Slots: top,
		Decls: "error Failed$$", Text: "export function run$$(): number!! {\n  const h: any = () => {\n    throw new Failed$$();\n  };\n  return h();\n}"},

	// Chapter 13: calls and data methods.
	{Code: 4501, Name: "method-value", Quote: "A method of an Effect data type named without a call", Slots: effectOnly,
		Text: "const numbers$$ = Stream.make(1, 2, 3);\nconst filter$$ = ⟦numbers$$.filter⟧;"},
	{Code: 4502, Name: "pipe-on-success", Quote: ".pipe on a call whose success value has no pipe member", Slots: effectOnly,
		Decls: "error Flaky$$\nfunction flaky$$(s: number): number!Flaky$$! {\n  if (s < 1) throw new Flaky$$();\n  return s;\n}",
		Text:  "const retried$$ = flaky$$(1).pipe(Effect.retry({ times: 3 }));"},
	{Code: 4503, Name: "member-on-key", Quote: "A service implementation member read on its key", Slots: effectOnly,
		Decls: "service Users$$ {\n  region: string\n  find(id: string): string!!\n}", Text: "const region$$ = Users$$.region;"},
	{Code: 4503, Name: "method-on-key", Quote: "A service implementation member read on its key", Slots: effectOnly,
		Decls: "service Users$$ {\n  region: string\n  find(id: string): string!!\n}", Text: "const find$$ = Users$$.find;"},

	// Chapter 7: await (D226).
	{Code: 4601, Name: "await-call", Quote: "`await` before a call that already runs", Slots: stmt,
		Decls: loadDecl, Text: "const value$$ = await load$$();"},
	{Code: 4602, Name: "await-promise", Quote: "`await` on a promise in VibeLang code", Slots: stmt,
		Decls: "declare const promise$$: Promise<number>;", Text: "const value$$ = await promise$$;"},
	{Code: 4603, Name: "await-number", Quote: "`await` on any other value", Slots: stmt,
		Text: "const value$$ = await 42;"},
	{Code: 4603, Name: "await-op-config", Quote: "an await operation's operand that is not a literal, whose element type is not a program", Slots: effectOnly,
		Text: "const configs$$ = [Config.String(\"A\")];\nconst values$$ = await.all configs$$;"},
	{Code: 4604, Name: "await-sync-hatch", Quote: "`await` in a hatch body that is not `async`", Slots: stmt,
		Text: "const waited$$ = sync(() => {\n  await Promise.resolve(1);\n});"},
	{Code: 4604, Name: "await-in-hatch", Quote: "`await` in a hatch body that is not `async`", Slots: []string{slotHatch},
		Text: "await Promise.resolve(1);"},
	{Code: 4605, Name: "break-concurrent", Quote: "`break` that would leave a `for concurrent` loop", Slots: effectOnly,
		Text: "for concurrent (const n$$ of [1, 2]) {\n  if (n$$ === 1) break;\n}"},
	{Code: 4606, Name: "return-concurrent", Quote: "`return` in a `for concurrent` body", Slots: effectOnly,
		Text: "for concurrent (const n$$ of [1, 2]) {\n  if (n$$ === 2) return;\n}"},
	{Code: 4607, Name: "select", Quote: "`select`, which `await.race` replaced", Slots: effectOnly,
		Decls: loadDecl, Text: "select {\n  case const n = load$$(): Console.log(n)\n}"},
	{Code: 4608, Name: "race-object", Quote: "`await.race` or `await.any` on an object", Slots: effectOnly,
		Decls: loadDecl, Text: "const first$$ = await.race { a: load$$(), b: load$$() };"},
	{Code: 4608, Name: "any-object", Quote: "`await.race` or `await.any` on an object", Slots: effectOnly,
		Decls: loadDecl, Text: "const first$$ = await.any { a: load$$(), b: load$$() };"},
	{Code: 4609, Name: "await-fiber", Quote: "`await` on a fiber", Slots: effectOnly,
		Decls: loadDecl, Text: "const fiber$$ = fork load$$();\nconst value$$ = ⟦await fiber$$⟧;"},
	{Code: 4610, Name: "await-deferred", Quote: "`await` on a Deferred", Slots: effectOnly,
		Text: "const deferred$$ = Deferred.make<number>();\nDeferred.succeed(deferred$$, 1);\nconst value$$ = ⟦await deferred$$⟧;"},
	{Code: 4611, Name: "join-deferred", Quote: "`join` on a value that is not a Fiber", Slots: effectOnly,
		Text: "const deferred$$ = Deferred.make<number>();\nconst value$$ = ⟦join deferred$$⟧;"},
	{Code: 4611, Name: "join-number", Quote: "`join` on a value that is not a Fiber", Slots: effectOnly,
		Text: "const count$$ = 42;\nconst value$$ = ⟦join count$$⟧;"},
	{Code: 4612, Name: "join-in-hatch", Quote: "`join` in a hatch body", Slots: stmt,
		Text: "const joined$$ = sync(() => {\n  const x: any = 1;\n  join x;\n});"},

	// Chapters 3 and 11: match and is (D206-D212, D307).
	{Code: 4701, Name: "data-variant-left", Quote: "a case no arm covers, naming a data type's variants as `Delivery.Sent`", Slots: top,
		Decls: "data Delivery$$ {\n  Waiting\n  Sent { tracking: string }\n  Rejected { reason: string }\n}",
		Text:  "export function missing$$(d: Delivery$$) {\n  return match (d) {\n    when Delivery$$.Waiting: \"waiting\";\n    when Delivery$$.Sent: \"sent\";\n  };\n}"},
	{Code: 4701, Name: "literal-left", Quote: "over a finite union of concrete cases (literal types", Slots: top,
		Text: "export function letter$$(x: \"a\" | \"b\" | \"c\") {\n  return match (x) {\n    when \"a\": 1;\n    when \"b\": 2;\n  };\n}"},
	{Code: 4701, Name: "errors-left", Quote: "A `match` without a `default` arm that may leave a value unhandled", Slots: top,
		Decls: "error NotFound$$ { id: string }\nerror Timeout$$",
		Text:  "export function failure$$(e: NotFound$$ | Timeout$$) {\n  return match (e) {\n    when NotFound$$: \"no user\";\n  };\n}"},
	{Code: 4701, Name: "open-string", Quote: "a non-literal `string` or `number`) any such match", Slots: top,
		Text: "export function word$$(s: string) {\n  return match (s) {\n    when \"a\": 1;\n  };\n}"},
	{Code: 4702, Name: "bind-in-or", Quote: "A binding inside an `or` or `not` pattern", Slots: top,
		Text: "export function either$$(x: unknown) {\n  return match (x) {\n    when [let a] or { length: 0 }: 1;\n    default: 0;\n  };\n}"},
	{Code: 4703, Name: "is-outside-condition", Quote: "An `is` whose pattern binds names outside the condition of an `if` or `while`", Slots: stmt,
		Text: "const items$$ = [1, 2];\nconst ok$$ = ⟦items$$ is [let first$$, ...]⟧;"},
	{Code: 4704, Name: "regex", Quote: "regular expression, relational, or a computed key other than a name or literal", Slots: top,
		Text: "export function initial$$(s: string) {\n  return match (s) {\n    when /^a/: \"a\";\n    default: \"other\";\n  };\n}"},
	{Code: 4705, Name: "mixed-combinators", Quote: "`and`, `or`, and `not` combined at one level without parentheses", Slots: top,
		Text: "export function mixed$$(n: number) {\n  return match (n) {\n    when 1 and Number or 3: \"mixed\";\n    default: \"other\";\n  };\n}"},
	{Code: 4706, Name: "braces-on-error", Quote: "A field list in braces after a matcher that is not a data variant", Slots: top,
		Decls: "error NotFound$$ { id: string }",
		Text:  "export function id$$(failure: NotFound$$) {\n  return match (failure) {\n    when NotFound$$ { let id }: id;\n  };\n}"},
	{Code: 4706, Name: "arguments-on-variant", Quote: "or an argument list after one that is", Slots: top,
		Decls: "data Delivery$$ {\n  Waiting\n  Sent { tracking: string }\n}",
		Text:  "export function tracking$$(d: Delivery$$) {\n  return match (d) {\n    when Delivery$$.Sent(let sent): sent;\n    default: \"\";\n  };\n}"},
	{Code: 4707, Name: "foreign-variant", Quote: "A data variant's pattern whose subject's declared type, a finite union, has no case with that variant's tag", Slots: top,
		Decls: "data Delivery$$ {\n  Waiting\n  Sent { tracking: string }\n}\ndata Phase$$ {\n  Draft\n  Done\n}",
		Text:  "export function wrong$$(d: Delivery$$) {\n  return match (d) {\n    when Phase$$.Draft: \"draft\";\n    default: \"\";\n  };\n}"},

	// Chapter 28: Effect's language-service rules (D240, D241) and the
	// TypeScript-style forms (D284-D290).
	{Code: 4801, Name: "floating-program", Quote: "names a program without calling it", Slots: effectOnly,
		Decls: "function work$$() {\n  Console.log(\"work\");\n}", Text: "work$$;"},
	{Code: 4801, Name: "floating-effect", Quote: "A statement that discards an Effect value", Slots: effectOnly,
		Decls: "declare const program$$: Effect<number>;", Text: "program$$;"},
	{Code: 4802, Name: "returned-program", Quote: "an Effect value, a program, or a value whose union type holds one, returned where the success type names no value", Slots: top,
		Text: "export function nested$$(migration: Effect<void>) {\n  yieldNow();\n  return migration;\n}"},
	{Code: 4803, Name: "two-versions", Quote: "the program loads two versions of `effect`, an `@effect/*` package", Slots: top,
		Decls: "import { one$$ } from \"./vendor$$/one/index.js\"\nimport { two$$ } from \"./vendor$$/two/index.js\"",
		Files: map[string]string{
			"vendor$$/one/package.json": `{"name":"@effect/fake","version":"1.0.0","type":"module","types":"./index.d.ts"}`,
			"vendor$$/one/index.d.ts":   "export declare const one$$: number\n",
			"vendor$$/two/package.json": `{"name":"@effect/fake","version":"2.0.0","type":"module","types":"./index.d.ts"}`,
			"vendor$$/two/index.d.ts":   "export declare const two$$: number\n",
		},
		// The row names no site for a fact about the whole program; the
		// diagnostic stands in the file that loads both.
		Site: "file",
		Text: "export const both$$ = one$$ + two$$;"},
	{Code: 4804, Name: "global-error", Quote: "a failure that is a global `Error`, thrown", Slots: effectOnly,
		Text: "const n$$ = 1;\nif (n$$ < 0) throw new Error(\"negative\");"},
	{Code: 4805, Name: "extends-error", Quote: "a class that extends `Error`", Slots: top,
		Text: "export class Legacy$$ extends Error {}"},
	{Code: 4806, Name: "unknown-mapping", Quote: "a `try` mapping that returns `unknown` or `any`", Slots: effectOnly,
		Text: "const decoded$$ = try Effect.try({ try: () => Number(\"1\"), catch: (cause) => cause });"},
	{Code: 4807, Name: "merge-dependent", Quote: "`Layer.mergeAll` of a layer that needs a service another argument provides", Slots: top,
		Decls: "service Directory$$ {\n  lookup(id: string): string!!\n}\nservice People$$ {\n  find(id: string): string!!\n}\nconst DirectoryLive$$ = Layer.succeed(Directory$$, { lookup(id) { return id; } });\nconst PeopleLive$$ = Layer.effect(People$$) {\n  const directory = Directory$$();\n  return { find(id) { return directory.lookup(id); } };\n}",
		Text:  "export const App$$ = Layer.mergeAll(DirectoryLive$$, PeopleLive$$);"},
	{Code: 4808, Name: "nested-provide", Quote: "a `provide` block that holds only another `provide` block", Slots: effectOnly,
		Decls: "service Left$$ {\n  left: number\n}\nservice Right$$ {\n  right: number\n}\nconst LeftLive$$ = Layer.succeed(Left$$, { left: 1 });\nconst RightLive$$ = Layer.succeed(Right$$, { right: 2 });",
		Text:  "provide LeftLive$$ {\n  provide RightLive$$ {\n    Console.log(Left$$().left + Right$$().right);\n  }\n}"},
	{Code: 4809, Name: "leaky-service", Quote: "a service whose every Effect member needs the same service", Slots: top,
		Decls: "service Directory$$ {\n  lookup(id: string): string!!\n}",
		Text:  "service Reports$$ {\n  daily(): string!!Directory$$\n  weekly(): string!!Directory$$\n}"},
	{Code: 4810, Name: "drop-failure", Quote: "an assertion from one Effect type to another that drops failures or services", Slots: top,
		Decls: "error NotFound$$ { id: string }",
		Text:  "export function dropped$$(program: Effect<number, NotFound$$>) {\n  return program as Effect<number>;\n}"},
	{Code: 4811, Name: "throw-unknown", Quote: "a throw of `any` or `unknown`", Slots: top,
		Text: "export function rethrow$$(cause: unknown) {\n  throw cause;\n}"},
	{Code: 4812, Name: "new-promise", Quote: "`new Promise` in VibeLang code", Slots: stmt,
		Text: "const pending$$ = new Promise<number>((resolve) => resolve(1));"},
	{Code: 4813, Name: "catch-all", Quote: "An Effect 3 name of the Effect module, such as `Effect.catchAll`", Slots: top,
		Text: "export const recover$$ = Effect.catchAll;"},
	{Code: 4814, Name: "schema-constructor", Quote: "a constructor in a class that extends a Schema class", Slots: top,
		Text: "export class Person$$ extends Schema.Class<Person$$>(\"Person$$\")({ name: Schema.String }) {\n  constructor(props: { readonly name: string }) {\n    super(props);\n  }\n}"},
	{Code: 4815, Name: "throw-effect", Quote: "a throw of an Effect value", Slots: top,
		Decls: "error NotFound$$ { id: string }",
		Text:  "export function thrown$$(program: Effect<number, NotFound$$>) {\n  throw program;\n}"},
	{Code: 4816, Name: "provide-outside-main", Quote: "a layer provided outside a function named `main`", Slots: effectOnly,
		Decls: "service Left$$ {\n  left: number\n}\nconst LeftLive$$ = Layer.succeed(Left$$, { left: 1 });",
		Text:  "provide LeftLive$$ {\n  Console.log(Left$$().left);\n}"},
	{Code: 4817, Name: "instanceof-schema", Quote: "`instanceof` a Schema class", Slots: stmt,
		Decls: "class Person$$ extends Schema.Class<Person$$>(\"Person$$\")({ name: Schema.String }) {}",
		Text:  "const isPerson$$ = ({} as unknown) instanceof Person$$;"},
	{Code: 4818, Name: "json-parse", Quote: "`JSON.parse` or `JSON.stringify` in VibeLang code", Slots: stmt,
		Text: "const parsed$$ = JSON.parse(\"1\") as number;"},
	{Code: 4818, Name: "json-stringify", Quote: "`JSON.parse` or `JSON.stringify` in VibeLang code", Slots: stmt,
		Text: "const text$$ = JSON.stringify({ a: 1 });"},
	{Code: 4821, Name: "tagged-struct", Quote: "`Schema.Struct` with a `_tag: Schema.Literal(…)` field", Slots: top,
		Text: "export const Opened$$ = Schema.Struct({ _tag: Schema.Literal(\"Opened\"), at: Schema.Number });"},
	{Code: 4822, Name: "number-condition", Quote: "a condition whose type is not boolean", Slots: stmt,
		Text: "const count$$ = [1].length;\nconst sign$$ = ⟦count$$⟧ ? 1 : 0;"},
	{Code: 4823, Name: "block-return", Quote: "an arrow function whose block only returns a value", Slots: top,
		Text: "export const increment$$ = (n: number) => { return n + 1; };"},
	{Code: 4824, Name: "empty-pipe", Quote: "a `pipe` with no functions", Slots: top,
		Text: "export const same$$ = pipe(1);"},
	{Code: 4825, Name: "pipe-of-pipe", Quote: "a pipe of a pipe, `x.pipe(f).pipe(g)`", Slots: top,
		Text: "export const twice$$ = Option.some(1).pipe(Option.map((n: number) => n + 1)).pipe(Option.getOrElse(() => 0));"},
	{Code: 4830, Name: "tagged-error-class", Quote: "a class that extends `Data.TaggedError`, `TaggedError`, `Data.Error`, or `Schema.TaggedError` with an empty body", Slots: top,
		Text: "class Missing$$ extends Data.TaggedError(\"Missing$$\")<{ readonly id: string }> {}"},
	{Code: 4831, Name: "context-service", Quote: "a `Context.Service<Self, Shape>()(key)` class whose shape is an object type", Slots: top,
		Text: "class Named$$ extends Context.Service<Named$$, {\n  read(): string!!\n}>()(\"app/Named$$\") {}"},
	{Code: 4832, Name: "struct-constant", Quote: "a `const` that holds a `Schema.Struct` a `schema` declaration writes", Slots: top,
		Text: "const User$$ = Schema.Struct({ id: Schema.String });"},
	{Code: 4832, Name: "exported-struct-constant", Quote: "a `const` that holds a `Schema.Struct` a `schema` declaration writes", Slots: top,
		Text: "export const User$$ = Schema.Struct({ id: Schema.String });"},
	{Code: 4833, Name: "effect-dot-effect", Quote: "`Effect.Effect<A, E, R>`, which the `!` form writes in fewer tokens", Slots: top,
		Text: "type Program$$ = Effect.Effect<number, never, never>;"},
	{Code: 4834, Name: "running-succeed", Quote: "`Effect.succeed(x)` or `Effect.fail(e)` where the call runs", Slots: effectOnly,
		Text: "const name$$ = Effect.succeed(\"Grace\");"},
	{Code: 4835, Name: "catch-tag", Quote: "`Effect.catchTag`, `Effect.catchTags`, or `Effect.catch` in a VibeLang function", Slots: effectOnly,
		Decls: "error Missing$$ { id: number }\nfunction find$$(id: number): string!Missing$$! {\n  if (id === 0) throw new Missing$$({ id });\n  return \"Ada\";\n}",
		Text:  "const described$$ = Effect.catchTag(find$$(1), \"Missing$$\", (e) => `missing ${e.id}`);"},
	{Code: 4836, Name: "with-span", Quote: "`Effect.withSpan`, `Effect.provide`, or `Effect.provideService` in a VibeLang function", Slots: effectOnly,
		Decls: loadDecl, Text: "const traced$$ = Effect.withSpan(load$$(), \"load\");"},
	{Code: 4837, Name: "schema-tagged-error", Quote: "a class that extends `Schema.TaggedError` with an empty body", Slots: top,
		Text: "class SchemaFail$$ extends Schema.TaggedError<SchemaFail$$>()(\"SchemaFail$$\", { id: Schema.String }) {}"},
	{Code: 4838, Name: "returned-fiber", Quote: "an owned fiber that goes", Slots: top,
		Decls: loadDecl, Text: "export function leak$$() {\n  const fiber = fork load$$();\n  return fiber;\n}"},
	{Code: 4838, Name: "stored-fiber", Quote: "stored in a collection", Slots: effectOnly,
		Decls: loadDecl, Text: "const fiber$$ = fork load$$();\nconst fibers$$: Array<unknown> = [];\n⟦fibers$$.push(fiber$$)⟧;"},
	{Code: 4839, Name: "match-chain", Quote: "a choice written with Effect's `Match` functions", Slots: top,
		Decls: "type Status$$ = \"idle\" | \"busy\"",
		Text:  "export function label$$(status: Status$$): string {\n  return ⟦Match.value(status).pipe(\n    Match.when(\"idle\", () => \"Idle\"),\n    Match.orElse((other) => \"Other \" + other),\n  )⟧;\n}"},
	{Code: 4840, Name: "option-pipeline", Quote: "whose every stage is a function of the `Option` module", Slots: top,
		Text: "export const name$$ = (nick: Option.Option<string>) => ⟦pipe(nick, Option.map((s) => s.trim()), Option.getOrElse(() => \"anon\"))⟧;"},
	{Code: 4841, Name: "schema-alias", Quote: "a schema constant other than a `Schema.Struct` whose type alias", Slots: top,
		Text: "export const Id$$ = Schema.String;\nexport type Id$$ = typeof Id$$.Type;"},
	{Code: 4842, Name: "global-import", Quote: "an import that binds one of Effect's modules under the name of a JavaScript global", Slots: top,
		Text: "import { ⟦Array⟧ } from \"effect\";\nexport const firstTwo$$ = (values: ReadonlyArray<number>) => Array.take(values, 2);"},

	// More clauses of the rows above, each a form of its own.
	{Code: 1003, Name: "await-using", Quote: "`async`, `for await`, or `await using`", Slots: effectOnly,
		Decls: "declare function open$$(path: string): AsyncDisposable;", Text: "await using handle$$ = open$$(\"/tmp/a\");"},
	{Code: 1005, Name: "effect-run-promise", Quote: "A runner inside code that a fiber runs", Slots: effectOnly,
		Decls: loadDecl, Text: "Effect.runPromise(() => load$$());"},
	{Code: 1013, Name: "service-comma", Quote: "A comma after a field of an `error`, `schema error`, `service`, or `control` declaration", Slots: top,
		Text: "service Stock$$ {\n  region: string,\n  count(sku: string): number!!\n}"},
	{Code: 1013, Name: "schema-error-comma", Quote: "A comma after a field of an `error`, `schema error`, `service`, or `control` declaration", Slots: top,
		Text: "schema error Rejected$$ { sku: string, reason: string }"},
	{Code: 2003, Name: "accessor-throw", Quote: "or a throw or listed failure that can escape a constructor, an accessor or a class static block", Slots: top,
		Decls: "error Bad$$", Text: "export class Guarded$$ {\n  get value(): number {\n    throw new Bad$$();\n  }\n}"},
	{Code: 2006, Name: "break-finally", Quote: "A `return`, `break`, or `continue` that leaves a `finally` block", Slots: stmt,
		Text: "while (1 + 1 === 2) {\n  try {\n    const seen$$ = 1;\n  } finally {\n    break;\n  }\n}"},
	{Code: 2103, Name: "control-body", Quote: "A member of a `service` or `control` declaration with a body or an initializer", Slots: top,
		Text: "control Ask$$ {\n  ask(question: string): string!! {\n    return question;\n  }\n}"},
	{Code: 2117, Name: "error-extends-schema-error", Quote: "or an `error` that extends a `schema error`", Slots: top,
		Text: "schema error Base$$ { code: string }\nerror Child$$ extends Base$$ { extra: number }"},
	{Code: 2124, Name: "name-definition", Quote: "or another declaration in scope of a generic data type's `NameDefinition`", Slots: top,
		Text: "data Box$$<A> {\n  Full { a: A }\n}\ninterface Box$$Definition { other: string }"},
	{Code: 2125, Name: "untyped-field", Quote: "a field without a type", Slots: top,
		Text: "data Members$$ {\n  Untyped { untyped }\n}"},
	{Code: 2127, Name: "unknown-variant-pattern", Quote: "in a call, a pattern, or anywhere else", Slots: top,
		Decls: "data Delivery$$ {\n  Waiting\n  Sent { tracking: string }\n}",
		Text:  "export function typo$$(d: Delivery$$) {\n  return match (d) {\n    when Delivery$$.Snet: 2;\n    default: 3;\n  };\n}"},
	{Code: 2140, Name: "throw-cause-union", Quote: "or a union with one", Slots: top,
		Decls: "error Missing$$", Text: "function either$$(cause: Cause<string> | Missing$$) {\n  throw cause;\n}"},
	{Code: 2140, Name: "throw-expression-cause", Quote: "A `throw` whose operand's type is a Cause type", Slots: top,
		Text: "function inExpression$$(cause: Cause<never>, value: number | undefined) {\n  return value ?? throw cause;\n}"},
	{Code: 3201, Name: "run-promise-missing", Quote: "No provider for a required service", Slots: top,
		Decls: "service Mailer$$ {\n  send(to: string): void!!\n}\nfunction welcome$$() {\n  Mailer$$.send(\"ada\");\n}",
		Text:  "export const sent$$ = Effect.runPromise(() => welcome$$());"},
	{Code: 4301, Name: "contracted-callback", Quote: "an Effect-annotated literal there", Slots: stmt,
		Text: "const doubled$$ = [1, 2].map((n): number!! => n * 2);"},
	{Code: 4402, Name: "global-this-fetch", Quote: "A Node.js global or a web global that does I/O, run or held as a value", Slots: stmt, DOM: true,
		Text: "const response$$ = globalThis.fetch(\"https://example.com\");"},
	{Code: 4403, Name: "random-uuid", Quote: "a clock or randomness read", Slots: stmt, DOM: true,
		Text: "const id$$ = crypto.randomUUID();"},
	{Code: 4408, Name: "duplicate", Quote: "declared twice", Slots: top,
		Text: "module text$$ {\n  export const a = 1;\n}\nmodule text$$ {\n  export const b = 2;\n}"},
	{Code: 4408, Name: "export-equals", Quote: "a module body that uses `export =` or `import = require()`", Slots: top,
		Text: "module text$$ {\n  const n = 1;\n  export = n;\n}"},
	{Code: 4501, Name: "option-method-value", Quote: "A method of an Effect data type named without a call", Slots: effectOnly,
		Text: "const maybe$$ = Option.some(1);\nconst map$$ = ⟦maybe$$.map⟧;"},
	{Code: 4503, Name: "length-on-key", Quote: "a member named like a property of the key's class, such as `name` or `length`, included", Slots: effectOnly,
		Decls: "service Sized$$ {\n  length: number\n}", Text: "const length$$ = Sized$$.length;"},
	// Detached fibers: an owned fiber in an array that is not join's operand
	// is also EK4838 (Chapter 7, D409), which D464 waives only for a plain
	// await f.
	{Code: 4609, Name: "await-fibers-array", Quote: "or an array or object of fibers", Slots: effectOnly,
		Decls: loadDecl, Text: "const first$$ = detach(() => load$$());\nconst second$$ = detach(() => load$$());\nconst both$$ = ⟦await [first$$, second$$]⟧;"},
	{Code: 4609, Name: "await-op-fiber", Quote: "also an await operation's element of `Fiber` type", Slots: effectOnly,
		Decls: loadDecl, Text: "const fiber$$ = fork load$$();\nconst all$$ = await.all [⟦fiber$$⟧, load$$()];"},
	{Code: 4610, Name: "await-op-deferred", Quote: "also an await operation's element of `Deferred` type", Slots: effectOnly,
		Decls: loadDecl, Text: "const deferred$$ = Deferred.make<number>();\nconst all$$ = await.all [⟦deferred$$⟧, load$$()];"},
	{Code: 4612, Name: "join-in-async-hatch", Quote: "`join` in a hatch body", Slots: []string{slotAsyncHatch},
		Text: "const x$$: any = 1;\njoin x$$;"},
	{Code: 4701, Name: "option-left", Quote: "`Option`, `Exit`, `Result`", Slots: top,
		Text: "export function unwrap$$(o: Option<number>) {\n  return match (o) {\n    when Option.Some(let v): v;\n  };\n}"},
	{Code: 4701, Name: "boolean-left", Quote: "over a finite union of concrete cases (literal types", Slots: top,
		Text: "export function yes$$(b: boolean) {\n  return match (b) {\n    when true: \"yes\";\n  };\n}"},
	{Code: 4703, Name: "is-in-return", Quote: "An `is` whose pattern binds names outside the condition of an `if` or `while`", Slots: top,
		Text: "export function first$$(xs: ReadonlyArray<number>) {\n  return xs is [let head$$, ...];\n}"},
	{Code: 4704, Name: "relational", Quote: "regular expression, relational, or a computed key other than a name or literal", Slots: top,
		Text: "export function small$$(n: number) {\n  return match (n) {\n    when < 10: \"small\";\n    default: \"large\";\n  };\n}"},
	{Code: 4704, Name: "iterable-array-pattern", Quote: "or an array pattern whose subject's type admits an iterable that is not an array", Slots: top,
		Text: "export function head$$(xs: Iterable<number>) {\n  return match (xs) {\n    when [let a, ...]: a;\n    default: 0;\n  };\n}"},
	{Code: 4705, Name: "not-and", Quote: "`and`, `or`, and `not` combined at one level without parentheses", Slots: top,
		Text: "export function odd$$(n: number) {\n  return match (n) {\n    when not 1 and 2: \"odd\";\n    default: \"other\";\n  };\n}"},
	{Code: 4801, Name: "floating-interrupt", Quote: "or names a program without calling it, as `interrupt` alone", Slots: effectOnly,
		Text: "interrupt;"},
	{Code: 4802, Name: "returned-arm", Quote: "also an arm of a returned conditional", Slots: top,
		Text: "export function either$$(flag: boolean, program: Effect<void>) {\n  yieldNow();\n  return flag ? program : undefined;\n}"},
	{Code: 4804, Name: "mapping-error", Quote: "a failure that is a global `Error`, thrown or returned by a `try` mapping", Slots: effectOnly,
		Text: "const parsed$$ = try Effect.try({ try: () => Number(\"1\"), catch: (cause) => new Error(String(cause)) });"},
	{Code: 4834, Name: "running-fail", Quote: "`Effect.succeed(x)` or `Effect.fail(e)` where the call runs", Slots: effectOnly,
		Decls: "error Missing$$ { id: number }", Text: "if (1 + 1 === 3) Effect.fail(new Missing$$({ id: 1 }));"},
	{Code: 4835, Name: "effect-catch", Quote: "`Effect.catchTag`, `Effect.catchTags`, or `Effect.catch` in a VibeLang function", Slots: effectOnly,
		Decls: "error Missing$$ { id: number }\nfunction find$$(id: number): string!Missing$$! {\n  if (id === 0) throw new Missing$$({ id });\n  return \"Ada\";\n}",
		Text:  "const any$$ = Effect.catch(find$$(1), (e) => `failed ${e._tag}`);"},
	{Code: 4836, Name: "effect-provide", Quote: "`Effect.withSpan`, `Effect.provide`, or `Effect.provideService` in a VibeLang function", Slots: effectOnly,
		Decls: "service Region$$ {\n  name(): string!!\n}\nconst RegionLive$$ = Layer.succeed(Region$$, { name() { return \"eu\"; } });",
		Text:  "const provided$$ = Effect.provide(Region$$.name(), RegionLive$$);"},

	// The codes Chapter 28 lists after its table, rules as the table's are.
	{Code: 1018, Name: "call-to-effect-destination", Quote: "a call that runs where its destination's declared type, or an element or field type of it, is an Effect", Slots: effectOnly,
		Decls: loadDecl, Text: "const program$$: Effect<number> = load$$();"},
	{Code: 1019, Name: "continue-from-do", Quote: "a `break` or `continue` that would leave a `do` expression", Slots: effectOnly,
		Text: "for (const i$$ of [1, 2]) {\n  const v$$ = do {\n    if (i$$ > 1) continue;\n    i$$\n  };\n}"},
	{Code: 1020, Name: "new-function", Quote: "`new` on a function declared in a `.vibe` file", Slots: stmt,
		Decls: "function make$$() {\n  return 1;\n}", Text: "const made$$ = new make$$();"},
	{Code: 1022, Name: "next-line-block", Quote: "a block statement whose `{` begins the line after a statement that ends, with no `;`, in an identifier", Slots: stmt,
		Text: "const first$$ = 1;\nconst second$$ = first$$\n{\n  const inner$$ = 2;\n}"},
	{Code: 2129, Name: "infer-twice", Quote: "an `infer` name other than `_` written in two channels of one contract", Slots: top,
		Decls: "error Bad$$", Text: "export function twice$$(n: number): number!infer X!infer X {\n  if (n < 0) throw new Bad$$();\n  return n;\n}"},
	{Code: 3007, Name: "key-with-arguments", Quote: "a service key called with arguments", Slots: effectOnly,
		Decls: "service Fn$$: (n: number) => number", Text: "const three$$ = Fn$$(3);"},
	{Code: 3208, Name: "wire-value", Quote: "the `wire` intrinsic used other than as the callee of a call", Slots: stmt,
		Text: "const w$$ = wire;"},
	{Code: 4410, Name: "hatch-value", Quote: "a hatch, or the prelude's `fork` or `join`, used other than as the callee of a call under its own name", Slots: stmt,
		Text: "const run$$ = sync;"},
	{Code: 4411, Name: "hatch-function-expression", Quote: "a hatch whose first argument is a single expression whose type is not a function, followed by inputs", Slots: stmt,
		Text: "const roll$$ = sync(Math.PI, 1);"},
	{Code: 4613, Name: "unrun-element", Quote: "an element of an await operation's literal operand, or the operand of `fork`, whose type is a program", Slots: effectOnly,
		Decls: loadDecl, Text: "const job$$ = () => load$$();\nconst both$$ = await.all [⟦job$$⟧, load$$()];"},
}

// A ruleAllowed is a form the specification allows where a near violation
// is an error: the dual of an injection, which must add no diagnostic.
// Quote is words of Chapter that say it is allowed.
type ruleAllowed struct {
	Name    string
	Chapter string
	Quote   string
	Slots   []string
	Decls   string
	Text    string
	Files   map[string]string
	DOM     bool
}

var allowedForms = []*ruleAllowed{
	// Chapter 10: a hatch's first argument is plain TypeScript (D396). A hatch
	// is an Effect that runs, so a statement holding one goes only where a
	// function runs Effects: in a plain function it is EK2003, "A plain
	// annotation on a function or method whose body runs an Effect".
	{Name: "hatch-clock", Chapter: "110-part1-ch10-typescript.md", Quote: "platform APIs and clock reads are allowed (no EK4401, EK4402, or EK4403)",
		Slots: effectOnly, Text: "const now$$ = sync(() => Date.now());"},
	{Name: "hatch-random-expression", Chapter: "110-part1-ch10-typescript.md", Quote: "or a single expression evaluated when the hatch runs, `sync(crypto.randomUUID())`",
		Slots: effectOnly, DOM: true, Text: "const id$$ = sync(crypto.randomUUID());"},
	{Name: "hatch-console", Chapter: "110-part1-ch10-typescript.md", Quote: "platform APIs and clock reads are allowed (no EK4401, EK4402, or EK4403)",
		Slots: effectOnly, DOM: true, Text: "sync(() => console.log(\"hello\"));"},
	{Name: "hatch-throw", Chapter: "110-part1-ch10-typescript.md", Quote: "`throw`, `async`, and `await` keep their JavaScript meaning",
		Slots: effectOnly, Text: "const checked$$ = sync((n: number) => {\n  if (n < 0) throw new Error(\"negative\");\n  return n;\n}, 1);"},
	{Name: "hatch-async-await", Chapter: "110-part1-ch10-typescript.md", Quote: "`throw`, `async`, and `await` keep their JavaScript meaning",
		Slots: effectOnly, Text: "const waited$$ = sync(async () => {\n  const n = await Promise.resolve(1);\n  return n + 1;\n});"},
	{Name: "hatch-input", Chapter: "110-part1-ch10-typescript.md", Quote: "A value reaches it as an input (D230), an argument after the function that fills the function's first parameters",
		Slots: effectOnly, Text: "const base$$ = 2;\nconst sum$$ = sync((n) => n + 1, base$$);"},
	{Name: "hatch-statements-clock", Chapter: "110-part1-ch10-typescript.md", Quote: "platform APIs and clock reads are allowed (no EK4401, EK4402, or EK4403)",
		Slots: []string{slotHatch, slotAsyncHatch}, Text: "const now$$ = Date.now() + Math.random();"},
	{Name: "hatch-statements-platform", Chapter: "110-part1-ch10-typescript.md", Quote: "platform APIs and clock reads are allowed (no EK4401, EK4402, or EK4403)",
		Slots: []string{slotHatch, slotAsyncHatch}, DOM: true, Text: "console.log(\"inside\");\nconst stored$$ = localStorage.getItem(\"key\");"},
	{Name: "hatch-statements-throw", Chapter: "110-part1-ch10-typescript.md", Quote: "`throw`, `async`, and `await` keep their JavaScript meaning",
		Slots: []string{slotHatch, slotAsyncHatch}, Text: "if (1 + 1 === 3) throw new Error(\"impossible\");"},
	{Name: "hatch-statements-await", Chapter: "110-part1-ch10-typescript.md", Quote: "`throw`, `async`, and `await` keep their JavaScript meaning",
		Slots: []string{slotAsyncHatch}, Text: "const waited$$ = await Promise.resolve(1);\nconst later$$ = async () => await Promise.resolve(waited$$);"},
	{Name: "hatch-statements-promise", Chapter: "428-part4-ch28-tooling.md", Quote: "or an `async` hatch function that waits for it",
		Slots: []string{slotAsyncHatch}, Text: "const settled$$ = await new Promise<number>((resolve) => resolve(1));"},
	// Chapter 10 and SKILL rule 1: a module body is TypeScript (D283).
	{Name: "module-javascript", Chapter: "110-part1-ch10-typescript.md", Quote: "JavaScript's `throw`, `catch`, `async`, `await`, and platform APIs keep their TypeScript meaning there",
		Slots: []string{slotModule}, DOM: true, Text: "const later$$ = async () => await Promise.resolve(Date.now());\nif (s === \"\\u0000\") throw new Error(\"nul\");\nconsole.log(Math.random());"},
	{Name: "module-declaration", Chapter: "110-part1-ch10-typescript.md", Quote: "JavaScript's `throw`, `catch`, `async`, `await`, and platform APIs keep their TypeScript meaning there",
		Slots: top, DOM: true, Text: "module clock$$ {\n  export async function stamp(): Promise<number> {\n    await Promise.resolve();\n    if (Math.random() > 2) throw new Error(\"impossible\");\n    return Date.now();\n  }\n}\nimport { stamp } from clock$$\nexport function stamped$$() {\n  return sync(async () => await stamp());\n}"},
	// Chapter 11: ECMAScript's built-ins and the web's pure helpers.
	{Name: "pure-helpers", Chapter: "111-part1-ch11-stdlib.md", Quote: "ECMAScript's built-ins and the web's pure helpers, such as `URL`, `TextEncoder`, and `structuredClone`, are not platform code",
		Slots: stmt, DOM: true, Text: "const host$$ = new URL(\"https://example.com/a\").host;\nconst bytes$$ = new TextEncoder().encode(host$$);\nconst copy$$ = structuredClone({ n: bytes$$.length });"},
	// Chapter 7: the forms that replace await (D225, D226).
	{Name: "join-fiber", Chapter: "428-part4-ch28-tooling.md", Quote: "Write `join` for `await` (quick fix)",
		Slots: effectOnly, Decls: loadDecl, Text: "const fiber$$ = fork load$$();\nconst value$$ = join fiber$$;"},
	{Name: "deferred-await", Chapter: "428-part4-ch28-tooling.md", Quote: "Write `d.await()` (quick fix)",
		Slots: effectOnly, Text: "const deferred$$ = Deferred.make<number>();\nDeferred.succeed(deferred$$, 1);\nconst value$$ = deferred$$.await();"},
	{Name: "race-array", Chapter: "428-part4-ch28-tooling.md", Quote: "Write the elements in an array: `await.race [a(), b()]`",
		Slots: effectOnly, Decls: loadDecl, Text: "const first$$ = await.race [load$$(), load$$()];"},
	{Name: "await-all-record", Chapter: "107-part1-ch07-concurrency.md", Quote: "await.all",
		Slots: effectOnly, Decls: loadDecl, Text: "const both$$ = await.all { a: load$$(), b: load$$() };"},
	{Name: "concurrent-continue", Chapter: "428-part4-ch28-tooling.md", Quote: "Use `continue` to end one item",
		Slots: effectOnly, Text: "for concurrent (const n$$ of [1, 2]) {\n  if (n$$ === 1) continue;\n  Console.log(n$$);\n}"},
	{Name: "restore-inside", Chapter: "428-part4-ch28-tooling.md", Quote: "Put it inside `uninterruptible { … }`",
		Slots: effectOnly, Text: "uninterruptible {\n  restore {\n    sleep(\"1 millis\");\n  }\n}"},
	// Chapter 3: match and is.
	{Name: "is-in-if", Chapter: "428-part4-ch28-tooling.md", Quote: "Move the test into an `if` or `while` condition",
		Slots: stmt, Text: "const items$$ = [1, 2];\nif (items$$ is [let first$$, ...]) {\n  const got$$ = first$$;\n}"},
	{Name: "match-default", Chapter: "428-part4-ch28-tooling.md", Quote: "or a `default` arm",
		Slots: top, Decls: "data Delivery$$ {\n  Waiting\n  Sent { tracking: string }\n  Rejected { reason: string }\n}",
		Text: "export function described$$(d: Delivery$$) {\n  return match (d) {\n    when Delivery$$.Waiting: \"waiting\";\n    default: \"other\";\n  };\n}"},
	{Name: "match-every-variant", Chapter: "428-part4-ch28-tooling.md", Quote: "Add an arm for each case left",
		Slots: top, Decls: "data Delivery$$ {\n  Waiting\n  Sent { tracking: string }\n  Rejected { reason: string }\n}",
		Text: "export function described$$(d: Delivery$$) {\n  return match (d) {\n    when Delivery$$.Waiting: \"waiting\";\n    when Delivery$$.Sent { let tracking }: tracking;\n    when Delivery$$.Rejected { let reason }: reason;\n  };\n}"},
	{Name: "match-guard", Chapter: "428-part4-ch28-tooling.md", Quote: "Use a guard: `if (/re/.test(x))` or `if (x < 5)`",
		Slots: top, Text: "export function small$$(n: number) {\n  return match (n) {\n    when let m and if (m < 10): \"small\";\n    default: \"large\";\n  };\n}"},
	{Name: "match-parenthesized", Chapter: "428-part4-ch28-tooling.md", Quote: "Add parentheses: `(a and b) or c`",
		Slots: top, Text: "export function mixed$$(n: number) {\n  return match (n) {\n    when (1 and Number) or 3: \"mixed\";\n    default: \"other\";\n  };\n}"},
	{Name: "match-error-fields", Chapter: "428-part4-ch28-tooling.md", Quote: "`when NotFound and { let id }`",
		Slots: top, Decls: "error NotFound$$ { id: string }",
		Text: "export function id$$(failure: NotFound$$) {\n  return match (failure) {\n    when NotFound$$ and { let id }: id;\n  };\n}"},
	{Name: "catch-then-match", Chapter: "428-part4-ch28-tooling.md", Quote: "`catch (e)` and test `e` with `match` or `is`",
		Slots: effectOnly, Decls: "error NotFound$$\nerror Timeout$$\nfunction load$$(n: number): string!NotFound$$ | Timeout$$! {\n  if (n === 0) throw new NotFound$$();\n  if (n < 0) throw new Timeout$$();\n  return \"ok\";\n}",
		Text: "const handled$$ = load$$(1) catch (e) => match (e) {\n  when NotFound$$: \"missing\";\n  when Timeout$$: \"slow\";\n};"},
	{Name: "throw-parenthesized", Chapter: "428-part4-ch28-tooling.md", Quote: "Write `throw (…)` to throw the whole expression",
		Slots: effectOnly, Decls: "error Fail$$ { code: string }\nfunction fail$$(): string!Fail$$! {\n  throw new Fail$$({ code: \"unknown\" });\n}",
		Text: "const coded$$ = fail$$() catch (f) => throw (f.code === \"unknown\" ? \"a\" : \"b\");"},
	// Chapters 13 and 14: what a plain or Effect contract allows.
	{Name: "contract-throw", Chapter: "428-part4-ch28-tooling.md", Quote: "such as `T!!`, `T!!Users`, or `T!Invalid!`",
		Slots: top, Decls: "error Bad$$", Text: "export function check$$(n: number): number!Bad$$! {\n  if (n < 0) throw new Bad$$();\n  return n;\n}"},
	{Name: "plain-calls-plain", Chapter: "428-part4-ch28-tooling.md", Quote: "other than by calling a plain function whose return type is not definitely an Effect (D67, D74, D445, D480)",
		Slots: top, Text: "function increment$$(n: number): number {\n  return n + 1;\n}\nexport function twice$$(n: number): number {\n  return increment$$(increment$$(n));\n}"},
	{Name: "top-plain-call", Chapter: "428-part4-ch28-tooling.md", Quote: "A call of a plain function whose return type is not definitely an Effect runs no program in any of them (D445)",
		Slots: top, Text: "function increment$$(n: number): number {\n  return n + 1;\n}\nexport const two$$ = increment$$(1);"},
	// Chapter 4: providing.
	{Name: "provide-statement", Chapter: "428-part4-ch28-tooling.md", Quote: "Write `provide layer { statements }` and return from inside its block",
		Slots: effectOnly, Decls: "service Left$$ {\n  left: number\n}\nconst LeftLive$$ = Layer.succeed(Left$$, { left: 1 });",
		Text: "provide LeftLive$$ {\n  Console.log(Left$$().left);\n}"},
	{Name: "implementation-member", Chapter: "428-part4-ch28-tooling.md", Quote: "Read S().member",
		Slots: top, Decls: "service Users$$ {\n  region: string\n  find(id: string): string!!\n}",
		Text: "export function region$$() {\n  return Users$$().region + Users$$.find(\"1\");\n}"},
	// Chapter 2: the prelude's Effect type draws nothing (D308, D309).
	{Name: "prelude-effect-type", Chapter: "428-part4-ch28-tooling.md", Quote: "the prelude's `Effect<A, E, R>` draws nothing",
		Slots: top, Text: "type Program$$ = Effect<number, never, never>;"},
	// Chapter 3: the error declaration replaces the TaggedError class.
	{Name: "error-declaration", Chapter: "428-part4-ch28-tooling.md", Quote: "`error NotFound { id: string }`",
		Slots: top, Text: "error NotFound$$ { id: string }\nexport function missing$$(id: string) {\n  throw new NotFound$$({ id });\n}"},
}
