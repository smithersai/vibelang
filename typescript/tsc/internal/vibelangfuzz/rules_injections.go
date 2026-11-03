package vibelangfuzz

// A ruleInjection violates exactly one rule of the current specification, as
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
	Code    int32
	Chapter string
	Name    string
	Quote   string
	Slots   []string
	Decls   string            // .vibe top-level declarations the text needs; never reported
	Text    string            // the violation
	Files   map[string]string // more files, such as a .ts module that Decls imports
	DOM     bool              // the text uses a DOM global
	Flat    bool              // the text must stand directly in its slot, not in a nested block
	// Category can override a default only when the current quote states it.
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

// Retired targets remain retired; quotes follow current chapters.
const loadDecl = "effect function load$$() { try yieldNow(); return 1; }"

var ruleInjections = []*ruleInjection{
	{Code: 1101, Name: "trailing-block", Chapter: "007-tooling.md", Quote: "| `EK1101` | A rejected trailing block | Pass the block as the last argument:", Slots: top,
		Text: "function invoke$$(body: () => number): number { return body(); }\nexport const value$$ = invoke$$() ⟦{ return 1; }⟧;"},
	{Code: 1201, Name: "top-provide", Chapter: "005-services.md", Quote: "`provide L { }` outside effect code. The parser reads it as a `provide` statement to report this, so the statement `provide / a / { }` in `function f(provide: number, a: number) { provide / a / { } }` is `EK1201`, not TypeScript's division: the provide reading wins in any code (decided detail 34). After `return`, a statement cannot start, so `return provide / a / { }` is a division. `provide(x)` without a same-line `{` stays a call", Slots: top,
		Decls: "service Nm$$ {\n  name(): string!!\n}\nconst NmLive$$ = Layer.succeed(Nm$$, { name() { return \"Ada\"; } });",
		Text:  "provide NmLive$$ {\n  const inside$$ = 1;\n}"},
	{Code: 1201, Name: "top-provide-calls", Chapter: "005-services.md", Quote: "`provide L { }` outside effect code. The parser reads it as a `provide` statement to report this, so the statement `provide / a / { }` in `function f(provide: number, a: number) { provide / a / { } }` is `EK1201`, not TypeScript's division: the provide reading wins in any code (decided detail 34). After `return`, a statement cannot start, so `return provide / a / { }` is a division. `provide(x)` without a same-line `{` stays a call", Slots: top,
		Decls: "service Nm$$ {\n  name(): string!!\n}\nconst NmLive$$ = Layer.succeed(Nm$$, { name() { return \"Ada\"; } });",
		Text:  "provide NmLive$$ {\n  Console.log(Nm$$.name());\n}"},
	{Code: 102, Name: "for-await", Chapter: "001-functions.md", Quote: "`await`, `for await` or `await using` in effect code: an `effect` function, a producer or an `effect` block", Slots: effectOnly,
		Text: "for await (const x$$ of [1, 2]) {\n  Console.log(x$$);\n}"},
	{Code: 404, Name: "run-promise", Chapter: "003-failures.md", Quote: "In effect code, a call (runtime `import()` included), `new` expression, tagged template or `async match` producing a Promise or thenable, even if assigned to a variable and never awaited.", Slots: effectOnly,
		Decls: "effect function later$$() {\n  sleep(\"1 millis\");\n  return \"later\";\n}", Text: "runPromise(later$$());"},
	{Code: 107, Name: "with", Chapter: "001-functions.md", Quote: "A banned use of `eval`, `Function`, `arguments`, `var` or `with` anywhere in a `.vibe` file, plain functions included, as [Legacy JavaScript](#direct-eval) defines it", Slots: effectOnly,
		Decls: "service Nm$$ {\n  name(): string!!\n}\nconst NmLive$$ = Layer.succeed(Nm$$, { name() { return \"Ada\"; } });",
		Text:  "with ({}) { const ignored$$ = 1; }"},
	{Code: 2103, Name: "yield-star", Chapter: "002-running.md", Quote: "`yield*` in a producer, `effect function* p() { yield* other() }`: no VIP specifies delegation", Slots: top,
		Decls: "effect function name$$(): string!! {\n  return \"x\";\n}", Text: "effect function* producer$$() { const value$$ = yield* name$$(); }"},
	{Code: 503, Name: "continue-finally", Chapter: "002-running.md", Quote: "a `try` statement (`try { } catch { }`, `try { } finally { }`) anywhere in effect code. Handle failures with `catch` or `match`, and clean up with `ensuring` or `onExit`: `try ensuring(write(x), close())`", Slots: effectOnly,
		Text: "for (const item$$ of [1, 2]) {\n  try {\n    const seen$$ = item$$;\n  } finally {\n    continue;\n  }\n}"},
	{Code: 503, Name: "return-finally", Chapter: "002-running.md", Quote: "a `try` statement (`try { } catch { }`, `try { } finally { }`) anywhere in effect code. Handle failures with `catch` or `match`, and clean up with `ensuring` or `onExit`: `try ensuring(write(x), close())`", Slots: top,
		Text: "export effect function swallow$$(n: number) {\n  try {\n    return n;\n  } finally {\n    return -1;\n  }\n}"},
	{Code: 902, Name: "service-body", Chapter: "005-services.md", Quote: "any member that is not a `PropertySignature`, a `MethodSignature`, a [KeyMember](900-appendices.md#keymember) or a [DefaultMember](900-appendices.md#defaultmember): a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`), a `get` or `set` accessor, a `constructor`, an index signature, a call signature `(x: number): string`, a construct signature `new (): X`, or another `static`. A bodyless `effect find(id: string): User!NotFound` or `async find(): Promise<User>` is `EK0902`; the quick fix removes the modifier: `find(id: string): User!NotFound`", Slots: top,
		Text: "service Users$$ {\n  find(id: string): string!!\n  describe(id: string) {\n    return id;\n  }\n}"},
	{Code: 902, Name: "service-initializer", Chapter: "005-services.md", Quote: "any member that is not a `PropertySignature`, a `MethodSignature`, a [KeyMember](900-appendices.md#keymember) or a [DefaultMember](900-appendices.md#defaultmember): a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`), a `get` or `set` accessor, a `constructor`, an index signature, a call signature `(x: number): string`, a construct signature `new (): X`, or another `static`. A bodyless `effect find(id: string): User!NotFound` or `async find(): Promise<User>` is `EK0902`; the quick fix removes the modifier: `find(id: string): User!NotFound`", Slots: top,
		Text: "service Region$$ {\n  region = \"eu\"\n}"},
	{Code: 503, Name: "untagged-clause", Chapter: "002-running.md", Quote: "a `try` statement (`try { } catch { }`, `try { } finally { }`) anywhere in effect code. Handle failures with `catch` or `match`, and clean up with `ensuring` or `onExit`: `try ensuring(write(x), close())`", Slots: effectOnly,
		Decls: "error Busy$$", Text: "try {\n  throw new Busy$$();\n} catch (e: Error) {\n  Console.log(\"error\");\n}"},
	{Code: 503, Name: "clause-after-all", Chapter: "002-running.md", Quote: "a `try` statement (`try { } catch { }`, `try { } finally { }`) anywhere in effect code. Handle failures with `catch` or `match`, and clean up with `ensuring` or `onExit`: `try ensuring(write(x), close())`", Slots: effectOnly,
		Decls: "error Busy$$\nerror Offline$$",
		Text:  "try {\n  if (1 + 1 === 2) throw new Busy$$();\n  throw new Offline$$();\n} catch (e) {\n  Console.log(\"any\");\n} catch (e: Busy$$) {\n  Console.log(\"busy\");\n}"},
	{Code: 2109, Name: "function-field", Chapter: "006-data.md", Quote: "a field type outside the mapping", Slots: top,
		Text: "schema Hooked$$ {\n  callback: () => void\n}"},
	{Code: 2111, Name: "restore-outside", Chapter: "002-running.md", Quote: "`restore { }` outside an `uninterruptible` block, `effect function f() { restore { } }`; one inside an `interruptible` block nested in it is inside, as `$restore` is in scope there", Slots: effectOnly,
		Text: "restore {\n  sleep(\"1 millis\");\n}"},
	{Code: 503, Name: "typed-clause", Chapter: "002-running.md", Quote: "a `try` statement (`try { } catch { }`, `try { } finally { }`) anywhere in effect code. Handle failures with `catch` or `match`, and clean up with `ensuring` or `onExit`: `try ensuring(write(x), close())`", Slots: effectOnly,
		Decls: "error NotFound$$\neffect function load$$(): string!NotFound$$! {\n  throw new NotFound$$();\n}",
		Text:  "try {\n  Console.log(load$$());\n} catch (e: NotFound$$) {\n  Console.log(\"missing\");\n}"},
	{Code: 503, Name: "cause-clause", Chapter: "002-running.md", Quote: "a `try` statement (`try { } catch { }`, `try { } finally { }`) anywhere in effect code. Handle failures with `catch` or `match`, and clean up with `ensuring` or `onExit`: `try ensuring(write(x), close())`", Slots: effectOnly,
		Decls: "error NotFound$$\neffect function load$$(): string!NotFound$$! {\n  throw new NotFound$$();\n}",
		Text:  "try {\n  Console.log(load$$());\n} catch (cause: Cause) {\n  Console.log(\"fallback\");\n}"},
	{Code: 504, Name: "catch-in-hatch", Chapter: "002-running.md", Quote: "`catch` outside effect code", Slots: effectOnly,
		Text: "const parsed$$ = () => succeed(1) catch (e) => 0;"},
	{Code: 504, Name: "catch-in-hatch-statement", Chapter: "002-running.md", Quote: "`catch` outside effect code", Slots: []string{slotHatch, slotAsyncHatch},
		Text: "const parsed$$ = succeed(1) catch (e) => 0;"},
	{Code: 2117, Name: "base-without-tag", Chapter: "003-failures.md", Quote: "a `_tag` member in an `error` or `schema error` body", Slots: top,
		Text: "error Base$$ { code: string }\nerror Child$$ extends Base$$ { extra: number }"},
	{Code: 2117, Name: "extends-class", Chapter: "003-failures.md", Quote: "a `_tag` member in an `error` or `schema error` body", Slots: top,
		Text: "class Plain$$ {\n  readonly x = 1;\n}\nerror Child$$ extends Plain$$"},
	{Code: 2117, Name: "own-tag", Chapter: "003-failures.md", Quote: "a `_tag` member in an `error` or `schema error` body", Slots: top,
		Text: "error Named$$ { _tag: \"Other\" }"},
	{Code: 2117, Name: "fields-no-constructor", Chapter: "003-failures.md", Quote: "a `_tag` member in an `error` or `schema error` body", Slots: top,
		Decls: "error Base$$ { code: string }",
		Text:  "error Child$$ extends Base$$ { extra: number }"},
	{Code: 1601, Name: "tag-field", Chapter: "006-data.md", Quote: "a variant field named `_tag`; rename it, because the variant name supplies the tag", Slots: top,
		Text: "data Reserved$$ {\n  Tagged { _tag: string }\n}"},
	{Code: 2801, Name: "five-parameters", Chapter: "006-data.md", Quote: "more than 4 type parameters; remove parameters beyond the limit of 4", Slots: top,
		Text: "data Five$$<A, B, C, D, E> {\n  Five { a: A; e: E }\n}"},
	{Code: 2126, Name: "constrained", Chapter: "006-data.md", Quote: "a constraint on a type parameter; remove the constraint", Slots: top,
		Text: "data Bound$$<A extends string> {\n  Bound { a: A }\n}"},
	{Code: 3001, Name: "shared-key", Chapter: "005-services.md", Quote: "two services with the same key anywhere in the program", Slots: top,
		MaxReports: 2,
		Text:       "function first$$() {\n  abstract class Local$$ {\n    abstract value(): Effect<number, never, never>\n  }\n  return Local$$;\n}\nfunction second$$() {\n  abstract class Local$$ {\n    abstract value(): Effect<string, never, never>\n  }\n  return Local$$;\n}"},
	{Code: 3002, Name: "extends-service", Chapter: "005-services.md", Quote: "`class X extends Users {}`", Slots: top,
		Decls: "service Users$$ {\n  find(id: string): string!!\n}", Text: "class UsersInMemory$$ extends Users$$ {}"},
	{Code: 3003, Name: "new-service", Chapter: "005-services.md", Quote: "`new Users()`", Slots: stmt,
		Decls: "service Users$$ {\n  find(id: string): string!!\n}", Text: "const users$$ = new Users$$();"},
	{Code: 3004, Name: "instanceof-service", Chapter: "005-services.md", Quote: "`impl instanceof Users`, and a class pattern `when Users:` or `when Users(…):`", Slots: stmt,
		Decls: "service Users$$ {\n  find(id: string): string!!\n}", Text: "const isUsers$$ = ({} as unknown) instanceof Users$$;"},
	{Code: 3005, Name: "generic-service", Chapter: "005-services.md", Quote: "`service Repo<T> { … }`", Slots: top,
		Text: "service Box$$<T>: ReadonlyArray<T>"},
	{Code: 902, Name: "static-shadow", Chapter: "005-services.md", Quote: "any member that is not a `PropertySignature`, a `MethodSignature`, a [KeyMember](900-appendices.md#keymember) or a [DefaultMember](900-appendices.md#defaultmember): a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`), a `get` or `set` accessor, a `constructor`, an index signature, a call signature `(x: number): string`, a construct signature `new (): X`, or another `static`. A bodyless `effect find(id: string): User!NotFound` or `async find(): Promise<User>` is `EK0902`; the quick fix removes the modifier: `find(id: string): User!NotFound`", Slots: top,
		Decls: "interface SearchApi$$ {\n  find(query: string): string!!\n}",
		Text:  "service Search$$: SearchApi$$ {\n  static find(query: string) {\n    return query;\n  }\n}"},
	{Code: 402, Name: "map-throws", Chapter: "900-appendices.md", Quote: "a function that may throw where a function type doesn't admit its thrown type", Slots: stmt,
		Decls: "error Negative$$\nfunction takes$$(f: () => number) { return f(); }", Text: "const checked$$ = takes$$(() => { throw new Negative$$(); });"},
	{Code: 403, Name: "plain-call", Chapter: "003-failures.md", Quote: "In effect code or a plain `catch` handler's parameter/default/destructuring initialization or body, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))`", Slots: effectOnly,
		Decls: "import { data$$ } from \"./plain$$.js\"",
		Files: map[string]string{"plain$$.ts": "export function data$$() {\n  return 42;\n}\n"},
		Text:  "const value$$ = data$$();"},
	{Code: 4402, Name: "console", Chapter: "005-services.md", Quote: "a statically named value that reaches the platform (rule below) anywhere in a `.vibe` file, including inside `Effect.try` and `tryPromise` arrows. The quick fix and the codemod move the code into a sibling `.ts` module that does not exist yet; never rewrite an existing foreign file, and refuse with the not-fixed explanation if the move cannot preserve run phase, captures, receiver and public types, or point to the Effect service (`HttpClient` for `fetch`)", Slots: stmt, DOM: true,
		Text: "console.log(\"hello\");"},
	{Code: 4402, Name: "fetch", Chapter: "005-services.md", Quote: "a statically named value that reaches the platform (rule below) anywhere in a `.vibe` file, including inside `Effect.try` and `tryPromise` arrows. The quick fix and the codemod move the code into a sibling `.ts` module that does not exist yet; never rewrite an existing foreign file, and refuse with the not-fixed explanation if the move cannot preserve run phase, captures, receiver and public types, or point to the Effect service (`HttpClient` for `fetch`)", Slots: stmt, DOM: true,
		Text: "const response$$ = fetch(\"https://example.com\");"},
	{Code: 4402, Name: "held-timer", Chapter: "005-services.md", Quote: "a statically named value that reaches the platform (rule below) anywhere in a `.vibe` file, including inside `Effect.try` and `tryPromise` arrows. The quick fix and the codemod move the code into a sibling `.ts` module that does not exist yet; never rewrite an existing foreign file, and refuse with the not-fixed explanation if the move cannot preserve run phase, captures, receiver and public types, or point to the Effect service (`HttpClient` for `fetch`)", Slots: stmt, DOM: true,
		Text: "const timer$$ = setTimeout;"},
	{Code: 4402, Name: "local-storage", Chapter: "005-services.md", Quote: "a statically named value that reaches the platform (rule below) anywhere in a `.vibe` file, including inside `Effect.try` and `tryPromise` arrows. The quick fix and the codemod move the code into a sibling `.ts` module that does not exist yet; never rewrite an existing foreign file, and refuse with the not-fixed explanation if the move cannot preserve run phase, captures, receiver and public types, or point to the Effect service (`HttpClient` for `fetch`)", Slots: stmt, DOM: true,
		Text: "const stored$$ = localStorage.getItem(\"key\");"},
	{Code: 102, Name: "await-call", Chapter: "001-functions.md", Quote: "`await`, `for await` or `await using` in effect code: an `effect` function, a producer or an `effect` block", Slots: effectOnly,
		Decls: loadDecl, Text: "const value$$ = await load$$();"},
	{Code: 102, Name: "await-promise", Chapter: "001-functions.md", Quote: "`await`, `for await` or `await using` in effect code: an `effect` function, a producer or an `effect` block", Slots: effectOnly,
		Decls: "declare const promise$$: Promise<number>;", Text: "const value$$ = await promise$$;"},
	{Code: 102, Name: "await-number", Chapter: "001-functions.md", Quote: "`await`, `for await` or `await using` in effect code: an `effect` function, a producer or an `effect` block", Slots: effectOnly,
		Text: "const value$$ = await 42;"},
	{Code: 1801, Name: "await-op-config", Chapter: "002-running.md", Quote: "an operand that is not an array of Effects, for `try.all`, `try.race`, `try.any` or `try.allSettled`", Slots: effectOnly,
		Text: "const configs$$ = [Config.String(\"A\")];\nconst values$$ = try.all configs$$;"},
	{Code: 1903, Name: "break-concurrent", Chapter: "002-running.md", Quote: "`break` that would leave head binding initialization or the body: `for concurrent (const x of xs) { break }`", Slots: effectOnly,
		Text: "for concurrent (const n$$ of [1, 2]) {\n  if (n$$ === 1) break;\n}"},
	{Code: 1904, Name: "return-concurrent", Chapter: "002-running.md", Quote: "`return` targeting the enclosing function in head binding initialization or the body: `for concurrent (const x of xs) { return x }`", Slots: effectOnly,
		Text: "for concurrent (const n$$ of [1, 2]) {\n  if (n$$ === 2) return;\n}"},
	{Code: 1801, Name: "race-object", Chapter: "002-running.md", Quote: "an operand that is not an array of Effects, for `try.all`, `try.race`, `try.any` or `try.allSettled`", Slots: effectOnly,
		Decls: loadDecl, Text: "const first$$ = try.race { a: load$$(), b: load$$() };"},
	{Code: 1801, Name: "any-object", Chapter: "002-running.md", Quote: "an operand that is not an array of Effects, for `try.all`, `try.race`, `try.any` or `try.allSettled`", Slots: effectOnly,
		Decls: loadDecl, Text: "const first$$ = try.any { a: load$$(), b: load$$() };"},
	{Code: 4609, Name: "await-fiber", Chapter: "900-appendices.md", Quote: "lint warning: `await` on a `Fiber` in an `async` function", Slots: top,
		Decls: loadDecl, Text: "export async function warning$$(f: Fiber.Fiber<number, never>) { return await f; }"},
	{Code: 4610, Name: "await-deferred", Chapter: "900-appendices.md", Quote: "lint warning: `await` on a `Deferred` in an `async` function", Slots: top,
		Text: "export async function warning$$(d: Deferred.Deferred<number, never>) { return await d; }"},
	{Code: 1704, Name: "join-deferred", Chapter: "002-running.md", Quote: "a `join` operand not assignable to `Fiber.Fiber<any, any>`: `join p` with `p: Promise<number>`; `join` the value `fork` gave (decided detail 88)", Slots: effectOnly,
		Text: "const deferred$$ = Deferred.make<number>();\nconst value$$ = ⟦join deferred$$⟧;"},
	{Code: 1704, Name: "join-number", Chapter: "002-running.md", Quote: "a `join` operand not assignable to `Fiber.Fiber<any, any>`: `join p` with `p: Promise<number>`; `join` the value `fork` gave (decided detail 88)", Slots: effectOnly,
		Text: "const count$$ = 42;\nconst value$$ = ⟦join count$$⟧;"},
	{Code: 1701, Name: "join-in-hatch", Chapter: "002-running.md", Quote: "`fork` or `join` outside effect code", Slots: stmt,
		Text: "const joined$$ = sync(() => {\n  const x: any = 1;\n  join x;\n});"},
	{Code: 4701, Name: "data-variant-left", Chapter: "004-match.md", Quote: "a `match` with no `default` over a finite union that misses a case", Slots: top,
		Decls: "data Delivery$$ {\n  Waiting\n  Sent { tracking: string }\n  Rejected { reason: string }\n}",
		Text:  "export function missing$$(d: Delivery$$) {\n  return match (d) {\n    when { _tag: \"Waiting\" }: \"waiting\";\n    when { _tag: \"Sent\" }: \"sent\";\n  };\n}"},
	{Code: 4701, Name: "literal-left", Chapter: "004-match.md", Quote: "a `match` with no `default` over a finite union that misses a case", Slots: top,
		Text: "export function letter$$(x: \"a\" | \"b\" | \"c\") {\n  return match (x) {\n    when \"a\": 1;\n    when \"b\": 2;\n  };\n}"},
	{Code: 4701, Name: "errors-left", Chapter: "004-match.md", Quote: "a `match` with no `default` over a finite union that misses a case", Slots: top,
		Decls: "error NotFound$$ { id: string }\nerror Timeout$$",
		Text:  "export function failure$$(e: NotFound$$ | Timeout$$) {\n  return match (e) {\n    when NotFound$$: \"no user\";\n  };\n}"},
	{Code: 702, Name: "arguments-on-variant", Chapter: "004-match.md", Quote: "a class pattern naming a `data` declaration or variant, a `schema`, or a directly constructed `Context.Reference`; a call-only callee whose return type fails detail 94, or a callee with neither signature (services use `EK3004`; [Class patterns](#class-patterns))", Slots: top,
		Decls: "data Delivery$$ {\n  Waiting\n  Sent { tracking: string }\n}",
		Text:  "export function tracking$$(d: Delivery$$) {\n  return match (d) {\n    when Delivery$$.Sent(let sent): sent;\n    default: \"\";\n  };\n}"},
	{Code: 3801, Name: "floating-effect", Chapter: "007-tooling.md", Quote: "An `effect { … }` expression statement builds and discards an unrun Effect; imported `floatingEffect` reports it as `EK3801`, as in TypeScript.", Slots: effectOnly,
		Decls: "declare const program$$: Effect<number>;", Text: "program$$;"},
	{Code: 102, Name: "await-using", Chapter: "001-functions.md", Quote: "`await`, `for await` or `await using` in effect code: an `effect` function, a producer or an `effect` block", Slots: effectOnly,
		Decls: "declare effect function open$$(path: string): AsyncDisposable;", Text: "await using handle$$ = open$$(\"/tmp/a\");"},
	{Code: 404, Name: "effect-run-promise", Chapter: "003-failures.md", Quote: "In effect code, a call (runtime `import()` included), `new` expression, tagged template or `async match` producing a Promise or thenable, even if assigned to a variable and never awaited.", Slots: effectOnly,
		Decls: loadDecl, Text: "Effect.runPromise(() => load$$());"},
	{Code: 503, Name: "break-finally", Chapter: "002-running.md", Quote: "a `try` statement (`try { } catch { }`, `try { } finally { }`) anywhere in effect code. Handle failures with `catch` or `match`, and clean up with `ensuring` or `onExit`: `try ensuring(write(x), close())`", Slots: effectOnly,
		Text: "while (1 + 1 === 2) {\n  try {\n    const seen$$ = 1;\n  } finally {\n    break;\n  }\n}"},
	{Code: 2117, Name: "error-extends-schema-error", Chapter: "003-failures.md", Quote: "a `_tag` member in an `error` or `schema error` body", Slots: top,
		Text: "schema error Base$$ { code: string }\nerror Child$$ extends Base$$ { extra: number }"},
	{Code: 4402, Name: "global-this-fetch", Chapter: "005-services.md", Quote: "in a `.vibe` file, an `import` or `export … from` declaration, or an `import(…)` call with a string-literal specifier, whose specifier names a Node builtin with or without `node:` (`node:fs`, `fs`, `child_process`: Node's `module.builtinModules`), except an `import type` or `export type … from` declaration", Slots: stmt, DOM: true,
		Text: "const response$$ = globalThis.fetch(\"https://example.com\");"},
	{Code: 1701, Name: "join-in-async-hatch", Chapter: "002-running.md", Quote: "`fork` or `join` outside effect code", Slots: []string{slotAsyncHatch},
		Text: "const x$$: any = 1;\njoin x$$;"},
	{Code: 4701, Name: "option-left", Chapter: "004-match.md", Quote: "a `match` with no `default` over a finite union that misses a case", Slots: top,
		Text: "export function unwrap$$(o: Option<number>) {\n  return match (o) {\n    when Option.Some(let v): v;\n  };\n}"},
	{Code: 4701, Name: "boolean-left", Chapter: "004-match.md", Quote: "a `match` with no `default` over a finite union that misses a case", Slots: top,
		Text: "export function yes$$(b: boolean) {\n  return match (b) {\n    when true: \"yes\";\n  };\n}"},
	{Code: 1801, Name: "unrun-element", Chapter: "002-running.md", Quote: "an operand that is not an array of Effects, for `try.all`, `try.race`, `try.any` or `try.allSettled`", Slots: effectOnly,
		Decls: loadDecl, Text: "const job$$ = () => load$$();\nconst both$$ = try.all [⟦job$$⟧, load$$()];"},
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
	{Name: "pure-helpers", Chapter: "005-services.md", Quote: "ECMAScript library globals (`Date.now`, `Math.random`, `JSON`, `Intl`) and web data utilities with no I/O (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `structuredClone`, `atob`, `btoa`, `AbortController`, `AbortSignal`) stay allowed, apart from the [three members](#reaches-the-platform) that reach the host.",
		Slots: stmt, DOM: true, Text: "const host$$ = new URL(\"https://example.com/a\").host;\nconst bytes$$ = new TextEncoder().encode(host$$);\nconst copy$$ = structuredClone({ n: bytes$$.length });"},
	{Name: "join-fiber", Chapter: "002-running.md", Quote: "| `join f` | `yield* Fiber.join(f)` | |",
		Slots: effectOnly, Decls: loadDecl, Text: "const fiber$$ = fork load$$();\nconst value$$ = join fiber$$;"},
	{Name: "race-array", Chapter: "002-running.md", Quote: "| `try.race [a(), b()]` | `yield* Effect.raceAllFirst([a(), b()])` | the first to finish: success, failure or defect; the losers are interrupted |",
		Slots: effectOnly, Decls: loadDecl, Text: "const first$$ = try.race [load$$(), load$$()];"},
	{Name: "concurrent-continue", Chapter: "002-running.md", Quote: "`continue`, and a labeled `continue` naming the `for concurrent` itself, end that one item: each is `return` from the item's generator, as the example shows. The others are errors because the body runs in `Effect.forEach`'s callback, not in the enclosing loop or function (VIP-19). A loop or `switch` nested in the body keeps its own `break` and `continue`.",
		Slots: effectOnly, Text: "for concurrent (const n$$ of [1, 2]) {\n  if (n$$ === 1) continue;\n  try Console.log(n$$);\n}"},
	{Name: "restore-inside", Chapter: "002-running.md", Quote: "`uninterruptible { }` is always `Effect.uninterruptibleMask(($restore) => Effect.gen(\u2026))`, as VIP-22 writes it, whether or not a `restore` block is inside it.",
		Slots: effectOnly, Text: "uninterruptible {\n  restore {\n    try sleep(\"1 millis\");\n  }\n}"},
	{Name: "match-default", Chapter: "004-match.md", Quote: "At least one arm is required; `default` appears at most once, last;",
		Slots: top, Decls: "",
		Text: "export function described$$(n: number) { return match(n) { when 1: \"one\"; default: \"other\"; }; }"},
	{Name: "match-guard", Chapter: "004-match.md", Quote: "guards belong to `MatchPattern` (`P and if (condition)`).",
		Slots: top, Text: "export function small$$(n: number) {\n  return match (n) {\n    when let m and if (m < 10): \"small\";\n    default: \"large\";\n  };\n}"},
	{Name: "match-parenthesized", Chapter: "004-match.md", Quote: "`match`, `when`, `is`, patterns, guards, `and`, `or`, `not` and `default` follow the [vendored TC39 snapshot](../vips/tc39-pattern-matching/README.md): commit `ba73ffe42f30f0cf56ece28bebdc28f955f2a52e`, dated `2025-10-03`, with the reconciliations listed there. VibeLang moves to a newer snapshot deliberately, never automatically. The full proposal is in the language, including regular-expression patterns, relational patterns and `async match`, with the class adaptations below (decided details 67 and 67a).",
		Slots: top, Text: "export function mixed$$(n: number) {\n  return match (n) {\n    when (1 and Number) or 3: \"mixed\";\n    default: \"other\";\n  };\n}"},
	{Name: "plain-calls-plain", Chapter: "001-functions.md", Quote: "| plain | `function f() { }`, `() => …` | its result, as in TypeScript | TypeScript |",
		Slots: top, Text: "function increment$$(n: number): number {\n  return n + 1;\n}\nexport function twice$$(n: number): number {\n  return increment$$(increment$$(n));\n}"},
	{Name: "top-plain-call", Chapter: "001-functions.md", Quote: "A module's top level is ordinary JavaScript (VIP-26).",
		Slots: top, Text: "function increment$$(n: number): number {\n  return n + 1;\n}\nexport const two$$ = increment$$(1);"},
	{Name: "provide-statement", Chapter: "005-services.md", Quote: "A `provide` block is an ordinary block, as in TypeScript: its `return`, `break`, `continue` and declarations mean what they mean in any block, and the lowering keeps them with [region bodies](002-running.md#region-bodies). In a producer, `yield x` inside it is the producer's `yield` ([Producers](002-running.md#producers)).",
		Slots: effectOnly, Decls: "service Left$$ {\n  left: number\n}\nconst LeftLive$$ = Layer.succeed(Left$$, { left: 1 });",
		Text: "provide LeftLive$$ {\n  try Console.log((try Left$$).left);\n}"},
	{Name: "error-declaration", Chapter: "003-failures.md", Quote: "error NotFound { id: string }",
		Slots: top, Text: "error NotFound$$ { id: string }\nexport function missing$$(id: string) {\n  throw new NotFound$$({ id });\n}"},
}
