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

Modifiers on an export declaration (`export export {};`, `TS1193`) are
another native grammar rejection. The compiler already rejects this form;
the admission classifier recognizes its existing error. Warnings,
suggestions, messages and diagnostics from another source with the same
number remain non-rejections; ordinary exports with name or module-resolution
errors retain their TypeScript derivation.

`EK2109` is a schema type/value error, including a missing Schema value or
incompatible decoded-key flags. It does not reject syntax: a schema field
with an unadmitted `effect` modifier remains an admission mismatch when its
type also reports `EK2109`. The keyed unsupported-field witness shares the
existing `admission:schema-effect-field` pending family; ordinary, optional
and readonly fields with unsupported types remain grammar-derived controls.

Schema types with a leading JSDoc `?`, `??`, `!` or `*` are a separate
`admission:schema-jsdoc-field-type` gap. The native parser recovers a
JSDoc type, which the schema mapping replaces before the native
source-type diagnostic runs; only `EK2109` remains. The exact type-prefix
family stays pending, with optional, readonly, schema-alias and schema-error
controls. Native schema-error methods and computed property names stay outside
the mapped-type family.
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
meta-property names report `TS17012`, and native target placement reports
`TS17013`; error-category diagnostics reject syntax.
VibeLang's platform check instead covers `import.x` before its native
grammar check, leaving only `EK4402`. That exact bad-name/incomplete-phase
family remains pending under `admission:import-meta-property`. Ordinary
member names and native URL-whitelist recovery remain separate controls.
Phase-import calls remain outside the generated subset.

An `async` modifier on a schema field is also outside Appendix A's
`Field` production. An unresolved schema reference reports `EK2109`
and covers its declaration, hiding the native modifier diagnostic. Primitive
field types still report native syntax rejection. The exact `admission:schema-async-field` family remains
pending, with ordinary fields named `async`, computed expressions,
native members and schema-error methods as separate controls.

The same mapped-type gap includes JSDoc's postfix `?`, as in
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


The `schema-async-field` pending family includes a leading or interleaved
`static` modifier before the written field name and type, including repeated
`async` modifiers. A field named `async`, a static method and a schema-error
member remain separate controls. The classifier still requires an actual
`async` modifier; a static property alone does not enter this family.


A static schema field without an `async` modifier has its own
`admission:schema-static-field` key. `SchemaDeclaration` contains only
`Field` members, whose sole admitted modifier is `readonly`. An unresolved
field type can cover the independent static-modifier rejection with
`EK2109`. Named bodies and object-type aliases retain separate keyed
witnesses. Fields named `static`, static methods, schema-error bodies and
async-modified fields remain controls or their existing families.

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

The existing `admission:schema-static-field` key includes a line break
after `static`, as native class modifiers allow. The modifier scan keeps
`async` and `readonly` line restrictions and separates a field named
`static`, methods and schema-error members. The exact multiline witness is
a pending corpus case in that same diagnostic gap.

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
and requires an `Expression` inside `[ ]`. The parser currently splits
`value is Matcher` followed by a new-line empty or elided array into two
statements, reporting only semantic errors. The exact
`admission:pattern-member-line-break` family stays pending; explicit
semicolons, nonempty computed members and non-member patterns stay separate.
`EK0702` is a class-pattern type error and does not reject syntax.

Combined patterns retain the same computed-member continuation: `and`, `or` and `not` can end with a member followed by a new-line access. The pending classifier follows top-level pattern operators while retaining parenthesized, extractor, binding, array and object tails as separate controls. These witnesses share `admission:pattern-member-line-break`; no new language form is admitted.

A bare `async` identifier in a native `for … of` head already reports `TS1106`. The oracle counts that native error as syntax rejection, while preserving warning, suggestion, message and diagnostic-source boundaries. A declaration named `async`, a property target and a native `for … in` head remain separate deriving controls.

The inherited `for await … of` head has its own production. Unlike an ordinary `for … of` head, it permits a bare assignment target named `async`. Both forms keep their declaration and destructuring heads, while the bare `let` exclusion and malformed iterable/head controls remain in place.

The module-level ordinary `for (async of xs)` head remains pending as `admission:for-of-async-module`. Stock TypeScript reports `TS1106` even in an external module under `NodeNext`. The VibeLang root enables `AwaitContext` for top-level await, also suppressing that unrelated native head check. The classifier follows actual ordinary for-of nodes outside source callables; real async functions, declarations, parenthesized/property targets and for-await heads stay separate.

The lab carries native async-body context when selecting an ordinary `for … of` head. A bare target named `async` derives inside async functions, arrows, methods and generators. Nested plain callables reset that context; nested async callables restore their own. Module-level ordinary heads retain their native restriction and separate pending compiler gap. This models the head distinction; other `Await` and `Yield` early errors remain outside the bounded lab.

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
one of those names and a field with an `effect` modifier retains the existing
`admission:schema-effect-field` gap. The full grammar and diagnostics still
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
`admission:schema-field-initializer` is a field initializer whose unresolved
type reports only `EK2109` and covers TS1247.
`admission:throw-assertion-lookahead` is `throw e as T` before a
`ThrowExpressionInvalidPunctuator`, which VIP-41 forbids and the compiler
misses because its lookahead stops at the assertion. `error is` before a line
that can continue an `is` pattern looks like a third form but is a declaration,
because a `DeclarationStart` begins a declaration wherever one can start, so
the lab no longer holds that statement open.

A sweep that stacks up to two mutations on every seed and keyed program found
four more kinds of result. A repeated `readonly` on a schema field is
`admission:schema-duplicate-readonly`: `Field` admits one `readonly`, and an
unresolved field type reports only `EK2109`, which covers TS1030. In an
object-type alias the family includes an untyped name, a method signature
and an object type behind a type operator such as `readonly { … }`. An
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
with TS1024, and the alias's `EK2109` for the method covers it. An untyped
alias member with `=`, such as `{ id? = Missing }`, is TS1247 and joins
`admission:schema-field-initializer`. An angle-bracket assertion and a type
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
These programs stay pending; the classifier changes no compiler admission.

Native accessor diagnostics also reject grammar: getters cannot have value
parameters, setters require one value parameter, accessors have no type
parameters, and setters have no return annotation or optional, rest or
initialized value parameter. These checks already run in TypeScript's
`checkGrammarAccessor`. The oracle counts their error diagnostics while
preserving the category and diagnostic-source boundaries.


An `async` method signature in a schema alias is the separate
`admission:schema-async-method` family. A call or method signature with an
illegal parameter modifier is `admission:schema-signature-parameter-modifier`.
Both report only `EK2109` for the unsupported member, covering native
grammar rejection. Mapping an earlier unresolved field can also cover
`TS1070` on the final untyped `async` member; it retains
`admission:schema-async-field`.

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
