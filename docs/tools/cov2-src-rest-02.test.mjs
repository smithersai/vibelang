import { test } from "node:test"

// Rule-specific coverage backlog. Verification is deferred for the coverage deadline.
// These TODOs specify expected behavior; they do not assert a known compiler mismatch.
// Promote each language witness with its Effect TypeScript twin and complete Exit/type checks.

// docs/design/src/005-services.md#0a024935bc62dc7c — Chapter 005: Annotated service member rejection.
test.todo("Chapter 005: Annotated service member rejection: adding a property or method to service Name: Type reports EK0902 [docs/design/src/005-services.md#0a024935bc62dc7c]")

// docs/design/src/005-services.md#e804b60f82a7f650 — Chapter 005: Service generic capture.
test.todo("Chapter 005: Service generic capture: outer type parameters reached by aliases and constraints report EK3005 by resolved identity [docs/design/src/005-services.md#e804b60f82a7f650]")

// docs/design/src/005-services.md#b03a19b1ff895445 — Chapter 005: Provide parse precedence.
test.todo("Chapter 005: Provide parse precedence: provide / a / {} in a plain function reports EK1201 instead of parsing division [docs/design/src/005-services.md#b03a19b1ff895445]")

// docs/design/src/005-services.md#95fd846788c0bd18 — Chapter 005: Platform module boundary.
test.todo("Chapter 005: Platform module boundary: a named module body accepts platform APIs under the same TS checks as a sibling file [docs/design/src/005-services.md#95fd846788c0bd18]")

// docs/design/src/005-services.md#e952d6b8ca13fbc4 — Chapter 005: Platform code location.
test.todo("Chapter 005: Platform code location: platform imports work in a TS sibling or module body and are rejected in ordinary VibeLang [docs/design/src/005-services.md#e952d6b8ca13fbc4]")

// docs/design/src/005-services.md#b0b8facee18538fa — Chapter 005: Dynamic platform specifiers.
test.todo("Chapter 005: Dynamic platform specifiers: computed imports are unchecked while literal data and blob imports report EK0107 [docs/design/src/005-services.md#b0b8facee18538fa]")

// docs/design/src/006-data.md#675645d92b350b98 — Chapter 006: Schema field separators.
test.todo("Chapter 006: Schema field separators: two fields on one line without a separator report EK1504 [docs/design/src/006-data.md#675645d92b350b98]")

// docs/design/src/006-data.md#31bb41d5dc46b998 — Chapter 006: Missing declaration bodies.
test.todo("Chapter 006: Missing declaration bodies: recognized schema and data headers report EK1503 and EK1604 respectively [docs/design/src/006-data.md#31bb41d5dc46b998]")

// docs/design/src/006-data.md#27dbf84ce81c0a4f — Chapter 006: Resolved schema built-ins.
test.todo("Chapter 006: Resolved schema built-ins: generic mappings require library bindings while array syntax ignores an Array shadow [docs/design/src/006-data.md#27dbf84ce81c0a4f]")

// docs/design/src/006-data.md#9759b517510be531 — Chapter 006: Schema union flattening.
test.todo("Chapter 006: Schema union flattening: parenthesized nested unions flatten in source order to the same Schema as a flat union [docs/design/src/006-data.md#9759b517510be531]")

// docs/design/src/006-data.md#8c29fe0a8e6704dd — Chapter 006: Schema literal arrays.
test.todo("Chapter 006: Schema literal arrays: the element of (\"a\" | \"b\")[] lowers to Schema.Literals([\"a\", \"b\"]) [docs/design/src/006-data.md#8c29fe0a8e6704dd]")

// docs/design/src/006-data.md#2abcaa1228285d16 — Chapter 006: Schema error computed tag.
test.todo("Chapter 006: Schema error computed tag: generic, enum, and branded key domains that may include _tag are rejected [docs/design/src/006-data.md#2abcaa1228285d16]")

// docs/design/src/006-data.md#211a8e3bee417066 — Chapter 006: Default schema export.
test.todo("Chapter 006: Default schema export: direct export default schema forms report EK1501 and a named default re-export works [docs/design/src/006-data.md#211a8e3bee417066]")

