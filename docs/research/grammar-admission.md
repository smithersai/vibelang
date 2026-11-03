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
legacy branches inside a function.

Each row names its source hook (methods include their receiver type), `admission:<form>` key, authority, status and
reason. Authority is relative to `docs/design/src/`; a fragment names an
Appendix A production, which the test resolves. A shared hook lists each
authority separated by a comma. `admitted` is a syntax entry,
`support` is implementation machinery for the cited construct, and
`recovery` recognizes an invalid form to diagnose it. None authorizes other
branches or type-directed legacy behavior in the same function.

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
resolution errors remain non-syntax errors. `EK1007`, a topic `%` outside
every pipe body, is the early error of VIP-23's TC39 topic grammar and counts
as syntax rejection. Warnings
and suggestions do not.
Operand and name/type errors do not. Syntax-only legacy recovery also
counts as rejection; this grants no authority to the corresponding form. The grammar lab models a
bounded TypeScript subset, so an unrecognized program is triaged as either
compiler admission or lab/spec coverage before it is made pending. The
subset keeps ECMAScript's `ExpressionStatement` lookahead exactly, including
`async [no LineTerminator here] function`; Appendix A's contextual keywords are
same-line, so `effect` before a line break is an identifier statement.
The keyword table's member-position alternatives apply only in member
positions: `effect[a]` is an element access, though `[` follows `effect` on an
`interface` member.
Type-directed meaning such as aggregate `join` is outside this syntax oracle.
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
