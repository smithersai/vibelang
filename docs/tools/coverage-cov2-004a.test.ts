// Assigned Chapter 004 obligations whose full compiler/type/runtime matrix is slow to verify.
// TODO is a coverage obligation, not a compiler-conformance claim.
import { test } from "bun:test"

// Chapter 004: full proposal: regex literal and RegExp value patterns, relational operators, and Promise-producing async match; rule-evidence: docs/design/src/004-match.md#683043d2323a5086
test.todo("Chapter 004 / docs/design/src/004-match.md#683043d2323a5086 / full proposal: regex literal and RegExp value patterns, relational operators, and Promise-producing async match")

// Chapter 004: reconciliation matrix: both regex forms, native relational coercion, async Promise adoption, boolean/extractor matchType, and unmodified RegExp.prototype; rule-evidence: docs/design/src/004-match.md#86e5149c6d886fcc
test.todo("Chapter 004 / docs/design/src/004-match.md#86e5149c6d886fcc / reconciliation matrix: both regex forms, native relational coercion, async Promise adoption, boolean/extractor matchType, and unmodified RegExp.prototype")

// Chapter 004: throw arm in Effect fails typed, async function and async match reject, and plain VibeLang reports EK0401; rule-evidence: docs/design/src/004-match.md#711ad3a532a8a967
test.todo("Chapter 004 / docs/design/src/004-match.md#711ad3a532a8a967 / throw arm in Effect fails typed, async function and async match reject, and plain VibeLang reports EK0401")

// Chapter 004: implicit no-match/protocol/getter/call exceptions are untracked and become Effect defects; rule-evidence: docs/design/src/004-match.md#4e7e25799d45e5fe
test.todo("Chapter 004 / docs/design/src/004-match.md#4e7e25799d45e5fe / implicit no-match/protocol/getter/call exceptions are untracked and become Effect defects")

// Chapter 004: is let/const bindings use the nearest enclosing block, match arm or other lexical home; rule-evidence: docs/design/src/004-match.md#5f82e5d683bba420
test.todo("Chapter 004 / docs/design/src/004-match.md#5f82e5d683bba420 / is let/const bindings use the nearest enclosing block, match arm or other lexical home")

// Chapter 004: is bindings shadow through both branches and the rest of the home, including skipped and failed patterns; rule-evidence: docs/design/src/004-match.md#19cadedb25db7f08
test.todo("Chapter 004 / docs/design/src/004-match.md#19cadedb25db7f08 / is bindings shadow through both branches and the rest of the home, including skipped and failed patterns")

// Chapter 004: an assignment to a const is-pattern binding reports the native const-assignment diagnostic; rule-evidence: docs/design/src/004-match.md#573f1f7bc0e134b1
test.todo("Chapter 004 / docs/design/src/004-match.md#573f1f7bc0e134b1 / an assignment to a const is-pattern binding reports the native const-assignment diagnostic")

// Chapter 004: same-home duplicate is bindings use TS2451, with TS2300 for parameter collisions; rule-evidence: docs/design/src/004-match.md#62b9f8b273bbaf5e
test.todo("Chapter 004 / docs/design/src/004-match.md#62b9f8b273bbaf5e / same-home duplicate is bindings use TS2451, with TS2300 for parameter collisions")

// Chapter 004: update-introduced cells begin in TDZ; after their own pattern initializes them ordinary definite-assignment applies; rule-evidence: docs/design/src/004-match.md#155f53913884e0f6
test.todo("Chapter 004 / docs/design/src/004-match.md#155f53913884e0f6 / update-introduced cells begin in TDZ; after their own pattern initializes them ordinary definite-assignment applies")

// Chapter 004: guard failure and predicate complements; rule-evidence: docs/design/src/004-match.md#d15a64b19617640a
test.todo("Chapter 004 / docs/design/src/004-match.md#d15a64b19617640a / predicate false branches can narrow without finite coverage; a failed guard must not imply the positive predicate failed")

// Chapter 004: a relational pattern such as less-than zero narrows neither the subject type nor a binding; rule-evidence: docs/design/src/004-match.md#508b6205d58cf85d
test.todo("Chapter 004 / docs/design/src/004-match.md#508b6205d58cf85d / a relational pattern such as less-than zero narrows neither the subject type nor a binding")