// docs/design/src/006-data.md#83a6ef651fa87427 — Chapter 006: Generic schema rejection.
test.todo("Chapter 006: Generic schema rejection: schema type parameters report EK1502 while an ordinary generic Schema factory works [docs/design/src/006-data.md#83a6ef651fa87427]")

// docs/design/src/006-data.md#7584cc4a155d5bbd — Chapter 006: Missing ordinary schema body.
test.todo("Chapter 006: Missing ordinary schema body: a recognized schema header without a body or admitted alias reports EK1503 [docs/design/src/006-data.md#7584cc4a155d5bbd]")

// docs/design/src/006-data.md#6e8ec2a99e04896a — Chapter 006: Schema separator fix.
test.todo("Chapter 006: Schema separator fix: EK1504 inserts a semicolon between same-line fields without changing their types [docs/design/src/006-data.md#6e8ec2a99e04896a]")

// docs/design/src/006-data.md#065b820ccbdd3365 — Chapter 006: Schema non-field members.
test.todo("Chapter 006: Schema non-field members: methods and index signatures in an ordinary schema body report EK1505 [docs/design/src/006-data.md#065b820ccbdd3365]")

// docs/design/src/006-data.md#8b59c5bc21f8047c — Chapter 006: Ambient schema precedence.
test.todo("Chapter 006: Ambient schema precedence: inherited and explicit ambient contexts report EK1506 before a missing-body EK1503 [docs/design/src/006-data.md#8b59c5bc21f8047c]")

// docs/design/src/006-data.md#5a4d7b0f642809ab — Chapter 006: Written schema alias.
test.todo("Chapter 006: Written schema alias: one nongeneric typeof X.Type alias replaces synthesis in either order and retains separate JSDoc and exports [docs/design/src/006-data.md#5a4d7b0f642809ab]")

// docs/design/src/006-data.md#98d4d1499f6ddce3 — Chapter 006: Schema built-in identity.
test.todo("Chapter 006: Schema built-in identity: Array, ReadonlyArray, Record, and Readonly map only when resolved to library type bindings [docs/design/src/006-data.md#98d4d1499f6ddce3]")

// docs/design/src/006-data.md#6ea8b6ea17c5b689 — Chapter 006: Reserved-word data variants.
test.todo("Chapter 006: Reserved-word data variants: IdentifierName variants including default are admitted and construct the expected tag [docs/design/src/006-data.md#6ea8b6ea17c5b689]")

// docs/design/src/006-data.md#38ac4288643c24ba — Chapter 006: Data payload keys.
test.todo("Chapter 006: Data payload keys: broad entity-name keys may index, arbitrary computed expressions retain TS1170, and payloads exclude _tag [docs/design/src/006-data.md#38ac4288643c24ba]")

// docs/design/src/006-data.md#a49847be36aaeb46 — Chapter 006: Data string index constraint.
test.todo("Chapter 006: Data string index constraint: a string index signature fails Data.TaggedEnum's reserved-tag constraint rather than TS1170 [docs/design/src/006-data.md#a49847be36aaeb46]")

// docs/design/src/006-data.md#d8932f2880c05f56 — Chapter 006: Reserved data helpers.
test.todo("Chapter 006: Reserved data helpers: generic and nongeneric $is and $match variants report EK1602 [docs/design/src/006-data.md#d8932f2880c05f56]")

// docs/design/src/006-data.md#3d95ab8b6552a523 — Chapter 006: Reserved variant rename.
test.todo("Chapter 006: Reserved variant rename: the quick fix picks fresh Is or Match names and updates resolved references without capturing shadows [docs/design/src/006-data.md#3d95ab8b6552a523]")

// docs/design/src/006-data.md#c8b54ab40c6af010 — Chapter 006: Data payload lowering.
test.todo("Chapter 006: Data payload lowering: payload members form a TS type literal under Data.TaggedEnum with the native type checks [docs/design/src/006-data.md#c8b54ab40c6af010]")

