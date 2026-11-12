# Grammar admission audit

Nothing enters VibeLang through implementation precedent. Accepted VIPs and
their public amendments decide admission; Appendix A states its grammar.

The checked table is
`typescript/tsc/internal/vibelangfuzz/testdata/grammar_admission.tsv`.
`TestGrammarAdmissionInventory` scans every non-test function in
`parser/vibelang.go` and `parser/vibelang_*.go`, including helpers and recovery
paths, every function in a file with a method on `vibelang.lowering` or a
name ending in `_lower.go`, and standalone functions whose names start with
`lower`. This includes support machinery and extracted lowering entry points,
so moving a lowering into its own file does not remove its specification
obligation. The shared error-constructor lowering is recovery under the
error inheritance rejection; its inventory row grants no subclass syntax.

Rows ending in `@<form>` document additional legacy branches inside a function. Base and branch rows may appear in any order;
repeating either row still fails the census.

Each row names its source hook (methods include their receiver type), `admission:<form>` key, authority, status and
reason. Authority is relative to `docs/design/src/`; a fragment names an
Appendix A production, which the test resolves. A shared hook lists each
authority separated by a comma. `admitted` is a syntax entry,
`support` is implementation machinery for the cited construct, and
`recovery` recognizes an invalid form to diagnose it. None authorizes other
branches or type-directed legacy behavior in the same function. Declaration
dispatch with an ambient context remains support for `DeclarationStart`; the
missing-body reporter is recovery for `SchemaDeclaration` and `EK1503`.
Neither helper admits a new form. Effect callable
binding helpers, including `bindSuperMethod`, cite the existing
[bindings rule](../design/src/001-functions.md#bindings); they introduce no syntax.

Method decorator lowering is `admission:effect-method` support under
`EffectMethod` and the class evaluation rules in
[Running Effects](../design/src/002-running.md). Decorators run where their
class is defined and retain that enclosing Effect context; this support row
introduces no additional syntax.

Shared `schema` and `data` field parsing is `admission:schema-data-fields`
support under `SchemaDeclaration` and `DataDeclaration`. Their field lists
use the existing `Field` and `Separator` productions; the shared parser
retains each declaration's separator diagnostic and introduces no syntax.
The `schema` separator reporter is `recovery` for the `EK1504` rejection,
just as the `data` separator reporter is `recovery` for `EK1605`.

A `-` authority and `pending` status mean that no accepted authority was
found. Those rows record audit debt, including denied and open proposals;
they grant no permission to accept the form and request no compiler change.
A grammatical operand can still violate a VIP's type or semantic rule:
`join [a, b]` and `Port()` need semantic review even though arrays and ordinary
calls are TypeScript grammar. The inventory and the grammar oracle serve
different checks.

Run the standard-library census from `typescript/tsc/`:

```sh
go test -count=1 -p 8 -run '^TestTableAccountsForEveryHook$' ./internal/vibelangfuzz/grammaradmission/
```

The developer build, `sh scripts/build-vibelang.sh` from the repository root, runs this census before generating or replacing compiler artifacts. Missing registrations fail the build with the hook's identity; the check runs on the host even for a cross-compiled compiler.

The full fuzz package retains its inventory assertion too:

```sh
go test -count=1 -run '^TestGrammarAdmissionInventory$' ./internal/vibelangfuzz
```

The fast specification gate runs the census. Add a row when adding a hook,
remove it when deleting the hook, and cite the authority that admits the
actual form. Do not cite a denied or open VIP as admission.


`FuzzGrammarAdmission` checks the reverse implication with the compiler parser:
if it produces no syntax rejection (regardless of type or name errors),
the program must have an Appendix A derivation. Only a missing derivation
triggers a full compilation; native syntax diagnostics and Appendix A
placement, handler and declaration recovery count as syntax rejection only
when their diagnostic is an error. Native empty declaration lists and modifier placement, order and
duplication errors reported by TypeScript's checker are grammar rejection
too, as are its module-element context errors (an `import`, `export` or
`export =` inside a block, such as `TS1231`) and a binding pattern with no
initializer (`const { p = 1 };`, `TS1182`, which ECMAScript's grammar does
not derive) and an initializer in an object literal (`const x = { p = 1 };`,
`TS1312`, ECMAScript's `CoverInitializedName` early error); native type, name and module
resolution errors remain non-syntax errors. `EK2301`, a topic `%` outside
every pipe body, is the early error of VIP-23's TC39 topic grammar and counts
as syntax rejection. Warnings
and suggestions do not.
Operand and name/type errors do not.

Modifiers on an export declaration (`export export {};`, `TS1193`) are
another native grammar rejection. The compiler already rejects this form;
the admission classifier recognizes its existing error. Warnings,
suggestions, messages and diagnostics from another source with the same
number remain non-rejections; ordinary exports with name or module-resolution
errors retain their TypeScript derivation.

`EK2109` is a schema type/value error, including a missing Schema value or
incompatible decoded-key flags. It does not reject syntax: a schema field
with an unadmitted `effect` modifier used to remain an admission mismatch
when its type also reported `EK2109`. The compiler now reports `EK0108` for
that field beside `EK2109`, so the keyed unsupported-field witness is an
ordinary regression seed; ordinary, optional and readonly fields with
unsupported types remain grammar-derived controls.

Schema types with a leading JSDoc `?`, `??`, `!` or `*` are a separate
`admission:schema-jsdoc-field-type` gap. The native parser recovers a
JSDoc type, which the schema mapping replaces before the native
source-type diagnostic runs, so only `EK2109` remained. The compiler now
reads the written type back and reports TypeScript's `TS17020`, `TS17019`
or `TS8020` beside `EK2109` in a schema body, in a schema alias and in a
schema error's field, so the family is no longer pending and its witnesses
are regression inputs. Native schema-error methods and computed property
names stay outside the mapped-type family.
A tuple containing the same prefix remains a native rejection control.
Ordinary nullable unions and expression coalescing retain their own grammar.
Syntax-only legacy recovery also counts as rejection; this grants no authority to the corresponding form. The grammar lab models a
bounded TypeScript subset, so an unrecognized program is triaged as either
compiler admission or lab/spec coverage before it is made pending. The
subset keeps ECMAScript's `ExpressionStatement` lookahead exactly, including
`async [no LineTerminator here] function`; Appendix A's contextual keywords are
same-line, so `effect` before a line break is an identifier statement.
A line break after an unfinished expression does not create a declaration
position: `const b =\nschema is 1 + 1` uses the identifier `schema`.
Such a witness retains the existing `is` precedence key instead of a
missing-schema-body key. Actual `schema` and `error` declaration positions keep
their separate classifications.
The keyword table's member-position alternatives apply only in member
positions: `effect[a]` is an element access, though `[` follows `effect` on an
`interface` member.
Type-directed meaning such as aggregate `join` is outside this syntax oracle.
Saved interruption-block witnesses outside Effect code are rejection controls
for `EK2201`; their former pending entries are removed after XPASS.
Unannotated synchronous generator declarations and expressions remain a separate
`admission:interruption-in-generator` gap: the compiler still treats them as
implicit producers. Their interruption blocks have no Appendix A derivation,
even when a producer return diagnostic such as `EK2128` rejects the program.
The precise pending family excludes annotated native iterators, async generators,
generator methods and nested plain callables. Explicit `effect` generators and
blocks remain separate controls. A keyed corpus retains this remaining gap
without restoring the retired general outside-Effect exemption.
The outside-Effect prefix family includes `join {}`, which has no native
call or element-access reading; `join(p)`, `join[0]` and an identifier before
a line break and block remain separate native controls.

Seeds use `key:<form>\n<program>`; corpus files retain those keys. Byte inputs
also mutate valid and legacy programs by inserting, deleting, replacing or
duplicating tokens and moving line boundaries. Each unclassified mutation
gets a separate key. Exact keyed witnesses replay their registered program. A mutation
of that text drives the named seed's bounded token generator; it cannot bypass
the subset by injecting arbitrary JavaScript source. Known gaps use `Gap` and
`testdata/pending/grammar-admission.txt`; passing pending witnesses fail as
`XPASS`, requiring their pending entries to be removed with the fix.

Every Appendix A production has a valid seed, so mutation reaches `match`, `is`,
`do`, declarations, loops, `provide` and `A!E!R`. The lab reads the pinned
do-expression and pattern-matching drafts' productions and maps each prose
production to a subset rule; a test fails when a reworded production becomes an
opaque terminal. The inherited TypeScript subset includes `for await (… of …)`, with native
binding, destructuring and assignment heads and line breaks between `for`,
`await` and `(`. Its negative controls exclude `in`, a three-clause head,
a binding initializer and a missing iterable. A `for await` outside an async function or module reports native `TS1103`,
which counts as grammar rejection even when the checker reaches it before
a malformed head. Warnings and foreign diagnostic-source collisions do not. Bounds: no decorators, conditional types or regular
expressions in the subset.

The pipe lab recognizes `|>` as one token and incorporates the pinned
proposal's `%` primary only in the VibeLang grammar. Its recognition models
productions; it does not claim to implement every TC39 early-error predicate.
A derivation alone proves neither type correctness nor valid topic scope.


The lab recognizes attached grammar arguments and carries `[Effect]` through
`EffectModifier` and function bodies. It recognizes the other ECMAScript
parameter names without treating them as source tokens; full `[Yield]`,
`[Await]` and other early-error checks remain outside this bounded lab.
`TestGrammarAdmissionCore` keeps the valid Effect controls in the fast gate.

The legacy bare `fork { return 1; }` body is tracked as
`admission:fork-block`, independently of an object operand or the admitted
`fork effect { return 1; }`. Its statements have no `UnaryExpression`
derivation; the compiler still wraps them in a program. The keyed pending
witness reports that gap without rejecting any compiler form.

The `admission:fiber-binding` neighborhood includes bare Effect-arrow heads,
`effect join => 1`, as well as parenthesized parameters. Both reserve
`fork` and `join` under VIP-17. Plain arrows, ordinary calls and a line break
after `effect` remain native controls. A minimized keyed corpus also keeps
the campaign witness whose bare arrow returns an ordinary function.
The lab carries the modifier's context onto an inline identifier class as
well as onto a nonterminal parameter list. Direct derivation controls reject
both reserved bare heads and parenthesized heads while accepting a bare
`effect p => 1` and native plain arrows.

The bounded inherited TypeScript grammar includes bodyless function
declaration signatures, with an explicit semicolon or semicolon insertion,
and their `async` counterparts. Function expressions still require bodies.
Valid typed overload and implementation controls keep this native syntax
from being mistaken for an undefined VibeLang form. A keyed corpus also
replays the campaign witness with a signature followed by a separate block;
its native return-placement error does not make it an admission bug.

Pending-prefix grouping follows source callable bodies: an enclosing
Effect span does not make a nested plain function, arrow or method Effect
code. Explicit nested Effect callables and blocks restore their own context;
parser-generated in-place arrows for `do` and `match` preserve the source
context. These parser flags choose only the known-gap key. Appendix A
remains the independent derivation oracle. The nested plain-callable `join`
witness stays under `admission:join-outside-effect`, with corpus XPASS coverage.

Reserved binding names inside `or` and `not` patterns now retain their
native syntax diagnostics after lowering. The former
`or-binding-reserved-name` pending entries are retired; the original keyed
corpus and seed continue to check that these names have no derivation.

The lab distinguishes a callable declaration from an expression when reading
`Name`. An Effect declaration or producer binds its name in the enclosing
context, so a top-level declaration may be named `fork` or `join`. Its
parameters still reserve both names. An expression uses its own Effect
context for its name, and a declaration nested directly in Effect code uses
that enclosing Effect context. A nested plain callable resets that context.
Overload names follow the same declaration rule. The former
`fiber-function-name` lab pending entries are retired; their mutation corpus
and the stable `declaration-name-context` witness remain regression inputs.

`EK1702` is a syntax rejection when its source is `EK` and its category is
an error. VIP-17 reserves `fork` and `join` in the applicable identifier
positions, including an Effect function or producer expression name; some
own-name checks run after parser recovery. A warning, suggestion, another
diagnostic source, or an operand type error still grants no syntax rejection.
The `reserved-expression-name` corpus preserves the throw-wrapped campaign
witness, alongside declaration and method-name controls.

A parse warning is not a syntax rejection either. VIP-41's migration policy
makes the punctuator-only comma after a throw expression's operand
(`[throw e, 1]`, `g(throw e, 1)`, `{ a: throw e, b: 1 }`) the warning
`EK1010` until the parenthesizing `vibelang --fix` ships, while Appendix A's
`ThrowExpressionInvalidPunctuator` still excludes the comma. The compiler
accepts those programs, so the oracle now checks them instead of reading the
warning as rejection. The `throw-comma-warning` seed and corpus stay pending
until the comma is an error again; then both XPASS and their pending lines go.
Operator-left `EK1010` violations stay errors and remain syntax rejection.

`EK0108` is a syntax rejection when its source is `EK` and its category is an
error. Appendix A recognizes `effect` in TypeScript's `async` recovery
positions and rejects it with `EK0108` on an `interface` or type literal
member, an `abstract` declaration or an ambient context. A schema field has no
modifier at all, and `schema S { effect id: string }` used to compile with no
diagnostic: the schema body parses through the type-member path, but its
members are not children of a type literal or interface, so the `EK0108` rule
never saw them. The compiler now reads the modifier from the source of each
schema field and reports `EK0108`, in a schema body, in an object type of a
schema alias and in a nested object type. The `schema-effect-field` seeds and
corpus files stay as regression inputs; the pending lines and the inventory
alias row are gone.

The oracle compiles with module `NodeNext`, an ES module. There
TypeScript's checker rejects an export assignment (`export = 1;`) with the
grammar error `TS1203`, which now counts as syntax rejection. It admits an
import assignment, `import x = require("m")` or `import y = N.a`:
TypeScript's `ImportEqualsDeclaration`, which VIP-40 forbids only inside a
module body (`EK4008`). The lab's TypeScript subset now derives it.
Campaign176 found both omissions.

The identifier-specifier path also accepts `import x = require(M)`, although
the inherited TypeScript `ExternalModuleReference` requires a string literal.
VIP-40 adds identifier specifiers to static imports, with no production for
this `require` argument. `EK4006` for an undeclared module is a name error,
so it does not excuse the missing derivation. The exact
`admission:module-require-identifier` family and keyed corpus stay pending;
native string references, ordinary calls, parenthesized recovery and
`import … from M` remain separate controls.

`EK1606` is a syntax rejection when its source is `EK` and its category is
an error: VIP-16's rejection of a malformed `data` variant or a payload
member that is not a `Field`, the data counterpart of a malformed schema
field. The checker reports it, so the parse gate never saw it; campaign183
found `data D { A { x : number` and a line break before `number } ; B }`,
whose second member has no type.

The `throw-comma-warning` key covers a throw in any expression position:
after an operator or an opening punctuator, or after a word that takes an
operand (`return`, `join`, `fork`, `try`, `await`, `typeof`, `void`,
`delete`, `yield`, `in`, `instanceof`, `case`). Campaign189 found
`[join throw e, 1]`, which the first classifier left unkeyed. After `;`,
`{`, `}`, `)`, `]` or any other word, `throw` starts a `ThrowStatement`,
whose comma expression is ordinary.

`EK1505`, VIP-15's rejection of a `schema` body member that is not a
`Field`, counts the same way; campaign192 found `schema C {` followed by
`string }` on the next line. Its declaration-level siblings already reject
syntax before the checker: `EK1501` (`export default schema`) and `EK1502`
(schema type parameters). A bare `schema C` now reports `EK1503`. The former
`admission:schema-no-body` pending entries are retired; the original seed
and keyed corpus remain rejection controls.

TypeScript's `ExternalModuleReference` is `require ( StringLiteral )`. Its
parser reads any expression in the parentheses for recovery, and the
checker rejects a non-literal with `TS1141`, which now counts as syntax
rejection; campaign195 found `import x = require(("m"))`.

The original `admission:fiber-in-generator` witness,
`function* g() { join effect % 1; }`, now retains syntax rejection.
Its pending entries have been removed; the seed, corpus and compiler-backed
regression remain active. The inventory alias records the rejection boundary.
The classifier retains its precise historical grouping without granting
admission to a plain native generator.


The inherited subset includes native dynamic `import(specifier)` and its
optional options argument. Its `ImportCall` production permits trailing
commas and subsequent property/call chains, while excluding zero arguments,
spread, a third argument and construction with `new`. The keyed
`native-dynamic-import` witness retains an identifier argument: a type or
name error does not remove the native syntax derivation.

Native dynamic imports with zero or more than two arguments report
`TS1450` as a message. Stock TypeScript exits with status `2`, but
VibeLang's `Diagnostic.AffectsBuild` ignores that native message.
The exact `admission:dynamic-import-arity` family therefore stays pending.
Error-category `TS1325` (spread) and `TS1326` (type arguments) reject
syntax. Warning, message and foreign-source collisions do not. Ordinary
call arity and import-specifier type errors remain outside syntax rejection.

Native `MetaProperty` syntax includes `import.meta` and `new.target`.
The lab derives them and their property-access continuations. Bad native
meta-property names report `TS17012`, or `TS18061` when the misspelled
import property is a callee (`import.require(x)`, the TypeScript 5.9 message
that names `import.defer` and `import.source`), and native target placement
reports `TS17013`; error-category diagnostics reject syntax. An uncalled
`import.defer` or `import.source` gets the checker's `'(' expected`
(`TS1005`), which already counts.
VibeLang's platform check instead covers `import.x` before its native
grammar check, leaving only `EK4402`. That exact bad-name/incomplete-phase
family remains pending under `admission:import-meta-property`. Ordinary
member names and native URL-whitelist recovery remain separate controls.
Phase-import calls remain outside the generated subset.

An `async` modifier on a schema field is also outside Appendix A's
`Field` production. An unresolved schema reference reports `EK2109`
and used to cover its whole declaration, hiding the native modifier
diagnostic. The cover now hides TypeScript's type errors only, so the
modifier's `TS1070` stays beside `EK2109`, as it does for a primitive field
type, and the `admission:schema-async-field` family is no longer pending; its
seeds stay as regression inputs, with ordinary fields named `async`,
computed expressions, native members and schema-error methods as controls.

The same mapped-type gap included JSDoc's postfix `?`, as in
`schema C { id: string? }`. Its keyed corpus uses
`admission:schema-jsdoc-field-type` rather than a second exemption.
Native optional tuple elements, optional property names and conditional
types remain separate from this suffix recovery.

The inherited tuple subset derives optional, labeled and rest elements, including
a trailing comma. These are positive controls in both native and VibeLang
grammars; a postfix nullable schema type is still a separate pending gap.

Reserved words used as identifier module specifiers, such as `import static;`,
remain pending as `admission:module-specifier-keyword`. The parser replaces the
written identifier with a synthetic string before native identifier checking.
`EK4006` still denotes a missing module name; a valid identifier with no matching
module declaration is a grammar-derived control. Quoted specifiers and native
import bindings retain their separate grammar.
Stock TypeScript reports `TS2304` for `export {}; static;`, while Node's
module syntax checker rejects that reference as a strict reserved word. The
finding records the Appendix A mismatch together with this native recovery
behavior; converting the specifier to a string alone does not explain it.

The lab derives native named and star re-exports, including type-only forms.
VIP-40 extends their module specifier to an identifier; the native TypeScript
grammar retains a string specifier. A reserved name recovered inside `require`
keeps the separate nonliteral `ExternalModuleReference` pending family. That key
requires a single identifier argument; recovered members, calls and extra
arguments stay outside the family.

A native import-call lookahead can recover the keyword in `import < value`
as a comparison operand without a syntax error. That shape stays pending as
`admission:import-relational-recovery`. The key follows a bare import-keyword
node directly inside a binary expression. Ordinary dynamic imports, import
meta-properties, property names and import types remain separate controls.


The `is-operand-precedence` pending family also covers a tighter arithmetic
operator after a signed or relational pattern, such as `x is > -1 + 1`.
The pattern's leading relational operator and unary sign are consumed before
looking for arithmetic after the complete `is` test. A later relational, bitwise or
logical continuation ends that scan; `x is > -1`, `x is > 1 < 2 + 3` and
`(x is > 1) + 1` remain separate valid controls. The keyed
`is-relational-operand-precedence` corpus retains the accepted invalid form.


The inherited expression subset includes bitwise AND (`&`), XOR (`^`) and
OR (`|`) at their TypeScript precedence levels. Equality binds above them;
logical operators and nullish coalescing bind below them. The `is` test remains
a relational expression, so `x is > 1 & 2 + 3` has a grammar derivation and
stays outside the pending tighter-arithmetic family. Native and `is` bitwise
seeds have keyed corpus controls and no pending exemption.


An unsupported `import.meta` value in a static import or export specifier
remains `admission:import-meta-specifier`. VIP-40 admits a string or identifier
reference there. A platform diagnostic covering that complete specifier also
covers TypeScript's independent `TS1141` grammar error. The pending key follows
that AST edge, with exact keyed witnesses and future XPASS detection. Ordinary
metadata expressions, dynamic imports and `import.meta.url` reads remain
separate controls; `EK4402` remains a platform error, not syntax rejection.


The `schema-async-field` family includes a leading or interleaved
`static` modifier before the written field name and type, including repeated
`async` modifiers; all of them now report `TS1070`. A field named `async`, a
static method and a schema-error member remain separate controls. The
classifier still requires an actual `async` modifier; a static property
alone does not enter this family.


A static schema field without an `async` modifier has its own
`admission:schema-static-field` key. `SchemaDeclaration` contains only
`Field` members, whose sole admitted modifier is `readonly`. An unresolved
field type used to cover the independent static-modifier rejection with
`EK2109`; the modifier's `TS1070` now stays, in named bodies and in
object-type aliases, so the key is no longer pending and its witnesses are
regression inputs. Fields named `static`, static methods, schema-error bodies
and async-modified fields remain controls or their existing families.

The concurrent array-operation inventory includes `coverTryOperationOperand`
under `TryAll`. That diagnostic helper preserves native errors inside a
rejected operand while covering its outer mismatch; it adds no syntax.
The source census and row-order fuzz property enforce its coverage.

The repaired `join` for-of head retains native `TS2487` beside operand
diagnostics, as the corresponding `await` head does in TypeScript. Both
same-line and multiline witnesses remain nonpending corpus controls.
Their old `admission:join-for-head` pending entries are removed after XPASS;
the inventory marks the path as recovery rather than language admission.

Type-only local export clauses (`export type { Value };`) and trailing
commas in named export clauses belong to the inherited TypeScript grammar.
The lab derives them in both native and VibeLang modes, alongside ordinary
exports and string or identifier module re-exports. A trailing comma requires
a preceding specifier; `export {,};` has no derivation. These native forms
need no pending exemption.

Native export specifiers use `ModuleExportName` on both sides of `as`,
including keyword and string-literal names. The lab models them separately
from import specifiers, whose local names remain binding identifiers.
A keyword-only export such as `export { try };` may have an unresolved-name
error (`TS2304`); that does not remove its native grammar derivation.

The expression branch of a native default export admits an object literal:
`export default { value: 1 };`. Its lookahead excludes declaration heads,
not the opening brace of an object expression. The lab derives object-valued
defaults alongside grouped objects, arrays and arrow expressions, retaining
ordinary malformed-property checks.

Default function and class exports also retain their native declaration
boundary, including anonymous declarations and a following statement on
the same line. Their dedicated default-export branches have no expression
statement terminator; ordinary default expressions keep theirs.

The `admission:schema-static-field` key includes a line break
after `static`, as native class modifiers allow. The modifier scan keeps
`async` and `readonly` line restrictions and separates a field named
`static`, methods and schema-error members. The exact multiline witness is
a corpus case that now reports `TS1070`.

Native structural modifier rejection also includes an export assignment
with modifiers (`export export default {};`, `TS1120`) and a modified
import declaration (`export import value from "pkg";`, `TS1191`).
Only native errors count; source collisions and other diagnostic categories
retain their existing classification. These already rejected forms remain
nonpending corpus controls.

The inherited import grammar includes type-only default and namespace
imports, mixed default/named or default/namespace bindings, inline type-only
aliases and string-literal imported names with a local alias.
Local names stay `BindingIdentifier` positions, and a type-only clause
does not combine default and named/namespace bindings.

The pinned matching grammar's computed member access has no line restriction
and requires an `Expression` inside `[ ]`. The parser used to split
`value is Matcher` followed by a new-line empty or elided array into two
statements, reporting only semantic errors. It now continues the member
access through the line break, preserving the native syntax error for
empty, elided, spread or trailing-comma access expressions.
The `admission:pattern-member-line-break` family is no longer pending.
Explicit semicolons, extractor tails, array patterns and valid computed
members remain separate controls. `EK0702` remains a class-pattern type error.

Combined patterns retain the same computed-member continuation: `and`,
`or` and `not` can end with a member followed by a new-line access.
The keyed classifier recognizes both the formerly split parse and the
continued access, keeping existing corpus stable. Commented line breaks
and trailing commas have separate keyed witnesses.

A bare `async` identifier in a native `for … of` head already reports `TS1106`. The oracle counts that native error as syntax rejection, while preserving warning, suggestion, message and diagnostic-source boundaries. A declaration named `async`, a property target and a native `for … in` head remain separate deriving controls.

The inherited `for await … of` head has its own production. Unlike an ordinary `for … of` head, it permits a bare assignment target named `async`. Both forms keep their declaration and destructuring heads, while the bare `let` exclusion and malformed iterable/head controls remain in place.

The module-level ordinary `for (async of xs)` head remains pending as `admission:for-of-async-module`. Stock TypeScript reports `TS1106` even in an external module under `NodeNext`. The VibeLang root enables `AwaitContext` for top-level await, also suppressing that unrelated native head check. The classifier follows actual ordinary for-of nodes outside source callables; real async functions, declarations, parenthesized/property targets and for-await heads stay separate.

The lab distinguishes module top level, async bodies and non-async bodies. A bare target named `async` in an ordinary `for … of` head derives inside async functions, arrows, methods and generators. Nested plain callables reset that context; nested async callables restore their own. Module-level ordinary heads retain their native restriction and separate pending compiler gap.

The same context admits TypeScript's `await` `IdentifierReference` in a non-async body or class field initializer: `function f() { return await.target; }` reports only an unresolved name, even in an external module. Bare `await` in object shorthand, a `new` callee or a `typeof` operand follows the same rule. Module top level, async bodies, computed member names in an enclosing async context and static blocks retain the reservation. Property names such as `obj.await` remain ordinary `IdentifierName` positions. Native plain bodies also admit bindings and labels named `await`; module and async reservations remain in place, and a function declaration's own name retains its enclosing context. Keyed ordinary and deep mutations cover the admitted reference forms. Other `Await` and `Yield` early errors remain outside the bounded lab.

Appendix A parses an effect body as `FunctionBody[~Yield, ~Await, +Effect]`, so `await`, `for await` and `await using` have no derivation there. The bounded lab derives `for await` in every body and leaves Await placement to the compiler, as it does for native `TS1103`. The compiler reports `EK0102` at the same check: TypeScript's checker reports `TS1103` and returns before it examines the head, and VibeLang covers that `TS1103` with `EK0102`. A malformed head such as `effect { for await (const of xs) {} }` therefore reports `EK0102` and no `TS1123`, as stock TypeScript reports only `TS1103` for the same head in a plain function. The classifier counts an `EK0102` error as a syntax rejection.

Binding patterns follow ECMAScript's `ObjectBindingPattern` and `ArrayBindingPattern`: elisions such as `[a, , c]`, nested patterns, element initializers, and a final rest element `[...p]` or rest property `{ a, ...rest }`. A rest element that is not last, that has a trailing comma, a property name or an initializer has no derivation. TypeScript parses those for recovery and `checkGrammarBindingElement` rejects them with `TS2462`, `TS1013`, `TS2566` and `TS1186`, which the classifier counts as syntax rejections.

A rest parameter's binding is a `BindingRestElement`: `...p` or a binding pattern such as `...[p]` or `...{ length }`. The lab derives both in functions, arrows, methods, function types and call signatures, schema signatures included. A binding-pattern parameter may carry `?`, as TypeScript's parameter grammar allows; `TS2463` rejects it in an implementation signature as a type check. A rest parameter with `?` or an initializer has no derivation. TypeScript parses both for recovery and its checker rejects them with `TS1047` and `TS1048` (`checkGrammarParameterList`), which the classifier counts as syntax rejections, as it counts `TS1014` for a rest parameter that is not last.

Native `for … of`, `for … in` and `for await … of` heads retain TypeScript assignment-target assertions: `as`, `satisfies` and prefix type assertions. The lab derives those wrappers without admitting an arbitrary arithmetic target. Postfix assertions keep their line restrictions; ordinary bare `async` heads keep the separate context rule.

The inherited arithmetic subset includes division and exponentiation. Division,
multiplication and remainder bind below right-associative exponentiation. A
unary expression on the left of `**` requires grouping, as in `(-2) ** 3`;
`2 ** -3` is admitted. Native and VibeLang derivation controls, keyed mutation
seeds and an operator-neighborhood property retain these boundaries.

Native erased `as` and `satisfies` assertions can follow an `is` test.
The bounded lab retains those continuations, repeated assertions and array
type suffixes across line breaks. They do not extend the pattern member
chain; incomplete assertions and a line break before the assertion operator
remain separate rejection controls. The keyed witness is nonpending.

Optional Effect class members, such as `effect *g?() { yield 1; }`,
follow VIP-1 and VIP-21 native `async` class positions. Appendix A currently
omits `?` in `EffectClassMethod` and `ProducerMethod`, so the oracle records
this specification gap as `admission:effect-optional-class-member` with
pending and corpus XPASS coverage. The inventory cites the accepted rule;
it grants no object-literal exception. The pending key requires that removing
only the header markers restores a derivation, so unrelated body gaps keep
their own keys. Native optional generator and `async`
class methods derive independently; their object-literal twins report
`TS1162` and stay outside that class-only branch.

Parenthesized Effect types retain the existing `admission:effect-type-trailing-bang` gap: `type T = (number!string!);` has no final slot. The classifier tracks bangs separately in each delimiter scope, including nested parentheses, tuple entries, object fields and function returns. It groups this family only when removing those dangling bangs restores a complete Appendix A derivation, so an independent expression or body gap keeps its own key. A keyed corpus preserves the multiline minimized witness and its pending XPASS check.

`admission:effect-type-line-break` also covers a line break before the second `!` in a grouped Effect type, including nested parentheses, tuple and object types and function returns. The classifier keeps delimiter scopes separate and requires removing only those line breaks to restore a complete Appendix A derivation. Valid statement boundaries and independent syntax gaps keep their own meaning. Keyed corpus entries preserve the multiline witness and its pending XPASS checks.

Native regular-expression literals use an independently validated lexical token. Literal boundaries and flags are checked, and Node's `vm.Script` compiles the literal without executing it. `RegularExpressionLiteral` is its own grammar category, so it cannot become a binding or type merely by replacing it with an identifier. The complete tokenized program must still derive from Appendix A, preserving independent gaps. Alternation, groups, classes, escapes and Unicode modes share this lexical path. The `admission:native-regexp-literal` pending entry and its three corpus entries are removed because these witnesses now derive.

Native RegExp flag, pattern and early errors reported by TypeScript's checker
are syntax rejections too, including an unmatched closing parenthesis
(`TS1508`). The classifier recognizes the structural RegExp diagnostics;
target-version availability, type/name errors, non-error categories and
foreign diagnostic sources retain their separate meaning. The original
malformed-literal mutation is a nonpending rejection corpus, with native
TypeScript controls and category/source collision coverage.

The lab connects ordinary `export` declarations to Appendix A's service,
error, schema-error, schema and data productions. This bridge uses only
productions the appendix defines; it adds neither custom default exports
nor syntax to the native TypeScript grammar. Service name/key errors such
as `EK0903` and implicit-any member errors such as `TS7008` remain
non-syntax errors. An untyped property signature and a contextual name
therefore do not turn an admitted export into a grammar gap.

A native generic instantiation can end a statement before a new-line block.
The lab admits `C<T>` followed by a line terminator and `{`, allowing
TypeScript's semicolon insertion to separate the instantiation from that
block. An unfinished relational reading that could scan an object literal
does not suppress the completed statement's boundary. The bounded CFG may
retain both readings; the admission oracle requires a derivation. The line
break is required for this bridge; it does not introduce a
same-line trailing block. Labels and separate expressions in the following
block retain their ordinary syntax.

Interruption keys follow recorded interruption statements. A declaration
named `uninterruptible`, `interruptible` or `restore`, or the same spelling in
a comment or literal, does not introduce such a statement. A schema with
one of those names and a field with an `effect` modifier reports `EK0108`,
as any schema field with that modifier does. The full grammar and diagnostics still
decide whether the source is an admission mismatch; a recorded form selects
only its pending key.

The keyword lab derives the `provide` head from the current
`ProvideStatement` production, replacing only the final `Block` with its
opening `{`. The resulting prefix must derive before a statement-start
`provide` becomes a keyword. Otherwise it remains an identifier, including
as the subject of an `is` expression followed by an erased TypeScript
assertion. Provider expressions, commas, nested object literals and
line-break restrictions keep their original production rules. The probe
disables keyword marking to avoid recursively classifying its own prefix;
the complete program still derives with all prose restrictions.

Mixed `async` and `effect` schema-field modifiers share the existing
`admission:schema-async-field` gap when schema mapping reports only `EK2109`.
The key scanner follows the whole modifier prefix, including duplicates and
`readonly` or `static` prefixes, before checking for a typed field. Methods,
modifier words used as field names and nested native members remain separate
controls. The keyed witness and original token mutation retain this boundary.

`FuzzGrammarAdmission` mutates one seed, so a long campaign rarely reaches a
second gap inside an already mutated program. `FuzzGrammarAdmissionDeep`
stacks two mutations on the seeds and the keyed corpus. Its first sweep found
three kinds of result. Native TypeScript the lab had left out now derives:
class static blocks, instantiation expressions before a line break or the end
of the file, relational `<` after a keyword type or across a line break, and
`CoverInitializedName`. A throw expression before a line break and a token
that can start a statement ends by automatic semicolon insertion, because
`ThrowExpressionInvalidPunctuator` makes that token offending, which is what
the compiler already did. Checker grammar errors TS1091, TS1097, TS1098,
TS1188, TS1189, TS1190 and TS5086 count as syntax rejections. The remaining
programs belonged to known families whose keys were narrower than the family,
and they keep those keys. Two forms are new.
`admission:schema-field-initializer` was a field initializer whose unresolved
type reported only `EK2109` and covered `TS1247`; a typed field now keeps
`TS1247`, and so do the untyped and modifier-prefixed optional alias members
below, so the key is no longer pending.
`admission:throw-assertion-lookahead` is `throw e as T` before a
`ThrowExpressionInvalidPunctuator`, which VIP-41 forbids and the compiler
misses because its lookahead stops at the assertion. `error is` before a line
that can continue an `is` pattern looks like a third form but is a declaration,
because a `DeclarationStart` begins a declaration wherever one can start, so
the lab no longer holds that statement open.

A sweep that stacks up to two mutations on every seed and keyed program found
four more kinds of result. A repeated `readonly` on a schema field is
`admission:schema-duplicate-readonly`: `Field` admits one `readonly`, and an
unresolved field type reported only `EK2109`, which covered `TS1030`. A field
of a schema body or of an object-type alias now keeps `TS1030`, and so do a
method signature and an object type behind a type operator such as
`readonly { … }` or an Effect type, whose source the compiler reads back; the
key is no longer pending. An
object-type alias field written `async async` before a line break is an
untyped field named `async` with an `async` modifier, and joins
`admission:schema-async-field`. The key scanner had read the line after an
unfinished `>`, `>>`, `>>>`, `<<`, `as` or `satisfies` as a declaration
position, so `x >` newline `schema is 1 + 1` now keeps its
`admission:is-operand-precedence` key; a `>` that may close a type argument
list still ends the statement. The checker's index-signature grammar errors
(TS1017 to TS1022, TS1025 and TS1096) count as syntax rejections. Five lab
gaps were TypeScript the lab had left out: a class expression's type
parameters, a class field's definite assignment `!`, an exported import
alias, a type parameter list's trailing comma, and a relational `<` whose right operand starts a type operator,
as in `C < readonly` before a block on the next line. TypeScript parses
expression type arguments speculatively and rewinds a list that does not
close (`tryParseTypeArgumentsInExpression`), but an Earley set keeps that
reading alive, and a token it can scan blocks automatic semicolon insertion
for the reading TypeScript keeps. A sentence with no derivation is read again
without the instantiation alternatives of `MemberExpression`.

The next sweep keyed three more programs into existing families and found one
new form. A `readonly` method signature in a schema object-type alias is
`admission:schema-readonly-method`: TypeScript rejects `readonly` on a method
with TS1024, which the alias's `EK2109` for the method used to cover; the
method now keeps TS1024. An untyped
alias member with `=`, such as `{ id? = Missing }`, is `TS1247`, which it now
keeps too. An angle-bracket assertion and a type
argument list hold an `EffectType` too, so `<A!E!>x` and `f<A!E!>` join
`admission:effect-type-trailing-bang`.
Type-literal `get` and `set` accessor signatures were TypeScript the lab had
left out; TypeScript reads them with no line-break restriction after the
keyword.


The readonly-method family follows the complete modifier prefix, including
`static readonly` and `async readonly`, and accepts literal and computed
property names in its classifier. A member named `readonly` is separate:
`readonly()` carries no modifier. The field-initializer family likewise
recognizes numeric, string and computed names, such as `{ 1? = Missing }`. String-literal initializers that already
produce native parse errors remain rejection controls.
Both families now report their grammar errors beside `EK2109`.

Native accessor diagnostics also reject grammar: getters cannot have value
parameters, setters require one value parameter, accessors have no type
parameters, and setters have no return annotation or optional, rest or
initialized value parameter. These checks already run in TypeScript's
`checkGrammarAccessor`. The oracle counts their error diagnostics while
preserving the category and diagnostic-source boundaries.


An `async` method signature in a schema alias is the separate
`admission:schema-async-method` family. A call or method signature with an
illegal parameter modifier is `admission:schema-signature-parameter-modifier`.
Both formerly reported only `EK2109` for the unsupported member. They
now retain native grammar rejection too: `TS1070` on the member, `TS1090`
on a parameter modifier, `TS2369` on a parameter property and `TS1030` on a
repeated modifier. The parameter-property rejection is structural and counts
as such in the admission oracle. A reserved parameter binding retains
`TS1214` in a module or `TS1213` inside a class, so
`admission:schema-signature-reserved-binding` is no longer pending either.
Mapping an earlier unresolved field also retains `TS1070` on the final
untyped `async` member; it keeps its `admission:schema-async-field` key.

VIP-13's `EK1302` rejects user-written static error members and owns their
recovered native shape diagnostics. The oracle counts that existing error,
including in a `schema error`, rather than recording another pending gap.
Accessor `this` parameters are likewise rejected by TypeScript's
`TS2784`.

The deep campaign also found a `static` method in a schema alias:
`admission:schema-static-method`. The same unsupported-member mapping
covers its native `TS1070`; a method named `static` without a modifier
remains separate.

The alias mapping explains these masked diagnostics.
`parseSchemaAliasDeclaration` maps the written type through
`vibelangSchemaOf` and synthesizes `typeof S.Type` as its companion.
`vibelangSchemaProperties` replaces an unsupported member with a property
whose value is a flagged `Schema.Unknown` placeholder;
`checkSchemaValue` reports `EK2109` for that placeholder. The generated
companion type does not retain the original unsupported member shape.

A reserved binding in a schema-alias signature has its own
`admission:schema-signature-reserved-binding` family. For example,
`schema S = { readonly; (static) }` reports only `EK2109`, while its
TypeScript twin reports `TS1212`. The strict-mode binding words remain
reserved in typed, optional, rest and destructured parameters.
This is separate from a parameter modifier: `(static static)` retains
`admission:schema-signature-parameter-modifier`.
The classifier reads binding positions; property keys, type references
and initializer expressions do not become reserved parameter bindings.
The compiler is unchanged and the known witnesses remain pending.

An `effect` method signature in a schema alias is
`admission:schema-effect-method`. Appendix A rejects an interface or
type-literal member written with that modifier with `EK0108`, and
`type S = { effect id() }` reports it. `schema S = { effect id() }` used to
report only `EK2109` for the unsupported member, which covered that
rejection, as it covered `TS1024` and `TS1070` for the `readonly`, `async`
and `static` method families. The compiler now reads the modifiers of a
method, an accessor and a call or construct signature from the source of the
object type, as it does for fields, and reports `EK0108`, `TS1024` or
`TS1070` beside `EK2109`; the four families are no longer pending and their
witnesses are regression inputs. An untyped `async` property ended by a line
break does not change that. A method named `effect`, an `effect` modifier
ended by a line break and the named-body `EK1505` rejection stay outside the
family. An optional `effect id?()` signature is a method in this family.

A `fork` or `join` that heads a `new` callee or an `extends` clause in
Effect code is `admission:fiber-primary-reference`. Appendix A reserves
both words wherever an `IdentifierReference` could stand under `[+Effect]`,
as `await` is reserved under `[+Await]`. The parser tests for them only
where a unary expression starts, so `effect function f() { return new
join.target; }` reads `join` as an identifier. The compiler then reports
only the old compiler compatibility error `EK4410` for a stored intrinsic and `TS2339` for the member, not the
reservation error `EK1702`. `class extends fork.C {}` in the same body
reports only `TS2339`. A non-null assertion inside the head, as in
`new join.target!`, does not change the reading. The `async function f() { return new await.target;
}` twin reports `TS1109`. A shorthand property `{ join }` already reports
`EK1702`, and `new (join).target` reports `TS1109`, so both stay outside
the family. A nested plain callable resets the context, as do plain code
and a member name such as `new x.join`, and these remain ordinary
identifiers. The compiler is unchanged and the witnesses remain pending.

The `admission:schema-signature-parameter-modifier` family also covers an
`async` parameter modifier and a modifier before a binding pattern or rest
parameter, as TypeScript's `canFollowModifier` reads them.
`schema S = { (async {p}: Missing): Missing }` reports only `EK2109`; its
`type` twin reports `TS1090`. `async` must share the line with what follows,
as TypeScript requires. A parameter named `async`, as in `(async: T)`,
`(async, b)` or `(async?: T)`, is not a modifier. `(static {p})` and
`(public ...p)` were keyed as reserved bindings; they now key as parameter
modifiers. `(static: T)` and `(...static: T[])` remain reserved bindings.
The compiler is unchanged and the witnesses remain pending.

An optional schema-alias member with an initializer keeps
`admission:schema-field-initializer` after a modifier prefix.
`schema S = { readonly 1 ? =\nMissing }` and `readonly id ? = Missing`
report only `EK2109`; the `type` twins report `TS1247`. Without the `?`,
`readonly 1 = Missing` and `readonly id = Missing` already report a
syntax error, and `static [k] = Missing` reports the `static` type-member
rejection. These stay outside the family. The compiler is unchanged and
the witnesses remain pending.

## The compiler cases as admission seeds

`TestGrammarAdmissionCases` reads every program under `typescript/vibelang/cases`
through the admission oracle and reports how many derive from Appendix A, how
many the compiler rejects as syntax, and how many the compiler accepts without a
derivation, each with the token where its last Earley item died. It never fails
on a missing derivation: a valid program that does not derive is either a lab
gap or a pending admission key, and both are tracked elsewhere. The programs
that derive seed `FuzzGrammarAdmissionCases`, so the mutation campaigns start
from real programs as well as from the handwritten forms. A seed is written as
`case:<path>` and the program; a mutated seed keeps its name and drives token
mutations of that case; a seed whose case was renamed or removed replays the
written program.

The first survey read 3,878 files, of which 2,617 derived, 216 were compiler
syntax rejections and 741 had no derivation (535 outside `.fail` directories).
Most of the 535 were ordinary TypeScript the subset did not yet write:
`--`, the compound assignment operators, generic calls and `new`, class
heritage type arguments and `implements`, conditional, constructor, mapped,
query and import types, type predicates, `this` parameters, index signatures,
catch patterns, do-while, `declare` and `abstract` declarations, namespaces,
enums, `infer`, `unique symbol`, negative literal types, default type
parameters, `using` for-of heads, parameter modifier lists and non-ASCII
identifiers. `TestGrammarAdmissionTypeScriptSubset` holds a valid and an
invalid control for each. With them the survey reads 3,849 files (29 are over
6 KB), 3,310 derive and 320 have no derivation.

The relational fallback reading now drops every expression alternative that
reads `TypeArguments`, in `MemberExpression`, `CallExpression` and
`OptionalChain`: a generic call reading `C<readonly {` kept alive across a
line break suppressed the ASI the relational reading needs, exactly as the
instantiation reading did.

What remains without a derivation is informative. The compiler's own cases
write `number!string! {`, `string!Empty! =>` and `User!FetchError! =` about two
dozen times: the trailing-bang form under `admission:effect-type-trailing-bang`,
which VIP-3's EffectType does not define. Eight cases write `mutable` members in
interfaces and type literals (`admission:mutable-default`). Two write
`abstract error Root {}`, which Appendix A's `ErrorStart` does not admit; the
compiler accepts it with the interim `EK1308` warning, and it is now the
pending key `admission:abstract-error`. The rest are lab limits: the lexer
joins `>` with `=` (`Effect<number>={…}`, `type F<A, B>=(…)`), `!!=` and
`\u` escapes in identifiers; decorators are outside the subset; a computed
class-member key holding `try` inside an effect function (`[try k()]() {}`)
does not derive although `ClassElementName` carries the enclosing parameters;
and `effect is (Object)` does not derive where `effect is Object` and
`x is (Object)` do, so the keyword table's reading of `effect` before an is
test with a parenthesized pattern is still wrong.

Two witnesses came from the campaigns. An ordinary campaign found
`effect function f(s, p) { return fork.in(s) p is join }`: a fork owner form
whose operand is `p is join`, where the parser reads `join` as a pattern
identifier and reports only checker errors. The minimal witness is
`effect function f(p) { return p is join }`; it joins
`admission:fiber-primary-reference`, whose classifier now keys an is pattern
head `fork` or `join`. The case-seeded campaign found
`export error Gone extends Error Error ?? { since: number, by: string }` in
its second minute: a bodyless error declaration with a heritage clause ends,
and the compiler starts another expression on the same line. It joins
`admission:error-no-end`, whose classifier now reads past a heritage clause.
The compiler now ends a bodyless error declaration as a statement and reports
`';' expected` at the next token on its line, so that key is no longer pending.

Two of the survey's open items are now read by the lab. TypeScript's parser
reports nothing after a bare `declare` identifier expression, so
`declare x: number` is the expression `declare` and then `x: number` on one
line, with only name and type errors from tsc and from the compiler alike;
`DeclareExpressionStatement` writes that reading, and the subset also has the
ambient `declare module "m" { }` and `declare global { }` forms. The keyword
table's clause "at a statement start, a name other than `as`, `satisfies` or
`is`, then `(` or `<`" was read as bare tokens, which made `effect` a keyword
before `is (`; the reader now takes it as a statement-start position, a name
outside the listed words, then `(` or `<`, so `effect is (Object)` derives
with `effect` as an identifier while `effect run(x) { … }` keeps its keyword
reading.

The `new` callee and heritage witnesses under `admission:fiber-primary-reference`
are now rejected with `EK1702`, and that key is recovery. An is pattern's
head still reads `fork` or `join` as a pattern identifier
(`effect function f(p) { return p is join }`, also as the operand of
`fork.in(s) p is join`), so those witnesses are the pending key
`admission:fiber-pattern-reference`.

A computed member name is evaluated where its class or object literal is
written. The lab parameterized every symbol of a callable production as plain
code, computed names included, although its Await scoping already gave
`PropertyName` and `ClassElementName` the enclosing context; the Effect
parameter now follows the same rule, so `[try k()]() { }` in an effect
function derives while the member's own body stays plain.
`RejectedMember` is "a ClassElement or a TypeScript TypeMember … that parses,
then a static rule rejects it"; the subset's shape for it now includes an index
signature, a construct signature and a definitely assigned field, so the
service cases that write `[name: string]: unknown` or `key!: string` derive and
their rejection is the static rule's.
The lexer reads `\uXXXX` and `\u{…}` escapes as part of an identifier, so the
escaped-identifier cases derive. With these, 3,359 of 3,871 case programs
derive; the lexer's `>` joined with `=`, `!!=`, and decorators remain the
known lab limits, next to the pending admission keys the cases write.

A case-seeded campaign found a duplicated rest marker in a pattern in a
`for` condition: `xs is [let first, ... ...]`. The pinned
`MatchRestElement` has one `...`, optionally followed by a
`MatchPattern`; `MatchPattern` has no ellipsis alternative. The compiler
reports only checker errors when the condition binds a name and the loop
initializer uses `var`; the same pattern in an ordinary binding or a loop
with a `let` initializer receives `EK0707`. The witness remains pending under
`admission:pattern-rest-ellipsis`. The classifier examines recorded
`is` patterns and `match` arm heads; ordinary spread expressions,
comments, strings and regular-expression literals do not acquire that key.

A later campaign put `=>` between the two rest markers and found the same
loss with a different malformed element: `xs is [let first, ... => ...]`.
The parser defers several pattern syntax errors to the checker: a missing
pattern, an element after the rest, a relational pattern that compares with a
call. An `is` pattern that binds names waits behind a placement marker until a
lexical home claims it, and a pattern no home claims is never compiled, so the
placement error (`EK4703`, or `EK0705` in a parameter default or an enum
initializer) is the only diagnostic. The pinned `MatchList` puts its one rest
element last, and a `MatchProperty` colon takes a `MatchPattern`. Directed
probes found the loss in every position that has no home: a `for` head whose
initializer is a `var` or `using` list, a `switch` discriminant or case, a
parameter default, an enum initializer, a computed class member name, a class
heritage, an `export default` operand, a `match` subject and a `catch`
expression head. These witnesses are pending under
`admission:unhomed-pattern-grammar`. The classifier reads the placement marker
the parser wrote, then parses the marked text again as an `if` condition and
keys the witness only when that reading carries a deferred pattern syntax
error, so a well-formed pattern in the same position keeps its ordinary
verdict.

The same probes named type-space declarations `fork` and `join` in effect
code. Appendix A reserves the two words there as `await` is reserved under
`[+Await]`: no `BindingIdentifier` can be either. The compiler reports
`EK1702` for a variable, parameter, function, class or label with either
name, and nothing for a type alias, an interface, an enum or a type
parameter: `effect function f() { type fork = 1 }` compiles with no
diagnostic. Stock TypeScript 5.9.3 rejects each `await` twin in an `async`
function (`TS2457`, `TS2427`, `TS1003`, `TS1139`). These witnesses are pending
under `admission:fiber-type-name`. The form classifier read `enum fork { }` as
a bare `fork` block until now, because `fork` stands before `{` there; it
asks the parser for the declaration first.

The probes also showed six native grammar diagnostics the oracle did not
count as syntax rejection, so a correctly rejected program read as a
mismatch: `TS1101` for a `with` statement in strict code, `TS1035` for a
quoted module name outside an ambient context, `TS2483` for a type annotation
on a `for`...`of` head, `TS1228` for a type predicate outside a return type,
`TS1206` for a decorator where none can stand and `TS1497` for a decorator
expression that needs parentheses. Each now counts, as the other grammar
checks TypeScript runs on a recovered parse do.

The same probes measured the lab's subset against inherited forms the
compiler accepts. Four were one production each and now derive: the bitwise
NOT operator `~`, import attributes (`with { type: "json" }` on an import or
a re-export), a default-exported interface, and a `MetaProperty` at the start
of a member pattern, which the pinned `PatternMatchingMemberExpression`
lists beside `this` (`x is import.meta`). Variance modifiers and template
literal types followed: TypeScript's parser reads `in` and `out` on any type
parameter and its checker rejects them outside a class, interface or type
alias (`TS1274`), so the lab reads them on every type parameter and the
oracle counts the checker's rejection, as it does for a misplaced `const`.
The lab still has no decorators; a program that uses one reads as a mismatch
and is not evidence about the compiler.

A type query's first name followed. TypeScript's parser reads it with
reserved words allowed (`parseTypeQuery` calls `parseEntityName` with
`allowReservedWords`), so `type X = typeof try.Type` is well formed and its
error is the checker's `TS2304`; only `import` can't start the name, because
`typeof import` is an import type that needs `(`. The lab's `TypeQueryName`
took an `IdentifierReference`, so a campaign mutation that replaced a schema
name with `try` read as a mismatch. It now takes any reserved word but
`import` as the first name, and the compiler agrees on every reserved word.
In effect code `fork` and `join` stay outside it: VIP-17 reserves them, and
the compiler's acceptance there is the keyed `admission:fiber-type-name` gap.

A Cases campaign mutation of `await.race [a, b]` into `await.race 1 [a, b]`
showed the retired VIP-18 await operations. `await.race [a, b]` derives as a
member expression indexed by a comma expression, so the oracle never saw the
form; with `1` between them nothing derives, and the compiler reported only
`EK1802`. The parser still reads `await . <operation> <operand>` (the
inventory's `admission:legacy-await` hooks) to report `EK1802` and drive
`--fix`; the form has no production, so `EK1802` now counts as syntax
rejection, as the retired declaration codes `EK0909` and `EK2121` do.

Two more campaign shapes followed. `xs is [let let, ...]` behind a
placement marker: the binder, not the parser, rejects a strict-mode reserved
word as a binding name (`TS1214`, with `TS2480` for `let`), so the homed copy
the `admission:unhomed-pattern-grammar` classifier compiles carries no parser
marker; the classifier now also reads the marked pattern's own tokens for a
`let` or `const` followed by such a word. And `module twice { export export
const b = 2 }` after another `module twice`: alone the body reports `TS1030`,
but a module that redeclares a name reports `EK4005` and its body is never
compiled, so the body's native grammar errors are lost. That compiler gap is
keyed `admission:module-redeclared-body`, with its registry row on
`Parser.parseVibeLangModuleDeclaration`, until the compiler checks the body.

The redeclared-module pending family takes precedence over forms inside its unchecked body. A duplicate module reports only `EK4005`, so a nested plain arrow containing `try`, a malformed arrow or an invalid schema field must retain `admission:module-redeclared-body`. Keyed corpus and regression mutations cover these overlaps; single modules, distinct module names, nested declarations, strings and comments remain controls. The compiler still needs to check the duplicate body's syntax.


An unhomed `is` binding can discard its subject independently of deferred pattern syntax errors. The valid pattern `[let first, ...1]` in a parameter default hides an outside-Effect `join` or `fork` in that subject behind `EK0705`. A recorded fiber prefix inside the generated placement marker keeps the separate `admission:unhomed-pattern-subject` key. Keyed corpus, quoted `[+Effect]` productions, parameter-default and enum mutations, and native-prefix, ordinary-call, homed and inert-text controls preserve that boundary.

A reserved reference inside the same unhomed pattern is also a member of
`admission:unhomed-pattern-grammar`: `function g(a = xs is [let first,
static, 1]) {}` reports only `EK0705`, while an `if` condition exposes the
binder's `TS1214`. The classifier binds its homed copy and reads native
grammar diagnostics, including reserved binding names. Property names,
member names and strings that spell the same word remain controls; they
are not `IdentifierReference` positions.

Class heritage is another inherited TypeScript distinction: `class C extends
f("C")
<{}> {}` permits a line break before the type arguments.
TypeScript's `parseExpressionWithTypeArguments` reads that list without the
line-break guard used by a type reference. Stock TypeScript 5.9.3 accepts
the nine named, called, parenthesized, anonymous and implemented heritage
controls with name-resolution errors only; malformed lists and the
corresponding type reference remain rejections. The lab removes the
extra line-break guard from `ClassHeritage` alone.

A recovered non-null assertion, type assertion or type-argument list around
`import.meta` still cannot be a static module specifier. The native
`TS1141` rejection survives for each wrapper, so their former pending-key
assertions are rejection regressions with exact keyed corpus inputs.

An import type's type arguments followed. TypeScript's parser reads them as a
bracketed list that may be empty or end in a comma, and the checker's
TypeArguments grammar check (`TS1099`, `TS1009`) runs on type references and
expressions only: stock TypeScript 5.9.3 reports `TS2314` alone for
`import("./m").T<>` and nothing for `typeof import("./m")<>` or
`import("./m").T<string,>`. The lab's `ImportType` now takes those lists too;
`Array<>` keeps its `TS1099` and no derivation. Schema aliases whose types
start with a JSDoc prefix, such as `schema S = ?? { static id: Missing }`,
now retain native source-type rejection beside `EK2109`. Aliases combining
that prefix with static or duplicated readonly members and field
initializers remain rejection controls; they require no pending exemption.

Appendix A delegates native types to TypeScript. Its `checkImportType` does
not walk an import type's argument list with `checkSourceElements`, so nested
type references such as `import("./m").T<Array<string,>>` and
`import("./m").T<Missing<>>` receive neither `TS1009` nor `TS1099`. The lab
keeps a separate copy of its type productions under import arguments, with
the empty and trailing-comma alternatives there. Ordinary `Array<>` and
`Array<string,>` remain underived, as do missing list elements and a type
reference's line-break boundary. Generated cases cover parenthesized,
array, tuple, object, function, union and conditional argument types; keyed
fuzz inputs retain the three minimal nested-list witnesses. The scoped copy follows the parenthesized-type partition and applies after a qualifier's dotted argument list too.

One gap the probes found was outside what the lab can show. TypeScript parses
a lexical declaration as a loop body for recovery and rejects it with
`TS1156`, and the lab derives that recovery, so `if (c) const y = 1;` reads
as derived. `for concurrent (const x of xs) const y = 1;` used to compile with
no diagnostic, while `for try` and a native loop kept `TS1156`; Appendix A
gives all three a `Statement` body. A separate test compares the compiler
with itself: a native `for`...`of` sets the expectation for each body, and
both VibeLang loops meet it.

The next case-seeded campaign deleted a type argument in a schema field:
`HashMap<string, >`. TypeScript's type argument list is not empty and takes
no trailing comma; its checker rejects both on a recovered parse (`TS1009`,
`TS1099`), and a type alias, `data`, `error` or `service` member with the
same type reports them. Schema mapping reads the field type first.
`schema S { a: Array<string, > }` compiles with no diagnostic, and a type
the mapping does not know reports `EK2109` alone, as in the other schema
families above. Both list shapes are pending under
`admission:schema-type-argument-list`.

A campaign then broke the line between `try` and a `match` statement in a
plain function. A `TryExpression` has no line-break restriction, so the
`match` on the next line is still the operand. The compiler now reports
`EK0501` for that source, as it does when both words share a line. The
retained campaign corpus runs without a pending entry.

The generated-error migration counterpart continues to test the guarantee
that a foreign plain object with the recognized tag is covered. Its quote
includes the chapter's additional `instanceof` fallback; the existing
shadowed-helper and mismatching-tag fuzz controls keep the tag guarantee
separate from an ordinary custom matcher.

A case-seeded campaign put a `try` inside the callback that
`hatch-promise-shapes` passes to `sync`. VIP-6 replaces the legacy hatches,
so that callback is plain code, where `try` is `EK0501`. The compiler read the
first argument of a call to the prelude's `sync` as TypeScript and skipped
`EK0501` there: with a well-typed operand,
`function f() { return sync(() => try Effect.succeed(1)) }` compiled with no
diagnostic, and the emitted callback returned `Effect.succeed(1)` unrun. The
compiler now reports `EK0501` at that `try`, so the witnesses derive nothing
and are rejected, and the `admission:try-in-hatch` key is retired. Its seeds
and corpus files remain as regressions.

A later case-seeded campaign put a `try` inside the arrow that
`ek0402-own-signature-target` passes to `Effect.try`. VIP-6 says no language
feature wraps TypeScript into an Effect: Effect's own wrappers take ordinary
arrows, so that arrow is plain code too. The compiler read the function that
`Effect.try`, `Effect.tryPromise` or the global `tryPromise` wraps, as a direct
argument or as the `try` property of an options object, as TypeScript
(`isWrappedCode`), skipped `EK0501` there and dropped the `try` from the
emitted callback:
`export effect function main() { const b = try Effect.try(() => try Effect.succeed(1)); return b }`
compiled with no diagnostic. It now reports `EK0501` there too.
`FuzzTryInWrapperCallback` checks every wrapper, callback shape, `try` form
and enclosing code together: one `try` in the wrapped callback gives exactly
one `EK0501`, and the same callback without the `try` gives none.

A later case-seeded campaign reduced a case to the one-word program
`using`. The compiler reports only `TS2304`, as stock TypeScript 5.9.3 does
for `using;`, `using(x);`, `using.x = 1;`, `using = 1;` and `using[0];`.
ECMAScript's `ExpressionStatement` lookahead does not exclude `using`, and
neither does Appendix A's; a `using` declaration needs a `BindingIdentifier`
on the same line. The lab's TypeScript subset had excluded every statement
that starts with `using`. It now keeps only the declaration's line-break
restriction, and the TypeScript-subset test holds these identifier forms.

The next case-seeded campaign joined two `is` statements with `??`, giving
`effect is (Point) && (hits += 1) ?? async is < 5 && (hits += 1)`. ECMAScript's
`CoalesceExpressionHead` is a `CoalesceExpression` or a `BitwiseORExpression`,
so `??` never shares an unparenthesized operand with `&&` or `||`, and
Appendix A inherits that. TypeScript parses the mixture by precedence and its
checker rejects it with the grammar error `TS5076`. The oracle now counts
`TS5076` as a syntax rejection; parenthesized and chained `??` forms still
derive.

The same campaign wrote `data as < > { Value { value: A } }`. Stock
TypeScript 5.9.3 accepts an empty type parameter list on a type alias or
an interface (`type T<> = 1`, `interface I<> {}`) with no diagnostic; its
checker reports `TS1098` only on a function or a class. The lab's
TypeScript subset now admits `<>` on those two declarations and nowhere
else, so `function f<>() {}` and `class C<> {}` still have no derivation and
the compiler still rejects them with `TS1098`.

A data declaration is not one of those two. `DataDeclaration` takes
TypeScript's `TypeParameters`, whose list needs a `TypeParameter`, and a
class, an error or a service with `<>` reports `TS1098`. A data declaration
with `<>` used to compile with no diagnostic: it lowers to a type alias, and
TypeScript leaves an alias's empty list unchecked. The parser now reports
`TS1098` on the data declaration's list itself, with the checker's range, so
`data D<> { Value { value: number } }` is rejected and
`admission:data-empty-type-parameters` is no longer pending.

Another case mutation passed a producer to `Effect.gen` and left an empty
`const` line in its body. A producer given to a native generator API
reports `EK1002`, and that diagnostic covers the whole argument, so the
body's `TS1123` disappears with its type errors. The same body in a plain
`function*`, or in a producer declaration, still reports `TS1123`. The form
is pending under `admission:producer-cover-grammar`, keyed by a producer
written as a call argument.

A later campaign reduced a case to `.00`, which the compiler accepts with no
diagnostic, as stock TypeScript does: ECMAScript's `DecimalLiteral` may start
with `.` before a digit. The lab lexer started numbers only at a digit. It
now reads `.5` as one number, and reads `?.` before a digit as `?`, since
`OptionalChainingPunctuator` excludes a following digit and `x?.5:1` is a
conditional expression.

The next campaign reduced a case to `0>>0`. The lab's TypeScript subset had
no `ShiftExpression`, so `<<`, `>>`, `>>>` and their compound assignments
never derived. It now has ECMAScript's `ShiftExpression` between the
relational and additive levels. The lexer keeps `<` and `>` as single tokens
so type arguments still close as TypeScript rescans them, and the operators
are written as token sequences.

A campaign put `try` before a returned `match` in a plain function. The
compiler now reports `EK0501` in both returned and statement positions,
including across a line break. The saved corpus and quoted oracle remain
active after their pending entries were removed. The regression checks
exactly one `EK0501` per witness and retains the emitted Effect-arm check
when emission is enabled despite the diagnostic.

The next campaign broke a getter across lines: `get` and then `Waiting()` on
the next line. ECMAScript's `MethodDefinition` puts no line-break
restriction after `get` or `set`, and TypeScript's parser accepts the getter
(`canFollowGetOrSetKeyword` has no same-line test), as stock TypeScript 5.9.3
confirms for object literals and classes. The lab had written a
no-line-terminator restriction there; it is gone.

A case-seeded campaign put `join ?? 7` in a service's `defaultValue`
initializer inside an effect function. Appendix A resets the source Effect
context in class field and enum member initializers, and explicitly gives
`DefaultMember` the same rule. The lab now carries that reset, so ordinary
`fork` and `join` identifiers derive there. Computed names retain their
enclosing context, static blocks retain keyword reservation, and a nested
explicit Effect callable or block establishes its own context. The regression
test exercises both names across instance and static fields, enum members and
service defaults, with plain and nested Effect controls.

A case mutation ended a callback return type in `Disposable!E!` immediately before the enclosing parameter list's `)`. The compiler reports only a warning. This joins `admission:effect-type-trailing-bang`: parentheses also contain parameter lists, not only parenthesized aliases. Removing the dangling bang must restore a complete Appendix A derivation, including at a comma or a parameter default, so unrelated gaps and ordinary non-null assertions keep their own classification. Keyed corpus inputs retain the minimized callback program independently of the compiler-case list's order.

The second effect-type bang also retains its no-line-terminator restriction in callback return types and other annotations, not only in type aliases. A callback returning `Disposable!E` followed on the next line by `!1` remains `admission:effect-type-line-break`. Classification removes only the recorded line break and requires a complete Appendix A derivation; ordinary non-null assertions and an independent syntax gap remain controls. Keyed corpus retains the exact callback witness independently of deep-mutation seed ordering.


Deferred pattern syntax errors now survive an unsupported binding home. The placement marker retains the grammar calls until a supported home compiles the pattern, where the holder is replaced so each error appears once. The `admission:pattern-rest-ellipsis` family and the missing-pattern/rest-position witnesses of `admission:unhomed-pattern-grammar` are no longer pending. Strict-mode reserved identifiers still need native binder recovery; bindings and references retain corpus under the narrower `admission:unhomed-pattern-reserved-identifier` key.

The `admission:data-separators` family is no longer pending. `DataDeclaration` permits one separator between variants and one final separator. The parser now reports `EK1606` when a separator stands where a variant name belongs, including leading, repeated and separator-only bodies. Keyed corpus retains these shapes, and valid comma, line-break and trailing separators remain controls.

Surveying the compiler cases through the admission oracle found four inherited TypeScript forms the lab derived nowhere, each admitted by the compiler on the pinned TypeScript base: an escaped IdentifierName after a dot (`try.a\u006ey`, `fork.\u{69}n`, `new.t\u0061rget`, `import.m\u0065ta`), which the lab now matches and predicts by its decoded name only in that position; the phase import calls `import.source(x)` and `import.defer(x)`; an ambient binding pattern with no initializer (`declare const { a }: T;`); and a parenthesized `EffectType` before `=>` in an arrow's return annotation, which TypeScript's function-type lookahead leaves a type because the operand's `!` never starts a parameter list. Keyed seeds and `TestGrammarAdmissionSurveyedForms` keep them derived; `import.other(x)` stays out on both sides.

Running the oracle over every compiler case the lab does not derive (the survey the Cases oracle skips) showed gaps the oracle failed although they were known or rejected: the `mutable` member marker, whose registry key `admission:mutable-default` is pending, now keys such programs (`grammarMutableMemberMarker`), and the placement and retirement rejections EK0503 (a try statement in effect code), EK1003 (`await using` in effect code) and EK4857 (a retired written infer slot) count as syntax-class, as EK0501, EK0102 and TS1338 do.

The same survey showed three lexical gaps: TypeScript rescans the `>` that closes a type argument or parameter list apart from a following `=`, `=>` or `>=` (`Promise<number>= p`, `Set<string>=> f`) and the `=` after an effect type's bang (`number!!= e`), where the lab's lexer joins by longest match, so a program the first read refuses is read again with those tokens split (`grammarRescannedTokens`); a template literal's substitution may hold a nested template, a string or braces, which the lexer now scans as TemplateMiddle and TemplateTail scanning does; and a decimal literal's exponent may carry a sign (`-1e-400` in a pattern).

The survey also found four inherited statement and call forms the subset left out: an `await using` declaration, `using` and `await using` heads of a three-part for statement, a tagged template on a call chain (`tags(t).tag`…``), and an instantiation expression on a call result (`mk()<T>`) ended by a line break or a semicolon, which the subset gave only to member expressions. Each joins the subset; keyed seeds and `TestGrammarAdmissionSurveyedStatements` keep them derived.

Three further forms the survey exposed are the compiler's to parse and nobody's to derive: an explicit `declare error`, `declare schema` or `declare data` (the chapters reject it statically; Appendix A's DeclareDeclaration lists only TypeScript's declarations), a class pattern written as a name followed by an object pattern (`when Address { let street }`), and `when super[key]` (the pinned draft gives `super` only the dotted form). Each now has a classifier key (`admission:ambient-custom-declaration`, `admission:pattern-name-object`, `admission:pattern-super-element`), a pending line and keyed seeds, so the oracle reports rather than fails them; whether the compiler should reject them is decided elsewhere.

An identifier written in NFD, `café` as `cafe` and a combining acute, derived nowhere: the lexer admitted a rune above 127 only as a letter or digit, so the mark became its own token. IdentifierPart's ID_Continue adds marks, digits and connector punctuation, and the grammar adds ZWNJ and ZWJ; the lexer now keeps them inside a word after its first rune.

A Deep campaign on the lab found that a parenthesized type before `=>` in an arrow's return annotation is admitted far beyond effect types. TypeScript decides at the `(` whether `(T) =>` starts a function type: it skips `readonly` and the other modifiers when a name, string, number, `[` or `{` follows on the same line, then takes a lone name (contextual keywords such as `number` and `undefined` included), `this`, or an object or array binding pattern that parses without error, followed by `)` and `=>`. Every other content is a parenthesized type, so `(): (A.B) => e`, `(): (Promise<T>) => e`, `(): (A | B) => e`, `(): (A[]) => e`, `(): ("a") => e`, `(): ({ a?: T }) => e`, `(): ({ a: T; }) => e`, `(): ([T?]) => e`, `(): (readonly T[]) => e` and `(): ((T)) => e` are arrows with a parenthesized return type, while `(): (x) => e`, `(): (number) => e`, `(): (this) => e`, `(): ({ a: T }) => e`, `(): ([T]) => e` and `(): (readonly T) => e` read a function type and then miss the arrow's `=>` (TS1005). The subset writes that decision as a partition of `Type`: `ParameterLikeType` is the function-type start and keeps the `[lookahead ∉ { "=>" }]`; `ArrowSafeType` is every other type and is admitted before `=>`. `ShapedObjectType` and `ShapedTupleType` are the object and tuple types whose text is also an error-free binding pattern (members `name` or `key: target`, elements `target` or `...target`, a target a `BindingIdentifier` or a nested shape, `,` separators), and `UnshapedObjectType` and `UnshapedTupleType` are their complements: a `;` or line-break separator, `?`, `readonly`, a method, call, accessor or index signature, a reserved-word, string, number or computed shorthand, or a target that is not a binding target. The partition holds at every depth, so a parenthesized type at the tail of a function-type return (`(): (x: number) => (A.B) => e`) derives too; the arrow-level `":" "(" Type ")"` alternatives the subset carried for plain and async arrows, which also admitted the function-type starts, are gone, and `EffectType` joins `ArrowSafeType` directly (an effect type always carries `!`) in place of the synthetic `ParenthesizedEffectType`. Two forms the subset still admits before `=>` that TypeScript rejects: a mapped type whose text is a binding pattern (`({ [K in T]: V }) =>`, where the pattern parse reads `K in T` as an expression) and a strict-mode reserved shorthand (`({ let }) =>`, which the lab's `BindingIdentifier` excludes where TypeScript's binding pattern admits it); the compiler rejects both, so neither can be a compiler-accepts-undefined finding. A line break before `=>` is TS1200 and a parenthesized `this is T` is TS1228, both counted as syntax rejections, so the subset's `[no LineTerminator here]` before `=>` and its predicate-free parenthesized type stand.

A stacked mutation reached an import type with a dot immediately before its type arguments, `import("./m").T.<>`. TypeScript's `parseEntityName` consumes that dot and stops before `<`, then `parseImportType` reads the arguments. Stock TypeScript `5.9.3` accepts `import("./m.js").T.<number>` and the empty list with no diagnostics when the module exports `class T<A = number> {}`; the checker reports `TS8020` on an ordinary reference such as `Array.<number>`, but does not run that JSDoc-only syntax check on import types. The inherited subset now derives the dotted type-argument form only after an import type's qualifier. A line break before the dot is allowed; one after the dot prevents the argument list, as in TypeScript. Ordinary references, an absent qualifier, missing names and doubled dots retain their syntax rejection. No compiler behavior changes.

The three surveyed pending forms also have branch rows on their source hooks: the native modifiers passed to declaration dispatch (`admission:ambient-custom-declaration`), the same-line object-pattern branch after a matcher name (`admission:pattern-name-object`), and computed access after a bare `super` head (`admission:pattern-super-element`). Each row keeps `-` authority and `pending` status. The admitted dispatch and pattern helpers keep their own authorities; those authorities do not admit these extra branches. The lightweight census test checks that the source registry and generated table retain all three pending records.

Identifier continuation also needs Unicode's `Other_ID_Continue`, and identifier starts need `Nl` (letter numbers) and `Other_ID_Start` alongside letters. The lab split names such as `a·b`, `℘x` and `Ⅹx` even though stock TypeScript `5.9.3` parses them without a diagnostic. The word scanner now includes those properties. Lexer properties enumerate every rune in the two `Other_ID_*` tables, admitted-program controls cover their stable representative characters and a letter number, and continuation-only characters still cannot start a name. Two keyed seeds and corpus files exercise the existing admission mutation targets. This is inherited lexical coverage, with no compiler or VIP change.

VIP-55 task and workflow declarations now derive in the lab. `TaskDeclaration` and `WorkflowDeclaration` join the statement and export bridges beside the other custom declarations, and `CallMember`'s prose stands for `EffectMethod`, whose `(Block | ";")` alternative already covers a task's bodiless call. The call-name, single-call, static and option-shape rules are static (EK5501): a rejected member shape derives through `RejectedElement` and the compiler's EK5501 is not a syntax rejection, so the oracle agrees on both sides. Seven keyed seeds cover a task with an option and a body, a bodiless task call, a workflow, an exported workflow, the `task` line-break non-declaration and two rejected member shapes.

The compiler case `effect-type-bang-rescan` combines every punctuator chapter 001 rescans after an effect type's completing bang: `A!!= v`, `A!!== v`, `A!!=== v` and `(): A!!=> e`, with `!=` and `!==` after a completed `A!!` left as equality operators. The lab's fallback split only a `!=` directly after `!`, so the lexer's longest-match `!==` stayed one token, `=` and `>` were never rejoined into `=>`, and the split also broke an ordinary `!=` after `A!!`. `grammarRescannedTokens` now splits `!=` and `!==` only after the lone first bang, rejoins the remainder with a following `>` or `=`, and leaves equality operators after a completed `!!` alone. Lexer-level tests cover each shape and the controls, four keyed seeds and two corpus files exercise them, and `TestGrammarAdmissionRescannedCase` keeps the whole case program derived. No compiler acceptance, registry authority or VIP change.

The oracle's callable-kind guess looks only at the tokens before `=>` or a function body, so a typed Effect arrow with a try body (`effect (p: { mutable n: number }): number!! => { return try p.n }`) read as a plain arrow and took the `admission:function-kind` key, which has no pending line. Three compiler cases with inventoried mutable member markers (`held-conditional-initializer`, `plain-structural-bindings.fail`, `rerun-parameter-readonly`) therefore failed the case walk under the wrong key although `admission:mutable-default` is pending. `grammarAdmissionForm` now classifies the precise mutable member marker before the callable-kind guesses; a plain typed arrow or function with a try body and no marker keeps `admission:function-kind`. The classifier test covers four compact forms and both controls, `TestGrammarAdmissionMutableCases` keys the three case programs, and a keyed seed and corpus file exercise the form. No compiler acceptance, pending line, registry authority or VIP change.

A Deep mutation nested the dotted reference inside an import type's arguments: `type X = import("./m").T<Array.<Missing<>,>>;`. TypeScript's `parseEntityName` consumes a dot before `<` wherever a type reference is read, and the `TS8020` that rejects an ordinary `Array.<string>` runs in `checkTypeReferenceNode`, which an import type's arguments never reach: the compiler reports `TS2834` alone for the unresolved module, and stock TypeScript 5.9.3 reports nothing for the form, in parenthesized, array, object-member, parameter and doubly nested positions, when the module exports `type T<A = number> = A`. The lab's scoped copy of the type productions under import arguments now admits `TypeName "." [no LineTerminator here] TypeArguments` in its type reference and arrow-safe primary type, so the dotted reference derives at any depth there, with the empty and trailing-comma lists, after a qualifier's own dotted list, and with a line break before the dot. An ordinary reference, a reference nested outside an import argument, a line break after the dot, a doubled dot and a missing list element keep their rejection and have no derivation. Sixty generated forms, the witness, eight controls, a keyed seed and a corpus file cover the form. No compiler acceptance, pending line, registry authority or VIP change.

A Deep mutation put the second bang of an effect type on the next line fused with an equality operator: `const loose = a as number !` then `!== a`. The compiler's dangling-bang check accepts `!=` and `!==` as the second bang regardless of the line break, but the slot parser then reads the token as the comparison, so the program compiles as a bare `number!` compared with `!==`; Appendix A's `EffectType` has `[no LineTerminator here]` between its bangs, so the form is the recorded `admission:effect-type-line-break` gap in a new token shape. The classifier's adjacent-bang rule looked only for a lone `!` on the next line, so the mutation reported an unkeyed mismatch. The rule now takes a fused `!=` or `!==` on the next line as the second bang. Four keyed sources, three controls (a completed `!!` or no bang before the operator takes no line-break key), a seed and a corpus file cover the shape. No compiler acceptance, pending-key or VIP change.

A Cases mutation prefixed the comma-expression assignment in a `for concurrent` head with `try`: `for concurrent (const x of (try probe = () => x, [1])) {}`. Appendix A's `TryExpression` is `"try" UnaryExpression`, where ECMAScript has `AwaitExpression`, and an assignment's target is a `LeftHandSideExpression`, so the written form has no derivation; the compiler rejects the twin `await p = 1` as syntax (TS1005) but compiles `try p = 1`, `(try p = 1, 2)` and the mutated case with only EK502, because its try operand node passes as an assignment target. The oracle had keyed the case program to the callable-kind guess and the minimal forms to no key. `grammarTryAssignmentTarget` now keys a try expression (or try operation) whose operand is a name or member chain directly before an assignment operator as `admission:try-assignment-target`, pending for the compiler owner; the parenthesized operand `try (p = 1)` and comparisons stay keyless. Three compiled sources, four shapes, seven controls, the twin, a seed and a corpus file with its pending lines record it. No compiler acceptance change: the rejection is decided elsewhere.

A Cases mutation produced the program `#!00`, which the compiler accepts with no diagnostic and the lab could not derive. ECMAScript's `HashbangComment` is `#!` at the very start of a Script or Module, to the end of its line, and TypeScript's scanner skips it; stock TypeScript 5.9.3 reports nothing for `#!00` or `#!/usr/bin/env node` followed by code, and TS18026 for `#!` anywhere else, including after a space, a line break or a comment. The lab lexer skipped only `//` and `/* */` comments. It now skips a hashbang comment at the start of the source; four forms derive, four controls stay underived and syntax-rejected, and a seed and a corpus file keep the witness. No compiler acceptance, pending-key or VIP change.

A Deep mutation emptied a phase import's argument list: `function s(specifier: string) { return import.source() }`. This is the recorded `admission:dynamic-import-arity` gap (an empty or over-long native ImportCall reports only message TS1450, which the build ignores) in its phase spelling; stock TypeScript 5.9.3 reports TS1470 and TS18061 for it. The arity classifier skipped an `import` followed by a dot, so the phase forms reached no key. It now reads `import.source(…)` and `import.defer(…)` with the same argument count; a seed and a corpus file keep the witness with its corpus pending line. No compiler acceptance, pending-key or VIP change.

The directed probe set's effect forms `effect (x): x is string => true` and `effect (x): asserts x => { }` compiled with EK0106 alone (the written return type is not an Effect, as stock TypeScript 5.9.3 reports TS1064 alone for the `async` twins) and had no derivation. Appendix A writes `ReturnType = ":" Type` with the gloss "TypeScript's return-type annotation, parsed as TypeScript parses it", and the lab built the production literally: the appendix defines the name, so the subset's `":" TypePredicate` alternative was dropped. The lab now reads that gloss as the subset's definition of the same name. A predicate after every effect signature derives, a predicate with no type or split by a line break before `is` keeps its rejection, and the compiler's acceptance is unchanged.

The probe set's module forms, `module M { }` followed by `import defer * as ns from M;` or `import source x from M;`, compiled with TS18060 alone and with nothing, and had no derivation. Appendix A's `ImportDeclaration` is an ordinary TypeScript import declaration using `ModuleSpecifier`; TypeScript's declaration takes a phase modifier, `defer` or `source`, before its clause, and the compiler parses every phase clause and leaves the rest to the checker (TS18058, TS18059 and TS18112 for the clauses a phase does not take). The lab had the phases in `ImportCall` only. `ImportDeclaration` and `TsImportDeclaration` now take `ImportPhase` before a clause without `type`; a type-only clause after a phase, a phase with no clause and a phase on a re-export keep their rejection. The same probe found `import defer from M;` and `import source from M;`, default imports named `defer` and `source` from an inline module, rejected with TS1005: the phase lookahead admits a default import of that name only before a string literal, so VIP-40's identifier specifier reads as a phase import whose default binding is `from`. `import defer;` after `module defer { }` fails the same way (TS1109): the word is read as a phase before the module-import check runs. Those are compiler rejections of derivable forms, recorded under one key; the lab derives the first two as ordinary imports and the third as a module import.

A directed batch of recent TypeScript syntax, written by hand at module level and run through the oracle, found seven inherited forms the compiler parses that the lab's TypeScript subset could not derive: `abstract class A { protected abstract get g(): number }` (an accessor signature with no body), `let d!: number`, `export as namespace Lib` (TS1315), `async <T,>(x: T) => x`, `debugger`, `export default abstract class {}` and `export * as "ns name" from "./m"`. Stock TypeScript 5.9.3 parses each with the same checker codes. Appendix A's opening sentence admits them all; the subset now writes the missing alternatives, and a line break before the assertion or the arrow, a namespace export or star re-export with no name, a debugger statement with an operand and a default export of the bare word `abstract` keep their rejection. The same batch showed the compiler rejecting three forms the lab derives at module level: `new.target` (TS17013) and `return` (TS1108), which TypeScript rejects by context the lab does not model, and `await using` at the top level of a `.vibe` file (interim EK1003), which TypeScript admits as top-level await.

A second directed batch, of type-level and member syntax, found two more inherited forms without a derivation: an import type with import attributes, `import("./m", { with: { "resolution-mode": "import" } }).T` (TypeScript's `parseImportType` takes a `with` container after the specifier; the compiler reports TS2834 alone, stock TypeScript nothing; the compiler's TypeScript rejects the retired `assert` container with TS2880, which stock 5.9.3 still admits), and a constructor parameter property with the `override` modifier (TS4113 or TS4112 from the checker). `ImportType` now reads through `ImportTypeCall`, which takes the `with` container, and `ParameterModifier` takes `override`; another container key, the `assert` key, a trailing comma after the container and a comma with no container keep their rejection.