// Chapter 004: not complements the actual ordinary-class, own matcher, generated-error or retained fixed test; rule-evidence: docs/design/src/004-match.md#79effa77469a4585
test.todo("Chapter 004 / docs/design/src/004-match.md#79effa77469a4585 / not complements the actual ordinary-class, own matcher, generated-error or retained fixed test")

// Chapter 004: unknown uses the declared error type fallback, including a getter absent from a matching foreign object; rule-evidence: docs/design/src/004-match.md#2d6500f1b6e27dc4
test.todo("Chapter 004 / docs/design/src/004-match.md#2d6500f1b6e27dc4 / unknown uses the declared error type fallback, including a getter absent from a matching foreign object")

// Chapter 004: or alternative replacement preserves TDZ, source const immutability, and duplicate-initialization restrictions; rule-evidence: docs/design/src/004-match.md#77298c2f137b6437
test.todo("Chapter 004 / docs/design/src/004-match.md#77298c2f137b6437 / or alternative replacement preserves TDZ, source const immutability, and duplicate-initialization restrictions")

// Chapter 004: if-head bindings use the enclosing home and retain within-one-or cell replacement; rule-evidence: docs/design/src/004-match.md#479cfcc63d56554d
test.todo("Chapter 004 / docs/design/src/004-match.md#479cfcc63d56554d / if-head bindings use the enclosing home and retain within-one-or cell replacement")

// Chapter 004: EK0705 rejects unbraced statement-body is bindings for every if/else/loop/label form; rule-evidence: docs/design/src/004-match.md#dd17190e2e5680df
test.todo("Chapter 004 / docs/design/src/004-match.md#dd17190e2e5680df / EK0705 rejects unbraced statement-body is bindings for every if/else/loop/label form")

// Chapter 004: the EK0705 editor action and CLI --fix wrap the owning statement body in braces; rule-evidence: docs/design/src/004-match.md#be0cbf2d645b9852
test.todo("Chapter 004 / docs/design/src/004-match.md#be0cbf2d645b9852 / the EK0705 editor action and CLI --fix wrap the owning statement body in braces")

// Chapter 004: else-if binding uses the enclosing home's scope and requires braces around an unbraced else body; rule-evidence: docs/design/src/004-match.md#3db8070047219592
test.todo("Chapter 004 / docs/design/src/004-match.md#3db8070047219592 / else-if binding uses the enclosing home's scope and requires braces around an unbraced else body")

// Chapter 004: duplicate top-level is bindings and lexical collisions use TS2451; parameter collisions keep native codes; rule-evidence: docs/design/src/004-match.md#ba8cbc651337e3f5
test.todo("Chapter 004 / docs/design/src/004-match.md#ba8cbc651337e3f5 / duplicate top-level is bindings and lexical collisions use TS2451; parameter collisions keep native codes")

// Chapter 004: duplicate initialization inside one top-level pattern follows the draft, with its authorized or exception; rule-evidence: docs/design/src/004-match.md#255ded8a0c673e62
test.todo("Chapter 004 / docs/design/src/004-match.md#255ded8a0c673e62 / duplicate initialization inside one top-level pattern follows the draft, with its authorized or exception")

// Chapter 004: EK0705 covers unbraced bodies and formal/catch initializers while explicit blocks and arms retain homes; rule-evidence: docs/design/src/004-match.md#04e27363ff50585f
test.todo("Chapter 004 / docs/design/src/004-match.md#04e27363ff50585f / EK0705 covers unbraced bodies and formal/catch initializers while explicit blocks and arms retain homes")

// Chapter 004: EK0702 rejects data types/variants, schemas, Context.Reference and invalid or nonsignature call-only callees; rule-evidence: docs/design/src/004-match.md#54632cb353222591
test.todo("Chapter 004 / docs/design/src/004-match.md#54632cb353222591 / EK0702 rejects data types/variants, schemas, Context.Reference and invalid or nonsignature call-only callees")

// Chapter 004: finite-domain omissions have EK4701 for both synchronous and async match; rule-evidence: docs/design/src/004-match.md#d9b8b646ff70f290
test.todo("Chapter 004 / docs/design/src/004-match.md#d9b8b646ff70f290 / finite-domain omissions have EK4701 for both synchronous and async match")

// Chapter 004: finite domains expand booleans, enums, data variants, Option, Exit and Result into their members; rule-evidence: docs/design/src/004-match.md#e5363fe99945fcac
test.todo("Chapter 004 / docs/design/src/004-match.md#e5363fe99945fcac / finite domains expand booleans, enums, data variants, Option, Exit and Result into their members")

