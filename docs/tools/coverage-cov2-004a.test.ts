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
