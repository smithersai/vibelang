import { test } from "node:test"

// Rule-specific coverage backlog. Verification is deferred for the coverage deadline.
// These TODOs specify expected behavior; they do not assert a known compiler mismatch.
// Promote each language witness with its Effect TypeScript twin and complete Exit/type checks.

// docs/design/src/000-intro.md#fc63aada3d801d69 — Chapter 000: Retired pre-VIP forms.
test.todo("Chapter 000: Retired pre-VIP forms: --fix rewrites every legacy form, the compiler rejects the original, and release notes list it [docs/design/src/000-intro.md#fc63aada3d801d69]")

// docs/design/src/000-intro.md#63d052175ec0ea8d — Chapter 000: Legacy forms census.
test.todo("Chapter 000: Legacy forms census: vibelang-forms -legacy enumerates the retired syntax inventory [docs/design/src/000-intro.md#63d052175ec0ea8d]")

// docs/design/src/000-intro.md#c4578428fd649b16 — Chapter 000: Retired data methods.
test.todo("Chapter 000: Retired data methods: Option.map and Stream.map receive the legacy diagnostic and migrate to Effect APIs [docs/design/src/000-intro.md#c4578428fd649b16]")

// docs/design/src/000-intro.md#6be8af08dd691223 — Chapter 000: Reserved expression keywords.
test.todo("Chapter 000: Reserved expression keywords: try and catch parse as expressions and cannot be ordinary JavaScript bindings [docs/design/src/000-intro.md#6be8af08dd691223]")

// docs/design/src/000-intro.md#2f6691c5417d18b0 — Chapter 000: Throw contexts.
test.todo("Chapter 000: Throw contexts: an effect throw equals Effect.fail and a synchronous plain throw is rejected [docs/design/src/000-intro.md#2f6691c5417d18b0]")

// docs/design/src/000-intro.md#9b431bd22fe1f706 — Chapter 000: Foreign thrown contracts.
test.todo("Chapter 000: Foreign thrown contracts: only imported TS, JS, and module callables carry thrown types [docs/design/src/000-intro.md#9b431bd22fe1f706]")

// docs/design/src/000-intro.md#9f4b680eb459e2f6 — Chapter 000: Legacy JavaScript restrictions.
test.todo("Chapter 000: Legacy JavaScript restrictions: forbidden legacy uses fail in top-level, plain, and effect VibeLang code [docs/design/src/000-intro.md#9f4b680eb459e2f6]")

// docs/design/src/000-intro.md#8f92434b7b05676e — Chapter 000: Named module equivalence.
test.todo("Chapter 000: Named module equivalence: a top-level module and identifier import have the API and behavior of a sibling TS module [docs/design/src/000-intro.md#8f92434b7b05676e]")

// docs/design/src/000-intro.md#b029e17ed7948b08 — Chapter 000: Pinned Effect meanings.
test.todo("Chapter 000: Pinned Effect meanings: all compiled language-form twins resolve the accepted Effect 4.1.1 identity [docs/design/src/000-intro.md#b029e17ed7948b08]")

// docs/design/src/000-intro.md#bde2bbef99fcd2b2 — Chapter 000: Pattern dispatch.
test.todo("Chapter 000: Pattern dispatch: plain classes use instanceof, arrays use Array.isArray, and primitives check typeof [docs/design/src/000-intro.md#bde2bbef99fcd2b2]")

// docs/design/src/000-intro.md#43a51b097de671eb — Chapter 000: Denied syntax.
test.todo("Chapter 000: Denied syntax: using has native disposal and Users.find shorthand, trailing blocks, and wire gain no Effect meaning [docs/design/src/000-intro.md#43a51b097de671eb]")

// docs/design/src/000-intro.md#4845f26bfb467b2a — Chapter 000: Stable diagnostic codes.
test.todo("Chapter 000: Stable diagnostic codes: every diagnostic has a code and imported language-service identities keep EK38xx codes [docs/design/src/000-intro.md#4845f26bfb467b2a]")

