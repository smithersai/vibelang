# Grammar admission audit

Nothing enters VibeLang through implementation precedent. Accepted VIPs and
their public amendments decide admission; Appendix A states its grammar.

The checked table is
`typescript/tsc/internal/vibelangfuzz/testdata/grammar_admission.tsv`.
`TestGrammarAdmissionInventory` scans every non-test function in
`parser/vibelang.go` and `parser/vibelang_*.go`, including helpers and recovery
paths, and every function in a file with a method on `vibelang.lowering`. This intentionally includes
support machinery so a new entry point cannot evade the census by choosing
a different function name. Rows ending in `@<form>` document additional
legacy branches inside a function. Base and branch rows may appear in any order;
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

A `-` authority and `pending` status mean that no accepted authority was
found. Those rows record audit debt, including denied and open proposals;
they grant no permission to accept the form and request no compiler change.
A grammatical operand can still violate a VIP's type or semantic rule:
`join [a, b]` and `Port()` need semantic review even though arrays and ordinary
calls are TypeScript grammar. The inventory and the grammar oracle serve
different checks.

Run the census from `typescript/tsc/`:

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
`EK2109` is a schema type/value error, including a missing Schema value or
incompatible decoded-key flags. It does not reject syntax: a schema field
with an unadmitted `effect` modifier remains an admission mismatch when its
type also reports `EK2109`. The keyed unsupported-field witness shares the
existing `admission:schema-effect-field` pending family; ordinary, optional
and readonly fields with unsupported types remain grammar-derived controls.
Syntax-only legacy recovery also counts as rejection; this grants no authority to the corresponding form. The grammar lab models a
bounded TypeScript subset, so an unrecognized program is triaged as either
compiler admission or lab/spec coverage before it is made pending. The
subset keeps ECMAScript's `ExpressionStatement` lookahead exactly, including
`async [no LineTerminator here] function`; Appendix A's contextual keywords are
same-line, so `effect` before a line break is an identifier statement.
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
modifier at all, yet `schema S { effect id: string }` compiles with no
diagnostic: the schema body parses through the type-member path, but its
members are not children of a type literal or interface, so the `EK0108` rule
never sees them. The `schema-effect-field` seed, corpus and inventory alias
row keep that gap pending until the compiler rejects it.

The oracle compiles with module `NodeNext`, an ES module. There
TypeScript's checker rejects an export assignment (`export = 1;`) with the
grammar error `TS1203`, which now counts as syntax rejection. It admits an
import assignment, `import x = require("m")` or `import y = N.a`:
TypeScript's `ImportEqualsDeclaration`, which VIP-40 forbids only inside a
module body (`EK4008`). The lab's TypeScript subset now derives it.
Campaign176 found both omissions.

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

`fork` and `join` in a plain native generator share the
`interruption-in-generator` cause: the compiler still treats an unannotated
`function*` as an implicit producer, so `function* g() { join effect % 1; }`
compiles with only the operand type error `EK4611`. The classifier keys it
`admission:fiber-in-generator` (seed, corpus, inventory alias row on
`isProducer`), apart from `join-outside-effect`, whose compiler fix landed.
