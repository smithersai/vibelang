// rule-evidence: docs/design/src/003-failures.md#throw-expressions | For a legacy comma separator, `vibelang --fix` and `--fix --fix-vip-only` parenthesize the whole throw expression while preserving its operand.
// rule-evidence: docs/design/src/900-appendices.md#throwexpression | Every invalid punctuator reports `EK1010` as an error; `vibelang --fix` groups a legacy throw expression before a comma without changing its unary operand.
// rule-evidence: docs/design/vips/0041-throw-expressions.md#decision | This repair also runs with `--fix-migration-only` and `--fix-vip-only`.
import { test } from "node:test"
import { verifyThrowCommaMigration } from "../../.smithers/flows/migrate/test/throw-comma-native.test.mjs"

for (const scope of ["--fix-migration-only", "--fix-vip-only"]) {
  test("throw-comma migration preserves the source with " + scope, () => verifyThrowCommaMigration(scope))
}