// docs/design/src/006-data.md#ea443c51c12274ce — Chapter 006: Repeated computed data fields.
test.todo("Chapter 006: Repeated computed data fields: equal types compile and incompatible declarations retain TS2717 [docs/design/src/006-data.md#ea443c51c12274ce]")

// docs/design/src/006-data.md#c9f2fa38b458ee5c — Chapter 006: Data constructor thrown contract.
test.todo("Chapter 006: Data constructor thrown contract: generated constructors advertise @throws {never} even across a foreign-callable boundary [docs/design/src/006-data.md#c9f2fa38b458ee5c]")

// docs/design/src/006-data.md#7704d37d07cfd318 — Chapter 006: Readonly data payload.
test.todo("Chapter 006: Readonly data payload: generated variant properties are readonly without a written readonly modifier [docs/design/src/006-data.md#7704d37d07cfd318]")

// docs/design/src/006-data.md#d2efeeddbbe07c0c — Chapter 006: Data variant matching.
test.todo("Chapter 006: Data variant matching: TC39 object patterns discriminate the generated _tag [docs/design/src/006-data.md#d2efeeddbbe07c0c]")

// docs/design/src/006-data.md#f94811ad3f735a53 — Chapter 006: Bare pattern key.
test.todo("Chapter 006: Bare pattern key: { tracking } checks property existence and { let tracking } binds the property [docs/design/src/006-data.md#f94811ad3f735a53]")

// docs/design/src/006-data.md#48ff48b3ce648da1 — Chapter 006: Pattern lexical binding.
test.todo("Chapter 006: Pattern lexical binding: the documented let tracking witness reads \"1Z\" and the bare-key witness reads the outer \"outer\" [docs/design/src/006-data.md#48ff48b3ce648da1]")

// docs/design/src/006-data.md#cb731aded65134e8 — Chapter 006: Data exhaustiveness.
test.todo("Chapter 006: Data exhaustiveness: missing data variants and tagged members report EK4701 [docs/design/src/006-data.md#cb731aded65134e8]")

// docs/design/src/006-data.md#b86b59cedbb8eb0a — Chapter 006: Exhaustiveness eligibility.
test.todo("Chapter 006: Exhaustiveness eligibility: an unsupported normalized subject member disables the exhaustiveness diagnostic [docs/design/src/006-data.md#b86b59cedbb8eb0a]")

// docs/design/src/006-data.md#b878f0dd5aba3468 — Chapter 006: Reserved data field.
test.todo("Chapter 006: Reserved data field: a variant payload field named _tag reports EK1601 [docs/design/src/006-data.md#b878f0dd5aba3468]")

// docs/design/src/006-data.md#f1f0e4ad214ca7bf — Chapter 006: Reserved generic data variant fix.
test.todo("Chapter 006: Reserved generic data variant fix: EK1602 renames $is or $match and their resolved references to a fresh identifier [docs/design/src/006-data.md#f1f0e4ad214ca7bf]")

// docs/design/src/006-data.md#e68995934c941547 — Chapter 006: Default data export.
test.todo("Chapter 006: Default data export: export default data reports EK1603 and a named default re-export is accepted [docs/design/src/006-data.md#e68995934c941547]")

// docs/design/src/006-data.md#33496cc289ad627c — Chapter 006: Missing data body.
test.todo("Chapter 006: Missing data body: a recognized data header without a variant body reports EK1604 [docs/design/src/006-data.md#33496cc289ad627c]")

// docs/design/src/006-data.md#84ccc9cac1986b3f — Chapter 006: Data separator fixes.
test.todo("Chapter 006: Data separator fixes: adjacent variants or payload fields report EK1605 and inserting semicolons preserves the declaration [docs/design/src/006-data.md#84ccc9cac1986b3f]")

// docs/design/src/006-data.md#6b249e32c56f8549 — Chapter 006: Malformed data member fix.
test.todo("Chapter 006: Malformed data member fix: argument-list variants and payload methods report EK1606 with a field-form repair [docs/design/src/006-data.md#6b249e32c56f8549]")