// docs/design/src/001-functions.md#b5f0a93ba0e8da97 — Chapter 001: Malformed effect arrow.
test.todo("Chapter 001: Malformed effect arrow: typed and generic bare parameter heads report EK0109 with a parenthesis fix [docs/design/src/001-functions.md#b5f0a93ba0e8da97]")

// docs/design/src/001-functions.md#828e208a9294c886 — Chapter 001: Legacy code boundary.
test.todo("Chapter 001: Legacy code boundary: forbidden legacy JavaScript is rejected in VibeLang but admitted in a TS sibling and module body [docs/design/src/001-functions.md#828e208a9294c886]")

// docs/design/src/001-functions.md#010a1a8e3e5d1bb2 — Chapter 001: Effect method decorators.
test.todo("Chapter 001: Effect method decorators: TS decorator checking and application order are retained without running the cold body [docs/design/src/001-functions.md#010a1a8e3e5d1bb2]")

// docs/design/src/001-functions.md#e09ae25260e4b208 — Chapter 001: Effect return annotation.
test.todo("Chapter 001: Effect return annotation: explicit channels check identically to the annotation on the Effect TypeScript twin [docs/design/src/001-functions.md#e09ae25260e4b208]")

// docs/design/src/001-functions.md#266f81fbd8247539 — Chapter 001: Ordinary infer rules.
test.todo("Chapter 001: Ordinary infer rules: infer in Effect.Effect and bang-channel annotations reports TS1338 outside conditional types [docs/design/src/001-functions.md#266f81fbd8247539]")

// docs/design/src/001-functions.md#dd623b9ebe5f2405 — Chapter 001: Inline TypeScript.
test.todo("Chapter 001: Inline TypeScript: both vibe and vibex accept named module bodies checked as TS and TSX respectively [docs/design/src/001-functions.md#dd623b9ebe5f2405]")

// docs/design/src/001-functions.md#3da42edac1e4bb61 — Chapter 001: Top-level module declaration.
test.todo("Chapter 001: Top-level module declaration: named module syntax parses as a declaration at file scope [docs/design/src/001-functions.md#3da42edac1e4bb61]")

// docs/design/src/001-functions.md#bac993c65ae04960 — Chapter 001: Module body isolation.
test.todo("Chapter 001: Module body isolation: project TS or TSX options apply, legacy throw and node imports work, outer file names are invisible [docs/design/src/001-functions.md#bac993c65ae04960]")

// docs/design/src/001-functions.md#59b8bd8b7555d689 — Chapter 001: Nested module rejection.
test.todo("Chapter 001: Nested module rejection: a module inside a function, block, or class reports EK4001 [docs/design/src/001-functions.md#59b8bd8b7555d689]")

// docs/design/src/001-functions.md#d53bb1fe68a7b924 — Chapter 001: Exported module rejection.
test.todo("Chapter 001: Exported module rejection: export module and export default module report EK4002 [docs/design/src/001-functions.md#d53bb1fe68a7b924]")

// docs/design/src/001-functions.md#42e656c6515bcfad — Chapter 001: Anonymous module rejection.
test.todo("Chapter 001: Anonymous module rejection: a module expression reports EK4003 and a named imported declaration is accepted [docs/design/src/001-functions.md#42e656c6515bcfad]")

// docs/design/src/001-functions.md#1dc92e90c46f7a48 — Chapter 001: Module value rejection.
test.todo("Chapter 001: Module value rejection: dynamic import, property access, typeof, and passing the module name report EK4004 [docs/design/src/001-functions.md#1dc92e90c46f7a48]")

// docs/design/src/001-functions.md#11d6030720626ccb — Chapter 001: Module binding collision.
test.todo("Chapter 001: Module binding collision: a module name redeclaring a file binding reports EK4005 [docs/design/src/001-functions.md#11d6030720626ccb]")

