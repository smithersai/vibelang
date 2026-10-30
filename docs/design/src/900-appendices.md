# Appendices

## Appendix A. Grammar

VibeLang's grammar is TypeScript's, plus three TC39 proposals and the productions below. This appendix is the only place a VibeLang production is written; chapters show examples and link here by production name. Pattern matching is pinned to commit `ba73ffe42f30f0cf56ece28bebdc28f955f2a52e` with its reconciliations ([Pattern matching](004-match.md)). Do expressions are pinned to `tc39/proposal-do-expressions` commit `3ef6d463b8163cbf222846b40d17178cca36e9e1` and the Hack pipe operator to `tc39/proposal-pipeline-operator` commit `5ac4dfd624e68b649e6f947885bf5ef67bac19f4`, each repository's head on 2026-10-28 (UTC), vendored in [`vips/tc39-do-expressions/`](../vips/tc39-do-expressions/README.md) and [`vips/tc39-pipeline-operator/`](../vips/tc39-pipeline-operator/README.md). Names not defined here (`Block`, `Type`, `UnaryExpression`, `ConciseBody`, …) are TypeScript's or ECMAScript's. `"x"` is a token; `X?` is optional; `X*` repeats; `[no LineTerminator here]` and `[lookahead ∉ …]` are ECMAScript's restrictions.

### The `[Effect]` parameter

VibeLang adds one grammar parameter, `[Effect]`, and uses it exactly as ECMAScript uses `[Await]`. A production is parsed with `[+Effect]` where ECMAScript would parse it with `[+Await]` if every `effect` modifier were `async`: the parameters and body of an `effect` function, arrow, method or producer, and the body of an `effect` block. As with `[Await]`, a nested plain function, arrow or method body is parsed with `[~Effect]`, an `async match` with `[~Effect, +Await]` as a nested `async` function, and a class body keeps the parameter of the code around it. "Effect code" ([Running Effects](002-running.md)) is the code parsed with `[+Effect]`, minus parameter lists, class field initializers and `static` blocks. A computed class key and an `extends` clause are effect code, as `await` is allowed there in an `async` function: in `effect function f() { class C { [try key()]() { } } }` the `try` is valid.

Under `[+Effect]`:

- `fork` and `join` are reserved words, as `await` is under `[+Await]` (VIP-17, amended). No next-token test applies. An `IdentifierReference`, `BindingIdentifier` or `LabelIdentifier` can't be `fork` or `join`, so `join(parts)` is always a [JoinExpression](#joinexpression), `join - 1` joins `-1`, and a parameter or local named `join` is a syntax error. They stay ordinary `IdentifierName`s, as `await` does: `parts.join(",")`, `o?.fork`, `{ join: 1 }` and `class { join() { } }` are names. After the keyword, `/` begins a regular expression, and the operand may follow a line break, as after `await`: `join` then `f` on the next line joins `f`.
- [TryExpression](#tryexpression), [CatchExpression](#catchexpression), [ForkExpression](#forkexpression), [JoinExpression](#joinexpression), [TryAll](#tryall), [ForConcurrent](#forconcurrent), [ForTry](#fortry), the interruption blocks and [ProvideStatement](#providestatement) are available. As ECMAScript makes an `AwaitExpression` in an async function's `FormalParameters` or in a class field initializer an early error, any of these in a parameter list, a class field initializer or a `static` block is an error: the "outside effect code" rule of each construct ([Running Effects](002-running.md#static-rules)).

Under `[~Effect]` those productions don't exist, and `fork` and `join` are identifiers. As TypeScript parses `await x` in a plain function to report "only allowed in async functions", a parser recovers by parsing these productions under `[~Effect]` and reports the construct's "outside effect code" rule, except where the tokens are also valid TypeScript, which keep their TypeScript meaning:

```text
function f(p) { return try p }     try outside effect code
function f(p) { return join p }    join outside effect code
function f(p) { return join(p) }   a call to join
provide(x)                         a call to provide: no "{" on the same line
```

### Contextual keywords

<a id="declaration-keywords"></a>**Declaration keywords.** `service`, `error`, `schema` and `data` follow TypeScript's contextual keyword `type`, whose alias declaration is `type` [no LineTerminator here] `BindingIdentifier`. This is the one rule for all four:



Where a TypeScript declaration can start (a `StatementListItem`, or after `export`), a `DeclarationStart` begins that declaration, longest alternative first. Anything else is ordinary TypeScript, where the word is an identifier: `const error = …`, `catch (error)`, `const e = error as Error`, `return data as User[]`, `const ok = schema satisfies Schema.Top` and `error instanceof NotFound;` (a reserved word is not a `BindingIdentifier`). After the name, the declaration's production decides the rest, and line breaks may separate its tokens as in a TypeScript `class` or `type` declaration: a body's `{` and a `schema` alias's `=` may follow line breaks. The one production-specific rule is the bodyless `error` and `schema error` form, under [ErrorDeclaration](#errordeclaration). No other line-break or disambiguation rule applies to these four words.

```text
service Users                 one service: the body follows the name, as a class body does
{ find(): User }
error Timeout                 one error declaration with the field id
{ id: string }
schema Code                   one alias, as `type Code` then `= …` is
= "a" | "b"
service as { a: string };     a service named as
service as T;  error as T;    syntax errors: `T` can't follow the declaration of `as`;
schema as T;  data as T;      write (service as T); for the TypeScript assertion
schema satisfies T;           a syntax error, as for `as`: write (schema satisfies T);
schema error = T              a schema named error: `=` is not a BindingIdentifier
schema error E { }            a schema error E
const e = error as Error      an assertion: not where a declaration starts
error instanceof NotFound;    an expression: `instanceof` is not a BindingIdentifier
error                         an expression statement: no name on the line
Timeout                       then another
```

**Other contextual keywords.** Each word below is a keyword only before the tokens listed, on the same line, and an ordinary identifier everywhere else. Each is tested wherever its production can appear.

| Word | Keyword when followed by | Chapter |
| --- | --- | --- |
| `effect` | `function`; an arrow head, as for `async`: `(` … `)` then `=>`, `<` type parameters of such an arrow, or an identifier then `=>`; in a class or object literal only: a method name (`ClassElementName`, `#m` included) then `(` or `<`, `*`, or `get` or `set` then a name ([EffectAccessor](#effectaccessor)), as TypeScript parses `async get x()`; at a statement start, a name other than `as` or `satisfies`, then `(` or `<` ([EffectShorthand](#effectshorthand)); `{`, except directly after `extends` in a class heritage, where `effect` is an identifier and `{` starts the class body, as in TypeScript. `effect * rate` is a multiplication; `effect(x)` with no `=>` is a call; `class C extends effect { }` extends a value named `effect` | [Functions](001-functions.md) |
| `concurrent` | after `for`, then `(` | [Running Effects](002-running.md#for-concurrent) |
| `uninterruptible`, `interruptible`, `restore` | `{` | [Running Effects](002-running.md#interruption-blocks) |
| `provide` | only when the tokens from `provide` through the `{` on the line where the last provider ends parse as the head of a [ProvideStatement](#providestatement), everything before its Block's `StatementList`, as an arrow needs its whole head; otherwise an identifier, in effect code too | [Services](005-services.md#provide-blocks) |
| `match`, `when`, `is`, `and`, `or`, `not` | as TC39's pattern-matching proposal says | [Pattern matching](004-match.md) |

`try` and `catch` are reserved words already; VibeLang gives them expression forms under `[+Effect]`. At the start of a statement, `try` followed by `{`, on the same line or not, is TypeScript's `try` statement, as in JavaScript.

### Productions

Each declaration production starts with its own start production (`ServiceDeclaration` with `ServiceStart`, and so on); `export` and `export default` come from ECMAScript's `ExportDeclaration`, so `export error E { }` parses and `export default error E { }` is a syntax error (`export default` takes only a function or class declaration or an expression).

#### DeclarationStart

```text
DeclarationStart = ServiceStart | ErrorStart | SchemaErrorStart | SchemaStart | DataStart
```

#### ServiceStart

```text
ServiceStart     = "service" [no LineTerminator here] BindingIdentifier
```

#### ErrorStart

```text
ErrorStart       = "error"   [no LineTerminator here] BindingIdentifier
```

#### SchemaErrorStart

```text
SchemaErrorStart = "schema"  [no LineTerminator here] "error" [no LineTerminator here] BindingIdentifier
```

#### SchemaStart

```text
SchemaStart      = "schema"  [no LineTerminator here] BindingIdentifier
```

#### DataStart

```text
DataStart        = "data"    [no LineTerminator here] BindingIdentifier
```

#### EffectFunction

```text
EffectFunction = "effect" [no LineTerminator here] "function" Name? TypeParameters? Params ReturnType? Block
```

#### EffectArrow

```text
EffectArrow = "effect" [no LineTerminator here] TypeParameters? ArrowParams ReturnType? [no LineTerminator here] "=>" ConciseBody
```

#### EffectMethod

```text
EffectMethod = Modifiers? "effect" [no LineTerminator here] ClassElementName TypeParameters? Params ReturnType? Block   (in a class; PropertyName in an object literal)
```

#### EffectAccessor

```text
EffectAccessor = Modifiers? "effect" [no LineTerminator here] ("get" | "set") ClassElementName Params ReturnType? Block   (parses, then the getter/setter rule rejects it)
```

`effect get x() { }` is an `EffectAccessor`; `effect get() { }` is an `EffectMethod` named `get`.

#### EffectShorthand

```text
EffectShorthand = ("effect" | "async") [no LineTerminator here] [lookahead ∉ { as, satisfies }] BindingIdentifier TypeParameters? Params ReturnType? Block   (at a statement start; parses, then the top-level-shorthand rule rejects it)
```

`effect load() { }` and `async load() { }` outside a class or object literal are `EffectShorthand`s; the quick fix inserts `function`. Neither token sequence is valid TypeScript there, so no program changes meaning; `effect as (Handler);` stays a TypeScript type assertion.

#### Producer

```text
Producer = "effect" [no LineTerminator here] "function" "*" Name? TypeParameters? Params ReturnType? Block
```

#### ProducerMethod

```text
ProducerMethod = Modifiers? "effect" [no LineTerminator here] "*" ClassElementName TypeParameters? Params ReturnType? Block   (in a class; PropertyName in an object literal)
```

#### Params

```text
Params = "(" FormalParameters ")"
```

#### ArrowParams

```text
ArrowParams = ArrowParameters   (an identifier or a parenthesized list, as for async)
```

#### Modifiers

```text
Modifiers = the class-member modifiers TypeScript allows before async (static, public, private, protected, override)
```

#### EffectType

```text
EffectType = EffectOperand [no LineTerminator here] "!" EffectOperand [no LineTerminator here] "!" EffectOperand   (A!E!R)
           | EffectOperand [no LineTerminator here] "!" EffectOperand                                        (A!E)
           | EffectOperand [no LineTerminator here] "!" "!" [no LineTerminator here] [lookahead ≠ "{"] EffectOperand   (A!!R)
           | EffectOperand [no LineTerminator here] "!" "!"                                                  (A!!)
```

#### EffectOperand

```text
EffectOperand = a type at TypeScript's type-operator level (what parseTypeOperatorOrHigher accepts: a primary type with postfix [] and [K], optionally after keyof, unique, readonly or infer), never an unparenthesized EffectType
```

#### TryExpression

```text
TryExpression = [+Effect] "try" UnaryExpression   (where ECMAScript has AwaitExpression)
```

#### CatchExpression

<a id="shortcircuitexpression"></a>

```text
ShortCircuitExpression = LogicalORExpression | CoalesceExpression | [+Effect] CatchExpression   (ECMAScript's, plus CatchExpression)
```

```text
CatchExpression = CatchHead "catch" ArrowHandler | ClosedCatchExpression
```

<a id="closedcatchexpression"></a>

```text
ClosedCatchExpression = CatchHead "catch" NonArrowHandler
```

<a id="catchhead"></a>

```text
CatchHead = ClosedCatchExpression | BitwiseORExpression
```

#### CatchHandler

```text
CatchHandler = ArrowHandler | NonArrowHandler   (always a function literal; VIP-5, amended 2026-10-29)
```

<a id="arrowhandler"></a>

```text
ArrowHandler = ArrowFunction | AsyncArrowFunction | EffectArrow
```

<a id="nonarrowhandler"></a>

```text
NonArrowHandler = FunctionExpression | GeneratorExpression | AsyncFunctionExpression | AsyncGeneratorExpression
                | EffectFunction
                | "(" CatchHandler ")"
```

#### EffectBlock

```text
EffectBlock = "effect" [no LineTerminator here] Block   (a PrimaryExpression)
```

#### ForkExpression

```text
ForkExpression = [+Effect] "fork" ForkOperand
               | [+Effect] "fork" "." "in" "(" AssignmentExpression ")" ForkOperand
               | [+Effect] "fork" "." "scoped" ForkOperand
               | [+Effect] "fork" "." "detached" ForkOperand
```

#### JoinExpression

```text
JoinExpression = [+Effect] "join" ForkOperand   (a line break may follow "join", as after "await")
```

#### ForkOperand

```text
ForkOperand = UnaryExpression   (await's operand, as for try; VIP-17, amended: "exactly as await")
```

#### TryAll

```text
TryAll = [+Effect] "try" "." ("all" | "race" | "any" | "allSettled") UnaryExpression
```

As in `new . target`, whitespace, comments and line breaks may separate the tokens of `try.all`, `fork.in`, `fork.scoped` and `fork.detached`: `try . all [a, b]` is `try.all [a, b]`.

#### ForConcurrent

```text
ForConcurrent = [+Effect] "for" "concurrent" ("(" AssignmentExpression ")")? "(" ForDeclaration "of" AssignmentExpression ")" Statement
```

#### ForTry

```text
ForTry = [+Effect] "for" "try" "(" ForDeclaration "of" AssignmentExpression ")" Statement
```

`ForDeclaration` is ECMAScript's, `LetOrConst ForBinding`: a `const` or `let` declaration, destructuring included (VIP-19 and VIP-20, amended). `var` and an assignment head are syntax errors: `for try (x of s)` and `for try (o.x of s)` have no declaration; write `for try (const v of s) { x = v }`.

#### Uninterruptible

```text
Uninterruptible = [+Effect] "uninterruptible" [no LineTerminator here] Block
```

#### Restore

```text
Restore = [+Effect] "restore" [no LineTerminator here] Block
```

#### Interruptible

```text
Interruptible = [+Effect] "interruptible" [no LineTerminator here] Block
```

#### ProvideStatement

```text
ProvideStatement = [+Effect] "provide" [no LineTerminator here] Provider ([no LineTerminator here] "," [no LineTerminator here] Provider)* [no LineTerminator here] Block
```

No line break may come between `provide` and the first provider, on either side of a comma, or between the last provider and the block's `{` (VIP-12: "its providers and block must be on one line"). Inside a provider, line breaks are free, as in any expression:

```text
provide Users = {               a provide statement: the provider ends on the line of "{"
  find: (id) => f(id) } { … }
provide A,                      syntax error: a line break after ","
  B { … }
provide(x)                      a call: no "{" on the line where the provider ends
provide[0] = 1                  in effect code too: TypeScript, provide an identifier
provide - 1                     in effect code too: TypeScript, provide an identifier
provide / a / { }               a provide statement of the regex /a/: the cover rule wins, as an arrow head does
```

#### Provider

```text
Provider = LeftHandSideExpression "=" AssignmentExpression   (Key = value)
         | ConditionalExpression                             (a Layer)
```

#### ServiceDeclaration

```text
ServiceDeclaration = ServiceStart TypeParameters? "{" (ServiceMember Separator)* "}"   (a member that ends in a Block needs no Separator, as a class method)
```

<a id="servicemember"></a>

```text
ServiceMember = KeyMember | DefaultMember | Member   (separated as interface members)
```

#### Member

```text
Member = PropertySignature | MethodSignature | RejectedMember
```

<a id="rejectedmember"></a>

```text
RejectedMember = a ClassElement or a TypeScript TypeMember (a call or construct signature) that is not a PropertySignature, MethodSignature, KeyMember or DefaultMember   (parses, then a static rule rejects it)
```

#### KeyMember

```text
KeyMember = "static" "readonly" "key" (":" Type)? "=" StringLiteral
```

#### DefaultMember

```text
DefaultMember = "static" "readonly" "defaultValue" (":" Type)? "=" AssignmentExpression
```

#### ErrorDeclaration

```text
ErrorDeclaration = ErrorStart TypeParameters? ClassHeritage? ("{" ErrorBody "}")?   (no body: ends as a TypeScript statement)
```

The body of an `error` or `schema error` declaration is optional, as the body of TypeScript's `declare module "m"` is: when the next token after the name is `{`, however many line breaks precede it, or `<`, `extends` or `implements` on the name's line, the declaration continues; otherwise it ends as a TypeScript statement does, at `;`, a line break, `}` or the end of the file. So `error Timeout` then `const t = 1` on the next line is a declaration with no fields, then a `const`; `error Timeout` then `<T>(x: T) => x` is a declaration, then a generic arrow statement.

#### SchemaErrorDeclaration

```text
SchemaErrorDeclaration = SchemaErrorStart TypeParameters? ClassHeritage? ("{" ErrorBody "}")?   (no body: ends as a TypeScript statement)
```

#### ErrorBody

```text
ErrorBody = (Field | MethodDefinition | EffectMethod | ProducerMethod | ";" | RejectedElement)*   (MethodDefinition is ECMAScript's: getters and setters included)
```

<a id="rejectedelement"></a>

```text
RejectedElement = a ClassElement (an EffectAccessor included) that is not a Field, MethodDefinition, EffectMethod, ProducerMethod or ";"   (parses, then a static rule rejects it)
```

#### Field

```text
Field = "readonly"? PropertyName "?"? ":" Type Separator   (keys as in a TypeScript object type: an identifier, a string or numeric literal, or a computed name)
```

#### Separator

```text
Separator = ";" | "," | a LineTerminator before the next token | before "}"   (after the Type is complete, as TypeScript's parseTypeMemberSemicolon)
```

#### SchemaDeclaration

```text
SchemaDeclaration = SchemaStart "{" Field* "}"
                  | SchemaStart "=" Type
```

#### DataDeclaration

```text
DataDeclaration = DataStart TypeParameters? "{" (Variant (Separator Variant)* Separator?)? "}"
```

#### Variant

```text
Variant = Name ("{" Field* "}")?   (a "{" after the name is its field body, after any line breaks: the LineTerminator alternative of Separator does not apply before "{")
```

#### MatchBody

```text
MatchBody = "{" MatchArm (";" MatchArm)* ";" "}"
```

#### MatchArm

```text
MatchArm = "when" MatchPattern ":" ArmBody | "default" ":" ArmBody
```

#### ArmBody

```text
ArmBody = Expression | "throw" Expression
```

### Notes on the productions

**`catch`.** [CatchExpression](#catchexpression) sits in ECMAScript's precedence chain beside `CoalesceExpression`, and its head mirrors `CoalesceExpressionHead`: it binds like `??`, is left-associative, and can't be mixed with `??`, `||` or `&&` without parentheses, for the same structural reason `a ?? b || c` is a syntax error. The handler is a function literal, possibly parenthesized, so its kind is decided by its syntax alone ([Running Effects](002-running.md#catch)). An unparenthesized arrow handler ends the chain: its `ConciseBody` is the longest `AssignmentExpression`, as in an ECMAScript arrow, so a later `catch` belongs to the body. Any other handler is a closed expression, after which only another `catch` or a lower-precedence operator can follow.

```text
a catch (() => b) catch (() => c)    (a catch (() => b)) catch (() => c); type-checks only when the inner catch gives an Effect: a's success (never, if a only fails) and b are both Effects
a catch () => b ? c : d              a catch (() => (b ? c : d))
a catch (e) => b catch () => c       error: under [~Effect] the plain arrow body stops at b; reported as `catch` outside effect code
a catch effect (e) => b catch () => c
                                     a catch (effect (e) => (b catch (() => c)))
a catch function (e) { … }           a plain function handler
a catch (effect function (e) { … })  an effect function handler
a catch b                            syntax error: not a function literal; write a catch () => b
a catch effect { b }                 syntax error: an effect block is not a function literal
a catch class { }                    syntax error: a class is not a function literal
```

**`for concurrent`.** After `for concurrent`, the first parenthesized group is the limit only when it parses as an `AssignmentExpression` and the next group is the for…of head. A group that holds `ForDeclaration of …` is the head, whatever follows it:

```text
for concurrent (4) (const x of xs) f(x)        limit 4
for concurrent (const x of xs) (try g(x));     no limit; the body is a parenthesized expression
```

**`!` in types.** `A!B!C` is always the three-slot form; write `(A!B)!C` to nest, and `A!!B!C` is a syntax error. The `[no LineTerminator here]` before `!` is the restriction TypeScript puts on its postfix type operators (`[]`): in `x as User` followed by a line `!flag && fail()`, the type ends at `User`. `R` after `!!` starts on the same line and never with `{`; write `A!!({ … })` for a type-literal requirement. In a type, the scanner splits `!=` or `!==` only directly after `A!`, where the `!` completes `A!!`, as TypeScript rescans `>=` after type arguments only on demand; anywhere else they stay equality operators. `!` does not mix with `|`, `&`, function types or conditional types without parentheses: each is a syntax error with a quick fix that parenthesizes (`EK0301`). Each operand sits at the type-operator level, so prefix and postfix operators bind tighter than `!`.

```text
service S {                       two members: R can't start on the next line
  now(): number!!
  later(): number!! }
effect function f(): number!! {   "{" begins the body, not R
const e: User!!= load()           const e: User!! = load()
x as number !== 0                 (x as number) !== 0, as in TypeScript
type T = A | B!E                  syntax error; write (A | B)!E or A | (B!E)
keyof A!E                         (keyof A)!E
A!E[]                             A!(E[]); write (A!E)[] for an array of Effects
User!![]                          Effect.Effect<User, never, []>; write (User!!)[] for an array
```

`(A | B)!E` is `Effect.Effect<A | B, E>`; `A | (B!E)` is `A | Effect.Effect<B, E>`.

**Fields.** A field's `Type` is parsed greedily, as in a TypeScript type member; then the field ends at `;`, `,`, a line break or `}`, so `{ a: string b: number }` is a syntax error and a union may continue on the next line:

```text
schema User { role:             one field, role: "admin" | "user"
  | "admin"
  | "user" }
```

A variant's `{` may follow a line break, as an error body's may; a line break before `{` is not a separator, so `data D { A` then `{ x: string } }` gives `A` the field `x`. `readonly` is allowed on any field; `error` and `data` fields are readonly either way. `data Empty {}` has no variants; it is an empty `Data.TaggedEnum`.

**Declarations.** `ServiceDeclaration`, `ErrorDeclaration` and `SchemaErrorDeclaration` are deliberately wider than the language, so `service Repo<T> { }`, `error E<T> { }` and `error E { static x = 1 }` reach the coded static rules of [Failures](003-failures.md#error-declarations) and [Services](005-services.md#static-rules) instead of a generic syntax error. The alternatives don't overlap: a member that parses as a `Field`, `PropertySignature`, `MethodSignature`, `KeyMember` or `DefaultMember` is that member, never a rejected one, so `service S { a: number, b: string }` uses interface separators. ECMAScript's `MethodDefinition` already contains getters, setters and `constructor`, so each has one parse: a getter is accepted, and the setter and constructor rules reject the other two. `EffectMethod` and `ProducerMethod` start with `effect` and a name, which no `MethodDefinition` does (`effect() { }` is a method named `effect`). A `MethodDefinition`, `EffectMethod` or `ProducerMethod` in an error body takes the method modifiers TypeScript allows in a class (`private m()`, `protected`, `override`), as any class can (VIP-13); a `static` one is rejected by the `static` rule. A member gets one diagnostic: the first row of its chapter's table that names it; the `RejectedElement` or `RejectedMember` row applies only when no other row does, and a member that a [Functions](001-functions.md) `effect` rule rejects (`effect get`, `effect set`, `effect constructor`) gets that diagnostic alone.

```text
error E { id: string }            a Field
error E { id = "init" }           RejectedElement: an initializer
error E { private id: string }    RejectedElement: a modifier other than readonly
error E { get message() { } }     a MethodDefinition (a getter)
error E { effect again() { } }    an EffectMethod
error E { m() { }; id: string }   a MethodDefinition, the empty element ";", a Field
error E { effect get x() { } }    an EffectAccessor: the getter/setter rule alone
service S { a: number b: string } syntax error: no separator, as in an interface
error E implements I { }          parses; an implements clause is rejected
service S { static readonly key = "k" }   a KeyMember
service S { static readonly key: string = "k" }   a KeyMember
service S { static readonly key = `k` }   RejectedMember: not a string literal
service S { (x: number): string }   RejectedMember: a call signature
service S { static key = "k" }    RejectedMember: not a KeyMember
service S { x: number = 1 }       RejectedMember: an initializer
```

**Match arms.** [MatchArm](#matcharm) is the pinned draft's clause with VIP-7's `when` prefix and VIP-5's `throw` arm body. `default` is last, guards belong to `MatchPattern`, and every arm ends with `;`, the last one included; a newline is not a separator.

## Appendix B. Diagnostics

Every diagnostic has an `EK` code and a message that says how to fix it (VIP-34). Each VIP's rules take one hundred-block, `EK` then the two-digit VIP number then two digits, so VIP-19's rules are `EK19xx` (decided detail 60). A code assigned before that scheme is kept where its rule is unchanged: `EK2109`, `EK2111`, `EK2117`, `EK2126`, `EK3001` to `EK3005`, `EK4402`, `EK4609`, `EK4610` and `EK4701`. Codes are unique across the table, so a kept code may sit inside another VIP's block. Each rule's chapter links to its definition. A row whose rule starts "warning" or "lint warning" is a warning; every other code is an error. Only a warning's code may appear in `vibe.severities` (VIP-30, amended): `{ "EK0801": "off" }` is valid, `{ "EK4701": "off" }` is `EK3006`. Whether the Effect language service's own rules (VIP-38), such as floating-Effect, get `EK` codes is Undecided (pending VIP).

| Code | Rule | VIP | Chapter |
| --- | --- | --- | --- |
| `EK0101` | `effect f() { }` or `async f() { }` outside a class or object literal | 1 | [Functions](001-functions.md#effect-functions) |
| `EK0102` | `await`, `for await` or `await using` in effect code | 1 | [Functions](001-functions.md#static-rules) |
| `EK0103` | `await` on an Effect in an `async` function | 1 | [Functions](001-functions.md#static-rules) |
| `EK0104` | `effect` on a getter, setter or constructor | 1 | [Functions](001-functions.md#static-rules) |
| `EK0105` | `effect` and `async` on one function | 1 | [Functions](001-functions.md#static-rules) |
| `EK0106` | an `effect` function whose written return type is not an Effect | 1 | [Functions](001-functions.md#static-rules) |
| `EK0107` | `eval`, `Function`, `arguments`, `var` or `with` in a `.vibe` file | 1, 4 | [Functions](001-functions.md#direct-eval) |
| `EK0301` | `!` beside a union, an intersection, a function type or a conditional type without parentheses | 3 | [Functions](001-functions.md#the-aer-type-shorthand) |
| `EK0401` | a `throw` or a call that may throw in a plain function whose return type is effectful, or a parameter default that may throw in any effectful function | 4 | [Failures](003-failures.md#effectful-callables) |
| `EK0402` | a function that may throw where a function type doesn't admit its thrown type | 4 | [Failures](003-failures.md#assignability) |
| `EK0403` | an unwrapped call, `new` expression or tagged template that may throw, in effect code or a plain `catch` handler | 4 | [Failures](003-failures.md#calls-in-effect-code) |
| `EK0404` | an unwrapped Promise-producing call, `new` expression or `async match` in effect code | 4 | [Failures](003-failures.md#calls-in-effect-code) |
| `EK0405` | a body that throws more than its written `@throws {T}` | 4 | [Failures](003-failures.md#thrown-types) |
| `EK0501` | `try` outside effect code, the top level included | 5 | [Running Effects](002-running.md#try) |
| `EK0502` | `try` on a value that is not an Effect | 5 | [Running Effects](002-running.md#try) |
| `EK0503` | a `try` statement in effect code | 5 | [Running Effects](002-running.md#try) |
| `EK0504` | `catch` outside effect code | 5 | [Running Effects](002-running.md#catch) |
| `EK0505` | `try x catch h` | 5 | [Running Effects](002-running.md#catch) |
| `EK0506` | `e catch h` where `e` is not an Effect | 5 | [Running Effects](002-running.md#catch) |
| `EK0507` | a handler whose result is a Promise or thenable | 5 | [Running Effects](002-running.md#catch) |
| `EK0508` | lint warning: a plain handler whose result is an Effect; use `catch effect` | 5, 38 | [Running Effects](002-running.md#catch) |
| `EK0801` | warning: `using` in effect code; use `acquireDisposable` inside `scoped` | 8 | [Runtime](008-runtime.md) |
| `EK0901` | a `static key` without `readonly`, or whose initializer is not a string literal | 9 | [Services](005-services.md#static-rules) |
| `EK0902` | a service member that is not a `PropertySignature`, `MethodSignature`, `KeyMember` or `DefaultMember` | 9 | [Services](005-services.md#static-rules) |
| `EK0903` | a service with no derived key and no `static readonly key` | 9 | [Services](005-services.md#static-rules) |
| `EK1201` | `provide` outside effect code | 12 | [Services](005-services.md#provide-blocks) |
| `EK1301` | a constructor in an `error` or `schema error` body | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1302` | a user-written `static` member or setter in an `error` or `schema error` body | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1303` | type parameters on an `error` or `schema error` declaration | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1304` | any other `RejectedElement` in an `error` or `schema error` body; an `implements` clause | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1401` | a namespace name that two subpaths export, or a subpath and the root | 14 | [Services](005-services.md#the-platform-standard-library) |
| `EK1701` | `fork` or `join` outside effect code | 17 | [Running Effects](002-running.md#fork-and-join) |
| `EK1801` | a `try.all` operand that is not an array of Effects | 18 | [Running Effects](002-running.md#running-effects-concurrently) |
| `EK1901` | a `for concurrent` operand that is not an `Iterable` | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1902` | `for concurrent` outside effect code | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1903` | `break` leaving a `for concurrent` body | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1904` | `return` in a `for concurrent` body | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1905` | a labeled `continue` naming a statement that encloses the `for concurrent` | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK2001` | `for try` outside effect code | 20 | [Running Effects](002-running.md#for-try) |
| `EK2002` | `return` in a `for try` body | 20 | [Running Effects](002-running.md#for-try) |
| `EK2003` | a labeled `break` or `continue` from a `for try` body to the `for try` statement itself or a statement outside its body; remove a self-targeting jump’s label | 20 | [Running Effects](002-running.md#for-try) |
| `EK2004` | a `for try` operand that is not a `Stream` | 20 | [Running Effects](002-running.md#for-try) |
| `EK2101` | `return value` in a producer | 21 | [Running Effects](002-running.md#producers) |
| `EK2102` | a producer whose written return type is not a `Stream` | 21 | [Running Effects](002-running.md#producers) |
| `EK2103` | `yield*` in a producer | 21 | [Running Effects](002-running.md#producers) |
| `EK2109` | a `schema` field type outside the mapping | 15 | [Data](006-data.md#schema-declarations) |
| `EK2111` | `restore` outside an `uninterruptible` block | 22 | [Running Effects](002-running.md#interruption-blocks) |
| `EK2117` | an `extends` clause or a `_tag` member in an `error` or `schema error` body | 13 | [Failures](003-failures.md#error-declarations) |
| `EK2126` | a constraint on a generic `data` type parameter | 28 | [Data](006-data.md#generic-unions) |
| `EK2201` | an interruption block outside effect code | 22 | [Running Effects](002-running.md#interruption-blocks) |
| `EK2202` | `restore` in an `effect` arrow or block nested in an `uninterruptible` block | 22 | [Running Effects](002-running.md#interruption-blocks) |
| `EK2801` | a `data` declaration with more than 4 type parameters | 28 | [Data](006-data.md#generic-unions) |
| `EK2803` | a default on a generic `data` type parameter | 28 | [Data](006-data.md#generic-unions) |
| `EK3001` | two services with the same key | 9 | [Services](005-services.md#static-rules) |
| `EK3002` | a class extends a service | 9 | [Services](005-services.md#static-rules) |
| `EK3003` | `new` on a service | 9 | [Services](005-services.md#static-rules) |
| `EK3004` | `instanceof` a service | 9 | [Services](005-services.md#static-rules) |
| `EK3005` | a generic service | 9 | [Services](005-services.md#static-rules) |
| `EK3006` | an error code or an unknown code in `vibe.severities`; remove the entry | 30 | [Configuration and tooling](007-tooling.md) |
| `EK4402` | a value import of a Node builtin, with or without `node:` (`node:fs`, `fs`), or a reference to a banned platform global, in a `.vibe` file | 33 | [Services](005-services.md#the-platform-standard-library) |
| `EK4609` | lint warning: `await` on a `Fiber` in an `async` function; use `join` | 5 | [Running Effects](002-running.md#await) |
| `EK4610` | lint warning: `await` on a `Deferred` in an `async` function; use `try Deferred.await(d)` | 5 | [Running Effects](002-running.md#await) |
| `EK4701` | a `match` with no `default` over a finite union that misses a case; a guarded arm covers nothing | 7 | [Pattern matching](004-match.md#exhaustiveness) |

The compiler's current registry (`typescript/tsc/internal/vibelang/diagnostics.go`) still carries the old language's codes, documented in `docs/design/history/src/428-part4-ch28-tooling.md`. It is not normative.

## Appendix C. Denied and open VIPs

### Denied VIPs

A denied VIP is not part of the language. Each records what was proposed and why it was denied.

| VIP | Denied | Instead |
| --- | --- | --- |
| [8](../vips/0008-using-denied.md) | special syntax for Effect resources (`using` with Effect meaning, a `scoped` keyword) | `using` is TypeScript's; Effect resources use `scoped(effect { … })` |
| [10](../vips/0010-service-call-shorthand-denied.md) | the `Users.find(id)` shorthand | `try (try Users).find(id)` |
| [11](../vips/0011-trailing-blocks-denied.md) | trailing blocks, `f(x) { … }` | `f(x, () => { … })` or `f(x, effect { … })` |
| [24](../vips/0024-wire-denied.md) | `wire`, automatic layer composition | Effect's `Layer.provide` and `Layer.provideMerge` |
| [25](../vips/0025-inline-modules-denied.md) | inline `module` declarations as a TypeScript escape | a `.ts` file |

### Open VIPs

Listed for a future decision; not part of the language.

| VIP | Title |
| --- | --- |
| [35](../vips/0035-handlers-open.md) | Effect handlers (`control`, `handle`, `resume`, `abandon`) |
| [36](../vips/0036-manifest-open.md) | The declaration manifest |
| [37](../vips/0037-effectify-the-universe-open.md) | Effectify the universe |

The proposals page lists further ideas, each to get its own VIP: durable execution, compile-time evaluation, build-time host selection, validators derived from types, typed asset imports, custom loaders, Rust and Zig source imports, a coding-agent library, typed workers, shared structs, declarations in conditionals, toolchain commands, bundler plugins, mandatory compiler options, JSX source files and a TC39 adopt-early list.

## Appendix D. Flipping pending examples

Every VibeLang example in this specification starts with `// compiler-gap: pending VIP-N`, and every Effect TypeScript example that names functions it doesn't declare starts with `// fragment`. The snippet checker reports a `compiler-gap` block as a known gap, not a failure.

To check the specification's examples:

```sh
bun docs/tools/check-snippets.ts --root docs/design/src
```

When the compiler implements VIP-N:

1. Run the command above. A block whose marker is stale fails with "Stale compiler-gap marker; remove it": the compiler now accepts it.
2. Delete that block's `// compiler-gap: pending VIP-N` line. If the block only names functions it doesn't declare (`fetchUser`), declare them in the block or a page fixture, or mark it `// fragment`.
3. When a page has no `compiler-gap` markers left, add `docs/design/src` to the snippet step of the merge queue's gate (`//:snippets`), so the examples stay checked.
4. To make an Effect TypeScript example checked, replace `// fragment` with the declarations it needs; the checker compiles ```` ```ts effect ```` blocks as comparisons.

## Appendix E. Shipped `@throws` and `@rethrows` annotations

These are the annotations [Thrown types](003-failures.md#thrown-types) refers to. VibeLang ships them for JavaScript's globals and for Effect's non-effectful exports, plus the thunk annotations of VIP-4's two wrappers. Every other callback parameter of an Effect function, `LazyArg` included, is a function type with no `@throws`, so it admits only non-throwing functions: `sync(() => parse(s))` is an error; use `Effect.try`.

| Function | Annotation |
| --- | --- |
| `JSON.parse` | `@throws {SyntaxError}` |
| `Math.max`, `Date.now`, `Option.some` | `@throws {never}` |
| `Schema.decodeUnknownSync`, `Schema.decodeSync` | `@throws {never}`: they only build a decoder |
| the constructors of `Data.TaggedError` and `Data.taggedEnum` variants: `new NotFound({ id })`, `Delivery.Sent({ … })` | `@throws {never}` |
| the constructor of `Schema.TaggedError`: `new Invalid({ … })` for a `schema error` | `@throws {never}`, as for `error` and `data`: a bad field at construction throws a plain `Error`, a defect: `effect { throw new Invalid({ name: "" }) }` dies |
| the decoder that `Schema.decodeUnknownSync(schema)` or `Schema.decodeSync(schema)` returns | `@throws {SchemaError}` |
| the thunk of `Effect.try` and `tryPromise`, in either form: the function argument, or the `try` property of the options argument | `@throws {unknown}`: the wrapper makes a throw a failure. The options form's `catch` callback has no `@throws`. `promise`'s thunk has no `@throws`, so it admits only a thunk that throws `never` |
| `Array.prototype.map`, `.forEach`, `.filter`, `.reduce`, `.find`, `.some`, `.every`, `.sort`, and `Array.from` | `@rethrows` the callback |
| `new Promise(executor)` | `@throws {never}`, no `@rethrows`: a throw in the executor rejects the Promise, as in JavaScript; it never throws at the construction site |
| the `executor` parameter's call signature | `@throws {unknown}`: it admits a throwing executor, whose throw becomes the rejection, not part of the constructor's thrown type |

In a `.ts` file, `setTimeout` does not rethrow, because it stores the callback; in a `.vibe` file it is a banned platform global ([Services](005-services.md#the-platform-standard-library)). Effect's `map`, `forEach`, `filter` and `reduce` are effectful: they never throw synchronously, and their callbacks have no `@throws`. A library declares the same tags in its own declarations:

```ts
/** @throws {never} @rethrows f */
export declare function each<T>(xs: readonly T[], f: (x: T) => void): void
```

Apply the three-step procedure in [Thrown types](003-failures.md#thrown-types) to these shipped signature contracts. It composes own throws with `@rethrows` and preserves the effectful exemption (decided detail 66).

```vibe es
// compiler-gap: pending VIP-4
/** @throws {never} @rethrows f */
function each<T>(xs: readonly T[], f: (x: T) => void): void {
  xs.forEach(f)
}

effect function direct() {
  each([1], () => { throw "callback" }) // EK0403: wrap the call
}

effect function wrapped() {
  return try Effect.try({
    try: () => each([1], () => { throw "callback" }),
    catch: (e) => e
  })
}
```

The same contracts apply when `each` is imported through the declaration above. Its ordinary JavaScript call throws; `Effect.try` turns that throw into a typed failure:

```ts effect
import { Effect } from "effect"

/** @throws {never} @rethrows f */
function each<T>(xs: readonly T[], f: (x: T) => void): void {
  xs.forEach(f)
}

function wrapped() {
  return Effect.gen(function* () {
    return yield* Effect.try({
      try: () => each([1], () => { throw "callback" }),
      catch: (e) => e
    })
  })
}
```

```vibe es
// compiler-gap: pending VIP-4
effect function parse(s: string, xs: number[]) {
  const top = Math.max(...xs)                           // throws nothing
  const doubled = xs.map((x) => x * 2)                  // rethrows the arrow, which throws nothing
  const v: unknown = try Effect.try(() => JSON.parse(s)) // may throw SyntaxError: wrapped
  return { top, doubled, v }
}
```

```ts effect
import { Effect } from "effect"

function parse(s: string, xs: number[]) {
  return Effect.gen(function* () {
    const top = Math.max(...xs)
    const doubled = xs.map((x) => x * 2)
    const v: unknown = yield* Effect.try(() => JSON.parse(s))
    return { top, doubled, v }
  })
}
```

A throwing executor is accepted, in a plain function and inside `tryPromise`'s thunk:

```vibe es
// compiler-gap: pending VIP-4
function later(): Promise<never> {
  return new Promise(() => { throw new Error("executor") })  // rejects; throws nothing here
}

effect function run() {
  return try Effect.tryPromise(() => new Promise<number>(() => { throw new Error("executor") }))
}
```

```ts effect
import { Effect } from "effect"

function later(): Promise<never> {
  return new Promise(() => { throw new Error("executor") })
}

function run() {
  return Effect.gen(function* () {
    return yield* Effect.tryPromise(() => new Promise<number>(() => { throw new Error("executor") }))
  })
}
```

The options form gives a typed failure instead of `UnknownError`:

```vibe es
// compiler-gap: pending VIP-4
error BadJson { cause: unknown }

effect function parseJson(s: string) {
  return try Effect.try({ try: () => JSON.parse(s), catch: (e) => new BadJson({ cause: e }) })
}
```

```ts effect
import { Data, Effect } from "effect"

class BadJson extends Data.TaggedError("BadJson")<{ readonly cause: unknown }> {}

function parseJson(s: string) {
  return Effect.gen(function* () {
    return yield* Effect.try({ try: () => JSON.parse(s), catch: (e) => new BadJson({ cause: e }) })
  })
}
```

`Schema.decodeUnknownSync(User)` and `Schema.decodeSync(User)` only build decoders and throw nothing; calling either decoder throws `SchemaError` on invalid input.

Every remaining global and effect 4.1.0 non-Effect export is annotated by a generator, not by hand: `@throws {never}` only when its source has no `throw` reachable from well-typed input, a named class when one is known (`SchemaError`), otherwise `@throws {unknown}`. The generated table is not yet published. `@throws` and `@rethrows` attach to a call signature, as TypeScript attaches JSDoc to each overload, so a returned function's contract sits on its own signature:

```ts
import type { Schema } from "effect"

export declare function decodeUnknownSync<T>(s: Schema.Decoder<T>): {
  /** @throws {Schema.SchemaError} */ (input: unknown): T
}
```