// docs/design/src/001-functions.md#69071620c33e4ca7 — Chapter 001: Identifier module specifier.
test.todo("Chapter 001: Identifier module specifier: a missing module declaration or import attributes report EK4006 [docs/design/src/001-functions.md#69071620c33e4ca7]")

// docs/design/src/001-functions.md#45a7b4f9f79ca2dd — Chapter 001: Module-body identifier imports.
test.todo("Chapter 001: Module-body identifier imports: an unquoted sibling module specifier inside a body reports EK4007 [docs/design/src/001-functions.md#45a7b4f9f79ca2dd]")

// docs/design/src/001-functions.md#d8f360ac4d6d8207 — Chapter 001: Module CommonJS rejection.
test.todo("Chapter 001: Module CommonJS rejection: export equals and import equals require inside a module body report EK4008 [docs/design/src/001-functions.md#d8f360ac4d6d8207]")

// docs/design/src/001-functions.md#3d2c114e1e6ec48f — Chapter 001: Module import.meta rejection.
test.todo("Chapter 001: Module import.meta rejection: import.meta inside a named module body reports EK4009 [docs/design/src/001-functions.md#3d2c114e1e6ec48f]")

// docs/design/src/001-functions.md#2db2ed2f0201ff82 — Chapter 001: Native module forms.
test.todo("Chapter 001: Native module forms: dotted and ambient module declarations retain TS1540 [docs/design/src/001-functions.md#2db2ed2f0201ff82]")

// docs/design/src/001-functions.md#8d5b00f3994227d4 — Chapter 001: Declaration API identity.
test.todo("Chapter 001: Declaration API identity: exported names, bidirectional types, and per-export documentation match the stock TS twin [docs/design/src/001-functions.md#8d5b00f3994227d4]")

// docs/design/src/001-functions.md#8f3f5f00c4326a1d — Chapter 001: Declaration normalization.
test.todo("Chapter 001: Declaration normalization: only TS-insignificant formatting, quotes, import spelling, and ordering are ignored [docs/design/src/001-functions.md#8f3f5f00c4326a1d]")

// docs/design/src/001-functions.md#2a231f3700118664 — Chapter 001: Codemod declaration identity.
test.todo("Chapter 001: Codemod declaration identity: migration and fix comparison use the same names, bidirectional types, and documentation contract [docs/design/src/001-functions.md#2a231f3700118664]")

// docs/design/src/001-functions.md#c71921fd7ccac3f0 — Chapter 001: Foreign callable documentation.
test.todo("Chapter 001: Foreign callable documentation: the TS twin adds @throws to preserved JSDoc while the VibeLang source rejects that tag with EK0406 [docs/design/src/001-functions.md#c71921fd7ccac3f0]")

// docs/design/src/001-functions.md#05024cf58f9aa0bd — Chapter 001: Cross-module thrown contract.
test.todo("Chapter 001: Cross-module thrown contract: omitting the required throws tag makes the TS twin advertise unknown and fail API identity [docs/design/src/001-functions.md#05024cf58f9aa0bd]")

// docs/design/src/005-services.md#e174004a9f0b004d — Chapter 005: Service declaration forms.
test.todo("Chapter 005: Service declaration forms: member-object and supplied-shape service declarations match their Context.Service twins [docs/design/src/005-services.md#e174004a9f0b004d]")

// docs/design/src/005-services.md#e5eda14df7230b47 — Chapter 005: Recursive service shape.
test.todo("Chapter 005: Recursive service shape: self-recursive and mutually recursive written member contracts typecheck [docs/design/src/005-services.md#e5eda14df7230b47]")

// docs/design/src/005-services.md#543366640e4864cf — Chapter 005: Supplied service shape.
test.todo("Chapter 005: Supplied service shape: a body member beyond key and default reports EK0902 [docs/design/src/005-services.md#543366640e4864cf]")
