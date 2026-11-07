# Release notes

VibeLang is v0, so a new version can change the language in breaking ways.
Before you update, read the notes for every version between yours and the new
one, and update `vibelang`, `vibelang-runtime`, and `vibelang-vite` together.

## 0.0.13

### Bugs fixed since 0.0.12

- Bundled dynamic imports could be reported as having an incorrect source position when a generated import used the same module name. Valid positions are now recognized while shifted mappings still fail.

- Generating the diagnostic reference from sources with same-named constants could replace a diagnostic with another package's code. It now keeps the code selected by the source package and imports.

- Vite SSR stacks could show generated JavaScript positions after a compiler cache write. Cache entries now preserve loaded modules and their original source locations.

- Formatting a standalone `do` expression could fail with `'while' expected`. The formatter now keeps the parentheses that distinguish it from a `do`/`while` statement.

- Migration examples with contextual plugin factories could still be reported as unsupported after their inferred contracts were preserved. They now verify the supported repair, including named wrappers and generic factories.
- The HTTP handler migration example could report missing `Request` or `Response` types when its declarations were checked. Both the original and repaired examples now load the web types their signatures require.
- Migration examples could reject the expected source-extension diagnostic as a failed conversion. They now follow TypeScript for value and type-only imports, including when neither extension option is enabled.

- The migrate flow kept a module in TypeScript with "the type Item reads the value Issue" when its platform code named a private type that reads a module value, such as `type Item = typeof Issue.Type` beside a private schema `Issue`. The `.platform.ts` companion copies such a type, so the value it reads now moves to the companion with it, and the module imports the value back or re-exports it.
- A `.vibe` class constructor calling `super(...)` on a `.ts` base class whose constructor declares `@throws {RangeError}` was accepted, so constructing the class could throw from synchronous VibeLang code. The call is now `EK0401`, as any other call known to throw in a constructor.

- A `schema` field typed `Date`, `URL`, `RegExp`, `Uint8Array`, `ReadonlySet<T>` or `ReadonlyMap<K, V>` reported `EK2109`. These TypeScript-library types now map to Effect's `Schema.Date`, `Schema.URL`, `Schema.RegExp`, `Schema.Uint8Array`, `Schema.ReadonlySet` and `Schema.ReadonlyMap`. `Set` and `Map` still report `EK2109`, now with a note that names the read-only form.

- The TypeScript content mapper ran Effects returned by plain `catch` handlers too early. It now returns those Effects as data until an explicit `try` runs them.

- The TypeScript content mapper could leave a stored Effect unrun in a `catch` expression. It now runs the operand once and handles its failure.

- In effect code, `new Dynamic()` where `Dynamic` is typed `any` got no diagnostic, although calling the same value does. Construction through `any` now has thrown type `unknown` too: it needs a bridge in effect code (`EK0403`) and is `EK0401` in a plain function that returns an Effect.

- Editing a JavaScript dependency could leave stale type checking in the Vite dev server. Importers now report changed type errors and recover when the JavaScript is corrected.

- When a `.ts` function's `@throws` named a type that is not a class, such as `@throws {typeof sentinel}` or `@throws {"default"}`, calling it in plain code reported `EK0401` saying it "may throw 'unknown'". The message now shows the written contract, as the effect-code message does.

- Migration examples with callable exports outside a package could still be reported as unsupported after their dependencies resolved. They now verify that support while continuing to reject changed types, changed documentation, and unresolved inputs.

- `vibelang --fix` moved a throwing call or `throw` into a TypeScript module body and imported its helper with an alias, `import { invoke as $invoke } from $call$ts`, so a repository whose lint forbids renamed imports rejected the fixed file. The module body now exports the helper under the name the file uses, `import { $invoke } from $call$ts`, and a helper written the old way is still reused.
- The snippet-checker guide showed a logging Effect without running it. Its example now runs the log call and explains how to start `main` explicitly.
- An exported `main` in the documentation's output examples could remain unrun and print nothing. Those examples now call `runPromise(main())` explicitly.

- Installing a bundler example could reject the exact source-map helper versions required by the VibeLang plugins. The examples now exempt those pinned helpers from the minimum release age.

- The `EK0403` message said it applied in a plain `catch` handler, where a call whose throwing is unknown is an ordinary call and a call known to throw is `EK0401`. It now says it applies in effect code, and names class evaluation among the forms it covers.

- A `try` around a type assertion or conditional could run a returned Effect too early in TypeScript mapper output. It now runs only the operand's outer Effect, preserving the returned Effect for its own execution site.

- An explicit `try` in an Effect-annotated `const` initializer could be rejected or skipped. It now runs at the binding site and stores the Effect's success value.

- A class field that overrode a base class member with a function that may throw, such as `class C extends Reader { read = parse }` where `parse` declares `@throws {RangeError}` and `Reader.read` admits no throw, was accepted. It now reports `EK0402`, as the same member does under `implements`.

- Patterns with an impossible extractor length showed a warning without a usable editor repair. The editor now offers a bare pattern or the matching single-value extractor.

- The bundler entry-point example still expected automatic `main` startup. It now writes its runner explicitly and keeps an imported library's `main` inert.

- The bundled entry-point example reported `TS5097` for its `.vibe` import. Its configuration now enables source-extension rewriting, as TypeScript requires.

- Fresh checkout checks could fail to load the Vite plugin because its runtime dependencies were missing. Starter and isolated tool checks now install and resolve those dependencies.

- Foreign constructors and tagged templates could leave `EK0403` behind after `--fix`. Supported synchronous invocations now receive explicit defect bridges, and generator repairs include constructors.

- The diagnostic inventory could report retired `EK4705` even though the compiler emits `EK0707`. Numeric assignments in unrelated files no longer invent mapper diagnostic codes.

- A file containing retired handler syntax could also produce overlapping-edit errors and lose unrelated generated code. The TypeScript mapper now reports the retirement diagnostic while preserving other declarations.

- Replaying a migration example after compilation could report a compiler-generated declaration as an extra source file. Replays now ignore generated declaration companions and retain authored declarations.

- The migration example for incomplete `Stream` results omitted its type assertions before the repair. It now retains those assertions from input to repaired output.

- Examples with declaration snapshots could be rejected despite a valid repair. Declaration snapshots now stay separate from the source being repaired.

- The page outline contained invalid list markup on wide screens. Its position marker now stays out of screen-reader navigation while headings remain proper list items.

- Cross-file service, failure-contract and migration examples could report `TS5097` before demonstrating their intended behavior. They now use runtime import names or explicitly enable source imports where required.

- `vibelang --fix` converting an `Effect.fn` whose context names a wider `Effect` type, such as a plugin object written `define({ effect: Effect.fn("P")(function* (ctx) { … }) } satisfies InternalPlugin)`, wrote that context's type as the converted function's contract, so the declaration took the context's wider types: a plugin named every service its host allows (`Plugin<Scope | Requirements>` where TypeScript declared `Plugin<Scope | Model.Service>`), and a caller's test failed `TS2345`. The contract is now the `Effect` type TypeScript infers for the call, so the declaration matches the TypeScript one.
- Preparing a fresh checkout left the bundler plugin’s source-map dependencies uninstalled. Preparation now installs the plugin’s locked dependencies while preserving shared dependency links.

- A call as the operand of a relational pattern, such as `when <= limit():` or `x is < limit()`, reported a misleading `TS1005: '=>' expected`. It now reports `EK0707`, which says to compare the value in a guard: `when let v and if (v <= limit()):`.

- Migrating a plain generic function that returned an Effect could leave a retired inference marker in its return type. The repair now uses the returned program's channels and preserves real callback errors and service requirements.
- Checking the diagnostic reference could report a missing code that no compiler emitted. It now resolves a mapper diagnostic code from the constants in its own package.
- In effect code, a call of a `.ts` function documented with an empty `@throws {}` tag was treated as never throwing, so a throw became a defect without any diagnostic. Such a tag names no thrown type, so the call now needs a bridge (`EK0403`), as with no tag at all.

- A pattern that named `import.meta` or `new.target`, such as `when import.meta.url:` or `when === new.target:`, failed to parse. Both now start a pattern's member expression, as the pinned pattern grammar allows.

- Calling a foreign function with `?.()` could bypass throwing-call checks when its own result was an `Effect`, `Stream` or `Layer` combined with `null` or `undefined`. Optional calls now keep that nullable return contract and require the same bridge as ordinary calls.

- A migration revert or compile in a repository whose root `tsconfig.base.json` has `allowJs` and no `include` stopped in reference planning with `unsafe project output: packages/fly/lib`: TypeScript's default include made that options-only config list every emitted `lib/*.js` and `lib/*.d.ts`, and each listed file counted as a source to protect. Untracked JavaScript and declarations that only configurations outside the rebuilt graph list now count as outputs, so the refresh clears and rebuilds them; tracked files and untracked TypeScript sources still refuse the deletion.
- Checks of generated bundler modules could stop when loading a source-map helper. They now load the plugin’s declared helpers and check the generated modules.

- A Vite config with a nested `root`, such as `root: "web"` with `vibelang({ project: "../tsconfig.json" })`, failed to load the project's modules outside that root: `core/Leaf.vibe is not part of tsconfig.json. Add it to the tsconfig's include.`, though the include listed it. The project now compiles from its package's directory, so every module it includes loads. The same applies to the bundler plugins of `vibelang-unplugin`.
- Wrapping a recursive reverse-mapped value in a returned object could truncate its inferred declaration too early. Declarations now preserve the TypeScript 5.9 and 7.0 structure before eliding the cycle.

- A source outside a bundler's compilation root could be reported as excluded from a project that already included it; the error now identifies the root boundary and explains the supported setup.
- The migrate flow's platform split refused a module when a kept statement above an export ran any moved code while the module loaded, even code that never reads the export, such as a schema above a copied `export const defaultPathExtensions = "…"`. It now refuses only when that code reads the export, the one case where the original reads it before it exists, and the refusal for a copied constant no longer says it uses platform code.
- The migrate flow's `<Name>.platform.ts` sibling had no module header and wrote `export` into each private helper the module calls, so a repository that requires a header and JSDoc on exported declarations, such as Smithers, failed its lint on the generated file. The sibling now starts with the module's header and exports those helpers in an `export { … }` after the moved code, which stays as written.
- The migrate flow's platform split refused an export with an inferred return type that might name a private type or class moving to `<Name>.platform.ts`. The sibling now exports that declaration so the module's declarations can name it; the module gains no export.
- Migration kept a module in TypeScript when its platform code read an export that is not a function, such as an error class, a schema and the type of its name, or an object. The `.platform.ts` companion now declares such an export and the module re-exports it, so the export keeps its identity, type and documentation; the companion's declaration file ships with the package and is added to no `exports` entry.
- Importing a source file and its JavaScript sibling could load the JavaScript file twice; each import now loads its own file.
- Vite development imports and hot updates could fail or load stale contents for filenames containing percent escapes; these files now load and update with their original source maps.
- Migrating a host constructor such as `new Response(...)` could leave its module in TypeScript when the diagnostic named `globalThis.Response`. Both companion-file and module-body migrations now recognize the original bare constructor while preserving local bindings.

- A saved declaration alongside a migration example could make a valid quick fix fail verification. Saved declarations now stay separate from the sources the fix must produce, and mismatches name the unmatched source files.

- `vibelang --fix --only` refused the platform repair of a listed module ("--only does not list x.platform.ts, the new sibling TypeScript module"), and a later rewrite then left the host read where no fix applies, so a migrated module such as `export const value = Effect.sync(() => process.platform)` went back to TypeScript. `--only` now creates the listed module's new `x.platform.ts` companion, as plain `--fix` does, and still never writes a file that exists.
- `vibelang --fix` left an `Effect.gen` unconverted when its body piped through a custom stage and then an Effect stage with a callback, as in `.pipe(followUp, Effect.flatMap((exit) => ...))`: it built every stage apart from the program, so the callback parameter was `unknown` and the rewrite was refused. Effect stages whose arguments are functions, literals or constants now stay in the pipe with the program first, so their callbacks keep its types.
- Checkout installation checks could report a missing scaffolder directory. They now include the scaffolder and verify that its supplied dependency links stay intact.

- The duplicate-package diagnostic example could request an unsupported Effect version. Both fixture packages now use the runtime's exact supported version.

- An explicit `try` in a computed method name could be skipped in TypeScript mapper output. Key Effects now run once in the defining context, while method bodies stay deferred and untried Effects remain cold.

- The migrate flow's lost-wrapper check flagged every export the platform split keeps as a wrapper that calls the moved function in `<Name>.platform.ts`, since a program handed back through a call counts as no Effect. Such a wrapper now pairs through the moved function, and a wrapper that does anything else is still compared.
- `vibelang --fix` could leave a retired `: infer _` return annotation on a plain callback after switching to native `callback`. It now removes that annotation while preserving ordinary return inference.

- Callback migration examples could pass a plain value to native `resume`. They now pass an Effect and show how an explicit runtime import keeps the legacy adapter.

- Diagnostic examples could fail to run after their historical inputs were checked. The reference now replays the current inherited-error diagnostic and the earlier rejection of archived control declarations.

- The cheat-sheet example for wrapped platform calls was still marked unavailable even though it compiled. It is now checked as a runnable example, including its documented output.



- Native TypeScript importers could lose exported types after migration when compatibility declarations were emitted from a monorepo ancestor. Bundler routes now select the existing declaration file for that layout.

- An `is` binding in a call argument could make the TypeScript mapper report overlapping edits and emit no JavaScript. It now projects the argument and its bindings with valid source locations.

- The compatibility diagnostic reference gave vague instructions for starting a provided program. It now names `runPromise` at the entry point.

- Updating a VibeLang dependency could reload the whole Vite page even when an importer accepted the update. Accepted updates now preserve the page and its state.

- The selected page-outline link was too faint in the light theme on wide screens. Active links now meet the text contrast requirement.

- Imported Effect lint codes were missing from the user diagnostic reference. Every imported rule now lists its full code, default category and repair messages.

- TypeScript mapper errors had no complete user reference. The diagnostic guide now explains projection, configuration and dependency failures and how to recover.

- The home page hid its installation commands on narrow screens. The npm and Bun commands now stay visible and selectable on phones.

- Setting `VIBELANG_BINARY` to the JavaScript launcher could repeatedly start new compiler processes. It now stops once with guidance to select the native compiler.

- A compatibility sidecar such as `main.d.vibe.ts` kept a written `./App.jsx` or `./App` import of `App.vibex` as written, so plain `tsc` reading the sidecar reported `TS2307`, and a sidecar under `vibe.sidecarDir` named `../../App.vibex` instead of the mirrored declaration. Sidecars now name `./App.vibex` for every import that reaches it, as they name `./user.vibe` for `user.vibe`.

- Bundlers could load the wrong file when one module mixed a source import with a literal JavaScript import containing percent escapes. Each import now loads its own file.

- Replacement suggestions for `console` calls omitted `try`, leaving logging unrun when copied into effect code. They now show the runnable Effect call.
- HTTP replacement diagnostics could suggest constructing a request without running it. They now show `try HttpClient.get(url)`.
- The platform globals table showed `try repeat(program, Schedule.spaced("1 second"))` for `setInterval`, which waits for the repetition, while the diagnostic shows `fork effect { try repeat(program, Schedule.spaced("1 second")) }`. The table now shows the background repetition the diagnostic suggests.

- A `.vibe` or `.vibex` file could import `./x.vibe` or `./x.ts` without `allowImportingTsExtensions` or `rewriteRelativeImportExtensions`, where the same import in a `.ts` file reports `TS5097`, and its emitted JavaScript named `./x.js` even without `rewriteRelativeImportExtensions`. VibeLang sources now follow the `.ts` rules: such an import reports `TS5097`, and only `rewriteRelativeImportExtensions` rewrites it in JavaScript. Set `allowImportingTsExtensions` (with `noEmit` or `emitDeclarationOnly`) or `rewriteRelativeImportExtensions` in `compilerOptions`, as for `.ts` imports, or import `./x.js`.
- `vibelang --fix` left the Effect language-service plugin entry for a second run when the same config also held the retired `declarationSidecars` setting, so running it again changed the config. One run now makes both config repairs.
- Exporting `main` could start it without a call or report missing services before a caller supplied them. Unmarked modules now run only their written top-level code; a written runner controls startup and checks its service requirements.
- Migration could miss a public type change when an unchanged handwritten source declaration hid a different published copy. Declaration checks now compare the published copy itself.
- An object pattern could reject a computed key such as `[chooseKey()]` as unsupported syntax. Computed key expressions now compile and keep their source type, evaluation order and property-key conversion.
- When migration refused previously created import routes, its report could omit the affected modules. Refusals now name those modules on repeated runs too.
- The editor status labeled the VibeLang version as a TypeScript version and repeated the TypeScript label. It now displays the server’s reported version unchanged.
- Calling a function whose return type is an interface named `Effect` that copies Effect's `~effect/Effect` marker without declaring its type parameters crashed the compiler. Such a value is now ordinary data, and the call follows the usual throw-contract rules.

- A relational pattern such as `when <= limits.max:` or `when in table:` evaluated its operand, running a getter or index read, even for a subject that could not match, such as an object for `<=` or a number for `in`. The subject's type is now tested first, so the operand runs only for a string, number or bigint, or a property key for `in`.

- An explicit `try` inside a scoped fork operand could be skipped in TypeScript mapper output, leaving the child to return a cold Effect. The operand now runs the written `try` before forking its result.

- Returning an incomplete `Stream` type could bypass throwing-call checks or wrongly restrict a plain function. The compiler now applies `Stream` rules only to a complete `Stream` type.

- A `String`, `Number`, `Boolean`, `BigInt` or `Symbol` pattern narrowed an `unknown` subject to the primitive type alone, so `when String and { length: let n }:` was rejected because the subject became `never`, and `not String` kept the boxed type. The subject now has the primitive or its boxed type, as after TypeScript's `typeof s === "string" || s instanceof String`. Code that used the subject as a primitive after `when String:` binds the value instead: `when String(let text):`.

- An unmarked function or method whose Effect return annotation wrote a channel as `infer`, such as `function load(): Effect.Effect<number, infer E> { return Effect.fail("missing") }`, took that channel from an effect body instead of from the Effect it returns. Its declaration, its `EK4857` quick fix and `vibelang --fix` could write a wrong type, such as `never` for `E` or an Effect nested in an Effect, and report a spurious `TS2322`. Each `infer` channel now takes the returned Effect's channel, so the fix writes `Effect.Effect<number, string>`.

- Joining a fiber in TypeScript mapper output could trigger marker traps on a proxy handle. It now calls the project's `Fiber.join` directly, preserving native observations.

- Converting an `async` function could move a `throw` in an awaited expression into a plain callback and produce a compile error. The editor now withholds that conversion while keeping throws inside nested `async` functions eligible.

- Converting an `async` function could move a jump in an awaited `do` expression into a `Promise` callback, changing its target or producing invalid code. The editor now withholds that conversion while keeping local jumps eligible.

- Services in packages with an empty name used the directory name in their keys. Keys now retain the empty package prefix, and the legacy migration writes explicit keys to keep existing service identities.

- Knip could miss duplicate exports created by `export default value`. It now reports those aliases as TypeScript does.

- The platform globals guide omitted `Buffer.byteLength` and could drift from diagnostic advice. It now shows UTF-8 byte counts and checks every replacement while retaining native-behavior caveats.

- The platform introduction showed an HTTP server layer as an Effect, and its checks rejected valid replacement examples. It now launches that layer with `Layer.launch` and checks complete calls, pure helpers and their layers.

- File-list lint runners could return no usage text for `--help` or mix findings into `--print-config`. They now return the requested information without linting input files.

- Node stack traces from esbuild bundles could show escaped or altered source filenames. They now preserve Unicode, spaces and literal percent sequences at the original source position.

- Calling a value typed `any` or `Function` in an Effect function’s or producer’s parameter default could bypass the no-throw check. These calls now report `EK0401` because their thrown type is unknown.

- An unannotated foreign function returning a Promise could bypass the no-throw check in an Effect function’s parameter default or a plain factory returning an Effect, Stream or Layer. These calls now report `EK0401`, since they may throw before returning the Promise.

- JSX imports could fail in bundlers with missing-loader or module-resolution errors. Explicit JSX sources, module queries and rewritten dependencies now build with the project's JSX settings and original source maps.

- A `for` loop update that read an `is` binding from the loop test reported `TS2454` even when the binding was typed `any`, `unknown` or `void`, included `undefined`, or was read with `!`. The update now follows TypeScript's definite-assignment exemptions, and still reports `TS2454` for other types.

- A `while` condition that held a binding `is` below `||`, `!`, a conditional or a call argument, such as `while (done || (next() is let v))`, was rejected with `EK4703`. It now compiles, and each evaluation of the condition gets fresh bindings that its body shares, as for any other `while` condition.

- `vibelang --fix --fix-vip-only` kept the `try` before a legacy wrapper whose success data was an Effect value, such as `function make() { return Effect.void }`, so the migrated call ran that Effect instead of returning it. The migration now removes that `try` and writes none before such a call; a wrapper whose returned call ran, such as `return Effect.succeed(7)`, keeps its `try`.

- TypeScript-mapper output could reject an Effect run in a `for concurrent` head default or computed key. Head initialization now runs inside each item's Effect, with the body in its own scope.

- The migration kept a module in TypeScript when a top-level statement read the host, such as `if (process.env.FLAG) { … }` or a runner's `NodeRuntime.runMain(…)` reading `process.argv`, because that statement cannot move into a `module` body without running early. The statement now stays where it is, and only its host reads and writes move into the body as helpers it calls in place.
- The migrate flow kept a module in TypeScript when `EK4402` reported a host global read through a cast, such as `(globalThis as { readonly location?: … }).location is platform code`, because the platform split read no global from a message that starts with the cast. It now reads the cast's global and moves the declarations that read it to `<Name>.platform.ts`.
- After an unresolved import was repaired, Rollup could stop responding to later edits. It now keeps rebuilding source and type-only changes through error recovery.

- Converting a named Effect generator could narrow a generic service requirement and change its public type. The converted function now keeps the original requirement, including through pipeline stages.

- Generic data declarations could gain unnecessary helper suffixes when a matching name appeared only in an object or class member. Generated declarations now keep the first free helper name.

- Using `yield` in a returned match or a match statement could crash the compiler. These forms now retain the surrounding generator's variables and suspend normally.

- Migrating an Effect generator with an old `: infer _` annotation in a nested TypeScript callback could leave `TS1338` errors. The fixer now removes the retired annotation and preserves the callback's inferred result.

- Formatting many JSX or marked TypeScript files started a formatter process for every file, even on repeated clean checks. These files now share batch runs, and a clean cached check starts no formatter process.

- The migrate flow kept a module in TypeScript when a provider that read the host also read a value with a type of the same name, such as a resource and its interface: moving the provider took the value, its type and so every value of the module. The module now keeps all its declarations, both meanings of the name included, and only the host calls and reads move into the module body.

- A loop that updated a narrowed URL could report `TS7022` on a response and `TS18048` on the URL. Calls with a known return type now preserve TypeScript inference and narrowing.

- Migration could stop when the same declaration appeared with and without a source-map comment. Matching declarations now compare successfully while type and documentation changes still fail.

- A formatter failure in a batch could omit the input filename. Formatter commands and `formatSource` now identify the original file, including marked TypeScript files.

- The migrate flow's platform split left a private type in the module after moving every reader of it to the `.platform.ts` companion, such as `type Entry` read only by a moved `load`, so the module failed `noUnusedLocals` (`TS6196`). The split now leaves such a type to the companion, and keeps every type the module still reads.
- Migration kept a module in TypeScript when an exported function threw in plain code, unless the run set `platformModuleBodies`. The function now moves into the module's `module throwing { }` body and the module re-exports it; the body's declaration file ships with the package and is added to no `exports` entry.
- `vibelang --fix` rewrote `Effect.sync(() => { ... })` with a block into an `effect` block or function, which the compiler builds with `Effect.gen` or `Effect.fnUntraced`, so a converted module built a wrapper its TypeScript did not and the migration's run-phase check returned it. Such an `Effect.sync` now stays as written; `Effect.sync(() => value)` still becomes `effect { return value }`.
- A migration on a compiler before plain-function inference wrote a `Generator<...>` return type on generators handed to `Effect.fn`, which erased their requirements, so a provider layer declared `unknown` where TypeScript declared its services. The migration now leaves an Effect's generator body unannotated.
- Migration kept a module in TypeScript when its platform code found files beside the module through `dirname(fileURLToPath(import.meta.url))` or `import.meta.dirname`, because moved code must not read `import.meta`. The `.platform.ts` companion shares the module's directory, so such code now moves; code that reads the module's own file name or `import.meta.main` still stays.
- `vibelang --fix` checked every file of the project for each set of fixes it tried, so a 25-module batch of a 5,510-file project took about 15 minutes and 18 GB. It now checks only the files the fixes change and the files that read them, which a check of the whole program confirms whenever a fix adds an error, and writes the same fixes; the run's last stderr line says what it cost.
- Checking the compact language guides rejected current descriptions of foreign calls and `Effect` factories. Checks now recognize that guidance while still rejecting missing failure rules.

- A throw expression stored as an array element, an object field or a binding, such as `[a, throw e]`, reported warning `EK1012` as if it were a call that never succeeds, and its suggestion added `()` after the throw. A throw expression no longer reports `EK1012`.

- File-list lint commands accepted `--fix` but left source findings unchanged. They now apply source fixes to the selected files and report what remains.

- Creating a missing source file could leave Vite's error overlay open. The page now recovers automatically, including after deleting and restoring an imported source.

- Linting TypeScript containing JSDoc type operators could stop with an unsupported node error. The lint parser now preserves the stock parser's nodes and source ranges.

- Lint rules could read numeric concurrency limits as variable names. Limits now keep the token kinds written in the source.

- The formatter companion ignored help requests and mistyped options, and formatter commands accepted conflicting modes. Both commands now show help, reject invalid options and mode combinations, and keep explicitly ignored files unchanged.

- Bun could load the wrong sibling file when a module mixed source-extension and `.js` imports for percent-containing filenames. Each import now keeps its own target.

- Imports between `.vibe` files with Unicode, spaces or `%` in their names could fail in bundler builds. They now resolve to the original source files.

- Bun watch mode could keep passing stale tests after an imported VibeLang file changed. It now watches those source files and reruns tests after changes and recovery.

- Oxlint could fail with a valid project loader in `NODE_OPTIONS`. Linting and configuration output now keep the loader working.

- Health reports could mistake output from an expected test failure for a real resource failure or timeout. They now show file-level output separately from attributed test errors.

- Multiline warnings could lose source excerpts containing a library URL; the complete warning now stays visible.

- Project-reference builds accepted `--generateTrace` without creating trace files. They now write trace events, type data and a legend for every project they compile.

- The migrate flow kept a published package's platform code in TypeScript when its export map had a wildcard naming a fixed file, such as `"./*/neon": "./dist/*/neon.js"`, although such an entry can never publish a `.platform.ts` companion. Those packages now get the companion, as packages with explicit exports do.

- The migrate flow kept a module in TypeScript when a declaration that reached the platform also read `import.meta`, such as a resource's `main: import.meta.url`, and its sibling split could move such code so that `import.meta.url` named the `.platform.ts` companion. The declaration now stays in the module and only its host calls and reads move into the module body, so `import.meta.url` still names the module.

- `vibelang --fix` left an `Effect.gen` or `Effect.fn` generator unconverted when it tested a type predicate from a TypeScript module, such as `if (!isRecord(body)) return …`, because the converted test kept only the boolean and `body` stayed `unknown` (`TS2339`). The fix now keeps the predicate's proof in a `const` that the guarded code reads, and converts the generator.
- `vibelang --fix` left an `Effect.gen` or `Effect.fn` generator unconverted when one of its throwing calls read a property that a guard had proved, such as `content.text ? Lifecycle.textDelta(content.text) : 0`, because the converted call lost the guard's proof (`TS2345`). The fix now moves the guard into the call's wrapper, or reads the property into a `const` before the statement, and converts the generator.
- A migration on a compiler before plain-function inference wrote `: infer _` into a TypeScript `module` body and into callbacks of an object passed as an argument, such as `Effect.try({ try, catch })`, so the module failed with `TS1338` or its `Effect.gen` repair was refused. The migration now leaves those functions as written.
- The installation guide asked existing projects to run an undefined `dev` script. Its command list now uses the `start` script supplied by the setup.
- After the compiler started rejecting possible throws in plain functions that return an Effect, a migrated file whose launcher used the generated child-process loader helper failed with `EK0401`. The helper now declares `@throws {never}` and launches with the written arguments when the VibeLang loader cannot be resolved.
- `vibelang --fix` left an `Effect.gen` or `Effect.fn` generator unconverted when one of its `.pipe` stages came from a call into a TypeScript module, such as `effect.pipe(instances.provide(session))`, because the converted program left that call unwrapped (`EK0403`). The fix now writes the stage call through the same defect bridge as the generator's other throwing calls.
- The migration's lost-wrapper check listed a pipeline callback as unpaired after the migration inlined it into the surrounding `effect { }` block, so the module stayed unqualified. The check now reports such a callback as inlined while its holder is still a program, and still flags a holder that lost its program.
- The migration's lost-wrapper check could not find a function the migration had moved into a `module` body, so it listed every such Effect-returning function as unpaired and the module stayed unqualified. The check now reads the body's emitted JavaScript and pairs those functions, and it still flags one that lost its wrapper.
- `vibelang --fix` left an `Effect.gen` unconverted when its body piped a stream through `Stream.runForEach`, `Stream.runDrain` or `Stream.runHead` into an Effect stage, as in `rows.pipe(Stream.runForEach((row) => ...), Effect.forkIn(scope))`: it treated the stage as a runner, wrote it apart from the stream, lost the callback's parameter type and refused the rewrite. It now writes `rows |> Stream.runForEach(%, (row) => ...) |> Effect.forkIn(%, scope)`.
- `vibelang --fix` left an `Effect.gen` unconverted when its `.pipe` had a stage whose options are built by a call, as in `Effect.gen(...).pipe(Effect.withSpan("named", attributes(name)))`: it wrote the new `effect` block after the captured pipeline, outside the function, where `name` read the host global, and refused the rewrite. It now writes the block inside the captured pipeline.
- The ESLint pass for `.vibe` files ignored an `oxlint.config.ts` and linted with typescript-eslint's recommended rules instead, so it reported rules such as `no-empty-object-type` that Oxlint does not run on the `.ts` original. It now reads a TypeScript or JavaScript Oxlint configuration through installed Oxlint, and where Oxlint resolves the rules it adds no recommended rules of its own.
- Cleaning build projects through `vibelang lint` could delete existing outputs. It now reports the files without removing them.
- `vibelang lint --init` could create a configuration file. It now previews initialization and leaves files unchanged.
- `vibelang lint` could switch configurations and reject compiler options when an old lint flag was present. It now uses compiler options consistently and reports old lint flags as unknown options.
- An inferred declaration could name a private package subpath blocked by `exports`, causing `TS2307` in TypeScript consumers. It now respects the selected export entry and uses the available public type.
- `vibelang --fix --only` refused a list naming a file outside the project with `lists 1 file that is not .vibe module of this project`, which left out `.vibex` modules. It now says `lists 1 file that is not a .vibe or .vibex module of this project`.
- The callback example could fail to compile because a direct `callback` call expected a plain completion value. Direct calls now use Effect's callback signature and accept the Effects passed to `resume`.
- Under `NodeNext`, an import of a `.vibe` or `.vibex` module written without an extension reported `TS2834` with no suggestion. It now reports `TS2835` with the runtime name to write, such as `./user.js`, as TypeScript does for `.ts` and `.tsx` modules.
- With `vibe.sidecarDir`, a `module` body's declaration stayed beside the `.vibe` file, so a relocated sidecar named it through a path that broke when the sidecar directory was copied or published alone. The body's declaration is now written beside the relocated sidecar, and stock `tsc` resolves it from there.

- The editor's move-module refactor was titled for `.ts` files only and always appended `export {}` to a body without imports or exports, even where the copied file was already a module. It is now **Move module to a TypeScript file**, as it also writes `.tsx` files, and adds `export {}` only when the copy would otherwise be a script.

- The migrate flow sent a module back to TypeScript with `EK4402` when it read `import.meta.filename`, `import.meta.dirname` or `import.meta.env`, or called `import.meta.resolve` with a computed or second argument. It now serves these reads from the `.platform.ts` companion, passing the module's own `import.meta.url` where the value names the module, so `main: import.meta.filename` still names the module after migration.

- A migrated lint runner could drop JSX files in its extension filter before linting them. Setup now includes JSX source, preserves directory scope, and repairs filters from earlier setup runs.

- A lint suppression containing only a reason could still report warnings after upgrading Oxlint. Suppressions now follow the installed Oxlint release on both TypeScript and VibeLang source.

- A file-list lint command could succeed when an explicitly named source file did not exist. It now reports the missing path and exits with an error.

- Errors from source loaders could include a long list of the compiler’s standard libraries. They now show only the diagnostic and its source details.

- Bun could fail to import a VibeLang module whose filename contained `%`, `#` or spaces through another module. Those imports now resolve to their original source files.

- Requesting a CPU profile could finish successfully without writing a file. Compilation and project builds now write the requested profile and report output-path errors.

- Formatting a file in a bracketed route folder could select another file or leave the requested file untouched. Both formatter commands now select existing file paths before expanding globs.

- Migration kept a module in TypeScript when an exported function that used platform code had no written return type, such as `export const digestNpmrc = async (npmrc: string) => { ... }`. The function now stays in the module with the same inferred type and calls its `.platform.ts` companion, unless that type could name something only the companion declares.
- Matching a branded primitive could incorrectly report a missing tag case. Broad primitive intersections now keep the match open, while tagged object intersections still check missing cases.

- Checking invalid JSX could silently succeed after checking the same text as plain VibeLang. Formatter cache entries now distinguish the source kinds and report the JSX error.

- Using `do` in a pattern condition could falsely report a binding as unassigned. Successful conditions now retain their initialized bindings.

- Passing a relative profiling or trace path with a project build could crash the compiler. Build-mode path options now resolve from the working directory, like ordinary compiler options.

- The compiler help suggested configuring retired package-trust settings. It now identifies the legacy diagnostics section and points to `vibe.severities`.

- A declaration whose inferred type held a reverse mapped type that met itself again, such as the result of `deep(node)` where `deep` takes a recursive mapped type and `node` refers to itself, failed with `TS5088` and declared nothing. It now declares the repeated type as `/*elided*/ any`, as TypeScript 5.9 and 7.0.2 do.

- Awaiting an Effect inside an async generator could miss its error when an iterator return type was written. It now reports `EK0103`; `--fix` keeps the Effect unrun across the native `await`.

- Typed lint could lose types imported from `.vibe` modules and report unsafe uses in valid code. It now keeps those types and fails when a source module has errors.

- An invalid native profiling directory could crash the compiler and print a stack trace. Profiling setup and output failures now report the failed stage and path as ordinary command errors.

- Asking for language-server help returned an error exit status. `vibelang --lsp --help` and `-h` now print usage and exit successfully without starting a server.

- Language-server help advertised named-pipe and socket transports that the server could not use. It now identifies these options as reserved and states that standard input/output is the supported transport.

- A `.vibe` file importing a `.vibex` module as `./App.jsx`, `./App.js` or `./App` wrote a compatibility sidecar that kept that specifier, so plain `tsc` reading the sidecar reported `TS2307`. The sidecar now names `./App.vibex`, which resolves to its `App.d.vibex.ts`.

- The editor reported a `var` in a `do` expression twice, once as `EK0107` and again as `EK0201` or `EK0203`. It now reports only the `do` diagnostic for that declaration.

- A migration batch whose module took `vibelang --fix`'s platform repair failed its verify step on the new `x.platform.ts`, reported as a file outside the batch, and a revert left that file behind. The migration flow now records the compiler's companion with its module, formats it with the batch and removes it when the module is reverted.
- The token-count method incorrectly said no Effect comparison imported `effect` and every VibeLang example was self-contained. It now describes the imports and shared declarations included in the comparison.

- Knip could report a used export as unused when a namespace member was read through brackets. Bracket reads now retain the same exports as in TypeScript.

- The application entry example kept running instead of reaching its shown cleanup output. It now finishes after one check and explains how to keep a worker running.

- A documentation example could go unchecked when a comparison fragment repeated its companion file's name. Companion imports now keep their filenames and the complete example is checked.

- The platform globals guide presented a working module-loading adapter as unavailable. It now shows the supported example and its result.

- The JSON Schema guide said JSON-string codecs omitted their embedded schema. It now shows and explains the generated `contentSchema`.

- The Alchemy guide's test command failed in a new project because no test script was configured. The guide now supplies the script and the example files it runs.

- Logger examples in the cheat sheet could fail the platform-global check when run. They now write through Effect's console service.

- Following the Alchemy install guide could select an incompatible Node helper and stop compilation. The guide now pins that helper before installing dependencies.

- The browser entry guide used a crypto API that no longer compiled. Its HMAC example now uses Effect's crypto service and browser layer.

- Migration kept a module in TypeScript when its platform code read an exported constant such as `export const MAX_QUEUED_FRAMES = 64`, because the platform split could only keep exported functions in the module. The constant now stays exported in the module and the `.platform.ts` companion gets a private copy, unless kept code above it could run the platform code before the constant exists.
- Asking for help, the version or configuration with `--fix` could fail or rewrite project files. These commands now run without applying repairs, and initialization no longer requires an existing project.

- Formatting a missing file or a glob with no matches could report success. Explicit unmatched inputs now fail with a path diagnostic before any files are changed.

- Expo exports could fail with `module is not defined in ES module scope` after following the Babel setup. The guide now gives the CommonJS configuration a `.cjs` filename.

- Following the Node test setup could report an uncalled VibeLang function as covered. The setup now enables source maps for the test controller, so coverage counts source functions and enforces their thresholds.

- A bundler in watch mode could stay failed after you created a missing imported source. It now rebuilds when that relative source appears.

- Setting up coding agents with a missing target directory could print an uncaught exception. The command now reports the target error and asks for an existing project directory.

- Installing the compiler while the earlier error notification was open could leave the editor unable to start or restart the language server. Activation and restart now complete without waiting for that notification to be dismissed.

- Creating a project at an invalid or unwritable path could print an internal stack trace. The starter now reports the destination and filesystem error code with recovery instructions.

- An edit made just after the starter's first output could be missed by `dev`. The starter now waits for the compiler watcher before starting Node, so that first edit rebuilds and restarts the program.

- Formatter syntax errors showed a line and column without the filename. Both formatter commands now identify the original file and leave its contents unchanged.

- A refused fix created by an earlier rewrite could not be checked against its intermediate source. An optional local audit now retains that source and the refusal's exact span and fix round.

- A starter installed with Yarn Classic could fail its first build and source tests with `EK3201` after choosing a newer platform helper. New projects now keep that helper on the required version with Yarn's `resolutions`.

- Interrupting a check or build could report success. It now exits unsuccessfully and explains that compilation was cancelled.

- The resource quick fix could replace the caller’s scope when an Effect used a broad requirement such as `object`. It now leaves that code for manual conversion.

- Health reports could omit failing tests whose names contained only whitespace. Reports now retain those names and their failure counts.
- The foreign-call guides required an exception bridge even for Effect-returning functions, which could leave an unrun Effect as the result. The guides now exempt effectful returns from foreign throw tags and show when to run the returned program.
- The error guides described plain-function throws as JavaScript exceptions or defects. They now explain the compile error and show how to choose a typed failure or defect.
- The Terminal guide gave conflicting advice about Ctrl+C during line input. It now distinguishes normal line input from raw key events.
- The sandbox inspection example could fail to compile because its diagnostic added another error type. It now preserves the original domain error channel and runs as shown.
- The Data guide said object patterns were still awaiting compiler support. It now describes the patterns without that outdated warning.
- The expected-errors guide repeated its static-member restriction. It now gives the rule and all repair details together once.
- The migration's API identity check could not compare a package entry point declared by a handwritten `.d.ts` beside a plain `.js`, which the package build copies to its declaration output, so it refused every module of that package, changed or not. The check now reads that declaration where the package publishes it, and still reports a change to it.
- A `.vibe` class that implemented an overloaded interface method, such as Effect's `Pipeable.pipe`, with fewer overloads reported `EK0402`, although TypeScript accepts the class. The check now pairs overloads as TypeScript does: a VibeLang method passes, and an untagged TypeScript function still reports `EK0402`.
- A TypeScript module that reached a `.vibe` module through a migration route, `#vibelang/emitted/…`, kept the route in its compiled JavaScript and declarations. Published declarations then named a file the package does not ship, and the program could load a second copy of the module. Compiled output now names the module's own output, `./user.js`.
- Migration's record emit could commit a `#vibelang/emitted/…` route that a published package's declarations named, so the package built, but its consumers could not resolve the import. When compiled declarations still name a route, the emit now restores that package's routes and reports the declaration files.
- `vibelang --fix --pprofDir <dir>` profiled only the compile after the repair, so a slow `--fix` run had no profile of its own checks. It now also writes the repair's CPU and memory profiles to `<dir>/fix`.
- Migration setup could omit a test package that imported a migrated module through a relative path. It now selects that package and its transitive consumers, even without a manifest dependency.
- The error guides described working error and producer syntax as a future feature. They now describe the syntax as available.
- The setup guide required Node 26, while the introductory guides admitted unsupported Node versions. All three now give the package requirements: Node `22.22.3` in `22.x`, or `24.11.1` or later.
- The periodic-stream guide showed a supported example as unavailable. It now demonstrates collecting timestamps with a working interval stream.
- The fallback guide gave the wrong diagnostic for throwing calls in plain handlers. It now identifies `EK0401` and the effect-handler repair.
- The Exit guide marked working constructors as unavailable. Its example now demonstrates both success and failure exits.
- The throw-expression example used a statement instead of an expression. It now shows a missing-value fallback with `?? throw` and checks both outcomes.
- Copying the TestClock guide's Vitest configuration into a starter rejected test files as outside the project. The guide now selects the starter's test configuration.
- The runtime guide's logger example failed to compile because it called the platform console directly. It now uses Effect's console adapter and runs with the documented output.
- Following the Data guide could report an unknown option for migration-only fixes. The guide now includes the required `--fix` flag.
- The services and layers guides described available forms as awaiting compiler support. They now describe those forms as available.
- The timing examples could reject their output code as a fiber operation outside an effect function. They now join the fiber before formatting its result.
- The basic Schema examples appeared unfinished and included invalid runner code. They now run and display the documented results.

- Generating `throws.json` inspected implementation bodies for values that cannot be called. It now resolves sources only for callable exports, keeping the same contracts.
- Following the Effect upgrade steps could stop the build with `EK3201` because the Node helper still used the old version. The guide now updates its pin before installing packages and running checks.

- File-list lint commands could skip JSX source or check the wrong files for a TypeScript JSX glob. They now lint `.vibex` files with the requested scope and exclude their generated declarations.

- Formatting an npm-installed project could fail to find the formatter plugin. Editor formatting, format on save and the formatting commands now resolve the installed plugin correctly.

- Health reports could mistake words in test names or expected failures for disk, process or timeout problems. Reports now classify structured failures from their diagnostic text.

- The editor and TypeScript mapper treated producer function expressions as JavaScript generators. They now preserve their lazy `Stream` behavior for anonymous, named and nested expressions.
- `try.race`, `try.any` and `try.allSettled` could reuse surrounding fiber IDs when the project and runtime loaded separate Effect copies. They now use the project's Effect instance, and settled operations keep working when a local variable is named `Effect`.
- Producers could reuse surrounding fiber IDs when the project and runtime loaded separate Effect copies. They now start their bodies with the project's `Stream.callback`.

- A producer method after a class field without a semicolon could disappear from the editor's TypeScript output or fail to emit. The mapper now keeps the field and method separate.

- Adding VibeLang with Bun could disable a project's existing dependency resolutions. The install guides now add the Effect helper pin to the table Bun already uses.

- A health report could show space-padded or tabbed test names as the same name. Reports now preserve their spacing in both test tables.

- Test names containing Markdown formatting or HTML-like text could look different in health reports. Reports now display those names literally.

- A health report could lose points when several targets failed tests with the same name. Repeated names now count once when the report is graded.

- A project reference could lose members inherited from a TypeScript module body and report a missing property. Built body declarations now keep those members available.
- Following the pnpm install guide could select a newer Node helper and report incompatible Effect peers. The guide now puts the transitive pin in `pnpm-workspace.yaml`.

- Following the Yarn install guide could stop compilation with `EK3201` after selecting a newer Node helper. The guide now pins that helper with Yarn's `resolutions` setting.

- Migration could keep files in TypeScript even when Bun already used the published native-module preload. It now recognizes that preload and distinguishes ordinary Bun programs from test-only configuration.


- The `using` resource quick fix could erase an existing `Scope` requirement by introducing a new scope. It now withholds the edit when the moved code still needs that scope.
- Object-rest bindings such as `const { ...timeout } = AbortSignal` could be rejected as platform calls. They now compile as ordinary object copies.

- A test name containing a line break could split its health-report table row and separate it from its failure count. The name and count now stay in the same row.

- An exhaustive `match` could report a missing case when its tag key was computed, including in generic functions. Computed keys that identify one property now take part in the coverage check.

- A health report could receive no usable score when an expectation was empty. Matching empty results now receive a full score, and an unexpected result receives zero.

- Adding a method or getter to an `error` or `schema error` declaration could cause false missing-case errors, reject valid extracted fields, and hide warnings for patterns with the wrong number of bindings. Those checks now keep working when an error has instance members.

- A local `const` alias of an error constructor could hide warnings for extractor patterns with the wrong number of bindings. Aliases now keep the constructor's known extraction length.

- The `for concurrent` tooltip said every item used its own fiber, even with a limit of `1`. It now explains sequential execution, and jump errors no longer give that incorrect reason.

- Migration could stop before fixing files when a dependency was outside `rootDir`. It now reads the complete source list while preserving the diagnostic for checking.

- A failed test named `__proto__` could disappear from the health report, and names such as `constructor` could have invalid failure counts. These names now keep their own counts.

- A throwing call in an `enum` initializer could be rejected even when a surrounding `try`/`catch` handled it; the handler is now recognized.

- An object tag pattern could incorrectly count primitive literal cases as covered when their wrapper interface declared `_tag`, letting an incomplete match compile. These cases now remain uncovered, and `--fix` can preserve the previous no-match error with an explicit default.
- Migration `verify` reported a `package.json` as a foreign file when the codemod moved one of its scripts to a renamed module and emission added `#vibelang/emitted/*` routes to it. Those routes are now in the batch's scope; any other change to the manifest still fails.
- Vite's dependency scan failed with `UNLOADABLE_DEPENDENCY` on a `.vibex` file with a `module` body under `"jsx": "preserve"`, because the scan read the absent `.jsx` output from disk. `vibelang-vite` now loads that output from the compile.
- Passing an Effect CLI Command through its combinators, including `.pipe(Command.withDescription(...))`, incorrectly warned `EK4802`; Commands and other data types that implement Effect now keep their data identity, while passing an unrun Effect to a plain generic function still warns.

- A throwing call used to compute a class's base could be rejected inside `try`/`catch`; the surrounding handler now covers the `extends` expression.
- Inline type re-exports and empty re-exports of Node builtins could retain unreported runtime loads. They now report `EK4402`, and `vibelang --fix` preserves those loads behind a native module boundary.


- In effect code, a call of a `.ts` function that returns an `Exit`, a `Config`, an `error` instance or another kind of Effect was rejected when the function had a `@throws` tag, and the tagged classes were added to the caller's error type. Such a function is now effectful, as one returning `Effect` is: effect code calls it directly, its tag adds no failure, and a throw before it returns is a defect.
- Nested destructuring could read a host method without a platform error. It now reports `EK4402`, and `vibelang --fix` preserves eligible leading constant bindings behind a native module boundary.

- Putting an alias of a host method in an object could hide a platform error. Object shorthand now reports the same restriction as the original host method.

- A type query of a platform-method alias could receive a platform error even though it runs nothing. Erased `typeof` queries now keep their TypeScript meaning.

- Editors could reject ordinary calls such as `Box.key()` as service access when a local object's name began with a capital letter. The TypeScript view now recognizes the ordinary binding, including a parameter that shadows a service.


- A plain function that returns an Effect, an `Exit`, a `Stream` or a `Layer` could call a `.ts` function with no `@throws` tag, although such a function must never throw. The call now reports `EK0401`: make the function `effect` and run the call with `try Effect.try(() => …)`, declare the callee's `@throws`, or move the code to a `.ts` file. The same holds for the function's parameter defaults.

- In effect code, a `new` expression or tagged template whose `.ts` constructor or tag had a `@throws` tag, or no tag at all, was not checked, although a call of the same function was. It now reports `EK0403`, and `EK0401` in a plain function that returns an Effect: wrap it with `try Effect.try(() => …)`, or declare `@throws {never}` on a constructor or tag that cannot throw.

- In a project that emits declarations, `vibelang --fix` turned a private `Schema.Struct` constant into a `schema` declaration even when the declaration file named the constant, which added `type X = typeof X.Type` to the declaration, or exported a new type through `export { X }`. The fix now keeps such a constant as written.
- With a project pinned to a compiler older than `--only`, such as VibeLang 0.0.11, the migrate flow's ordinary repairs failed with `TS5023` and each batch was reported settled with no fixes. The flow now reruns that repair without `--only` and still keeps only the batch's own files changed.

- A function with a property assigned more than once, such as `f.x = a` followed by `f["x"] = b`, got declarations that named the property twice, which TypeScript rejects with `TS2300`. The declarations now declare the property once, with the type of everything assigned to it.

- The migrate flow kept a module in TypeScript when one of its types read an exported function that the platform split moves, such as `export type Timer = ReturnType<typeof createTimer>`. The function stays in the module as a wrapper of the same name and signature, so the type keeps reading it and the module converts.
- The migrate flow's platform split moved an interface that names a host type, such as `readonly signal?: AbortSignal`, out of the module while a function the module kept still used it, so the converted file reported `TS2304`. The interface now stays in the module, and the moved code uses its own copy.
- The migrate flow kept a component or a function that returns nothing in TypeScript when its platform code read a private type of the module, on the grounds that the inferred return type might name that type. A function that returns only JSX, `null` or `undefined`, or no value, now keeps its wrapper and the module converts; a function that may return the private type still stays in TypeScript.
- With a compiler before VIP-1, the migrate flow marked a function `: infer _` when it returned the Effect of a module converted in the same batch, and the converted module failed `EK9203`. The flow now reads that module's types from its TypeScript source and keeps such functions Effect functions.

- A project that enabled `unnecessaryArrowBlock`, `unnecessaryPipe` or `unnecessaryPipeChain` through its lint code in `vibe.severities`, such as `EK38123`, got no editor quick fix for those reports, although the same checks reported as `EK4823`, `EK4824` and `EK4825` had one. A diagnostic reported under its lint code now offers the quick fixes of the VibeLang check it reports.

- A package export written by an earlier VibeLang toolchain as `{ "types": "./x.d.vibe.ts", "default": "./x.vibe" }` stayed that way after the migrate flow emitted JavaScript, so a plain `bun build` read the `.vibe` file as an asset and reported a missing export. The flow now rewrites such an entry to name the emitted JavaScript under `default` and the source under `vibelang-source`.

- The migrate flow kept a factory in TypeScript when its platform code read a private type of the module, even when the factory's return type never mentioned that type. The flow now checks the return type with the module's own tsconfig, and a factory whose result does not expose the private type converts; one that exposes it, or whose type it cannot fully resolve, still stays in TypeScript.
- After the migrate flow moved a `crypto.randomUUID()`, `crypto.getRandomValues()` or `performance.now()` call into a module body, the module still failed `EK4402` on the helper call that replaced it. Those reads now get a helper with a signature of its own, so the module compiles.

- `EK4402` on an `import.meta` member other than `url` told you to use "the Path or Config service" without naming the call that reads configuration. It now names the Path service or `Config.String`, or moving the use to a `.ts` file.
- Wrapping a recursive reverse-mapped value in a returned object could truncate its inferred declaration too early. Declarations now preserve the TypeScript 5.9 and 7.0 structure before eliding the cycle.

- The platform globals guide omitted `Buffer.byteLength` and could drift from diagnostic advice. It now shows UTF-8 byte counts and checks every replacement while retaining native-behavior caveats.

- The platform introduction showed an HTTP server layer as an Effect, and its checks rejected valid replacement examples. It now launches that layer with `Layer.launch` and checks complete calls, pure helpers and their layers.

- An Electron app built with electron-vite failed to build a web worker that imported a migrated `.vibe` module, with a parse error, because the migrate flow added the VibeLang plugin to the app's main, preload and renderer builds but not to the renderer's worker build. The flow now also adds it to the renderer's `worker.plugins` when the app or a workspace package it bundles starts a worker, including in a config it wired earlier.

- With a compiler before VIP-1, the migrate flow also marked a function `: infer _` when it returned a call into a module converted in an earlier batch that had no declaration file yet, and the converted module failed `EK9203`. The flow now leaves such a function unmarked for the compiler, which reads the converted module.
- Timer replacement diagnostics could suggest Effects without starting them. They now show a running delay or background repetition.

- The `EK4810` warning, for an assertion that drops a type from an Effect's channel, printed its "No automatic fix" note twice. It prints the note once.

- A plain `catch` handler with a written return type, such as `x catch (): number => 0` or `x catch (): Effect.Effect<number> => Effect.succeed(7)`, was rejected with `TS2322`, `TS2345` or `EK0502`: the compiler read the annotation as an `effect` function's Effect type. The annotation now types what the handler returns, as on any plain function, and the `catch` gives that value, an Effect included, unrun.

- The migrate flow kept a module in TypeScript when its platform code built a URL beside the module from a path written without `./`, such as `new URL("results/", import.meta.url)`, because it read the path as naming the module's file. Any written path that is not empty and starts with neither `?` nor `#` drops the file name, so it names the same URL from the `.platform.ts` companion, and such code now moves.

### Upgrade from 0.0.12

| Before | After and repair |
| --- | --- |
| Implicit service keys in a package with `"name": ""` | Keys now begin with `/`. Run `vibelang --fix --fix-legacy-service-keys` on existing source to retain its earlier directory-prefixed keys explicitly. |
| `await program` in an async generator with a written iterator return type, where `program` is an Effect | `EK0103`: use `await runPromise(program)` to run it, or `vibelang --fix` to retain the unrun Effect and native suspension. |
| An incomplete finite match over primitive literals whose wrapper interface declares `_tag` | `EK4701`: add the missing primitive arms, or run `vibelang --fix` to add a default preserving the previous no-match `TypeError`. |

## 0.0.12

### Bugs fixed since 0.0.11

- In the TypeScript view that editors read, `fork effect { … }` and the same block after `fork.in(scope)`, `fork.scoped` or `fork.detached` produced broken code, and a later `join` of the fiber reported that the mapper could not tell it held a fiber. These forms now project to the Effect operation they run.
- Migration could report an empty reason when it could not read a module's imports. It now reports the native parser diagnostic and compiler exit status.
- Rerunning migration setup could leave an unpinned formatter plugin in a checksum-pinned configuration. It now restores the pinned plugins and formats VibeLang through the companion command.
- Migrating a platform factory could drop documentation from an inferred exported value's members. The migration now preserves that member documentation.

- Migration API checks took hours on large packages, because every group of entry points checked the same files again. A comparison now checks each file once for the same environment.

- Test names containing Unicode line or paragraph separators could disappear from the health report. Those names are now retained.

- Expected skipped or todo tests with an empty reason could appear as failures in the health report. They are now excluded.
- The website could stay on an older release because its combined documentation included old installation commands. The combined guide now shows the current release and links to earlier release notes.
- Returning several migrated files to TypeScript could crash after generated package imports had already been removed. It now completes the return and preserves unrelated package entries.
- Compiling a large workspace could exhaust memory while finding relocated declarations. Parallel imports now share one probe of each project’s file layout.
- A `for concurrent` head with a default for a missing property, as in `for concurrent (const { n = 1 } of [{}]) { … }`, reported `TS2339`. It now keeps the default, as the same `for…of` loop does.
- `vibelang --fix` refused a throwing foreign type guard in an `if` condition, because the repair would lose its narrowing. It now bridges the call and keeps the narrowed value.

- The health report could omit failing migration test names. It now lists those failures and ignores skipped and todo tests.

- Formatting a documented parenthesized assignment could fail because a semicolon took its JSDoc comment. The assignment now formats while keeping its documentation.

- Linting migrated files could report an unknown rule for a TypeScript suppression comment. Native TypeScript rule aliases now name the registered ESLint rule.

- Native lint checks stopped running on files that re-exported members of a module body. These files now receive the configured checks, with reports at their original source positions.
- A `.vibex` file with a `module` body failed in Vite under `"jsx": "preserve"`, with `Failed to resolve import` for its `.jsx` output. `vibelang-vite` now serves that output.
- Migrating a package with wildcard exports could expose generated TypeScript module helpers as new public entrypoints. Those helpers now stay private while authored exports remain available.
- Migration `record` refused a batch whose every module had reverted for a recorded cause, even with every gate passing. It now keeps that outcome and its causes.
- Migration verify reported a lost wrapper when a conversion wrote `onSome: Effect.succeed` as `onSome: (value) => Effect.succeed(value)`.
- A JavaScript exception in a `do` that ran an Effect could skip an iterator's `return` method when the `do` stood in an array destructuring default or a `for…of` body. The iterator now closes, and the exception wins over an error from closing.
- The TypeScript mapper could misread `fork` or `join` when the operand began on another line. It now keeps the fiber operation, including named fork owners and intervening comments.
- Migration API checks reported a type difference for an unchanged generic alias that uses `infer`, and for generic exports over it, when its file had any other change. They now prove such an alias equal, and a real change to it still fails.
- Migration API checks could not compare an export that reached a module stopped by `TS7056`, so a package stayed unavailable. A snapshot now saves that module's source and the check reads it, so the export compares normally. Record older snapshots again to get this.
- `fork.in(scope) e`, `fork.scoped e` and `fork.detached e` reported syntax errors. They now start a fiber with that owner, with `EK1705` for another owner name and `EK1706` for a `fork.in` scope that is not a `Scope`.
- `try.all` could allocate fiber IDs that collided with surrounding fibers when the project and runtime loaded separate Effect copies. It now uses the project's `Effect.all`.
- Runtime compatibility checks could time out while repeatedly starting Node. They now reuse a Node process while keeping every generated comparison and failure reduction.

- Migration progress could label an expected `todo` test failure as an ordinary failure. Its records now retain the `todo` and `skip` flags and reasons.

- The health report could omit failing compiler test names. It now reads the structured failure records and excludes skipped and todo tests.

- Bundler plugins could crash while loading when the compiler package was missing. They now load normally and report an installation hint when a build needs the compiler.

- Migrating a package could falsely report a changed public API when its exports pointed at generated declaration files. Unchanged sidecar paths now keep their original API identity.

- The `using` resource action could drop comments around resource declarations. It now retains those comments when wrapping acquisition.

- The `using` resource action could move `try` operations into a plain callback and produce invalid code or unrun Effects. Acquisitions now keep their Effect context.

- The `using` resource action could produce invalid code for object initializers using `as`, `satisfies` or `!`; it now keeps them grouped correctly.
- Migrating an Effect `try` statement could fail when it returned a tagged object or a tuple. The repair now keeps the declared return type while writing the Effect handlers.
- The CLI guide promised a progress log file after every `vibelang --fix` call. It now explains that the migration runner saves these files when logging is enabled.
- A `for concurrent` loop could allocate fiber IDs that collided with surrounding fibers when the project and runtime loaded separate Effect copies. It now uses the project's `Effect.forEach`, as the native counterpart does.
- A line break between `try`, the dot and the operation name, as in `try` followed by `.all [a, b]` on the next line, reported a syntax error. Line breaks and comments may now separate those tokens.
- Returning migrated files to TypeScript could leave stale declarations or remove unrelated declarations. The migrate flow now uses their original layout for cleanup.
- `compareDeclarations` dropped `entryBatchSize` and `probeBatchSize`, so a whole-application API check always ran groups of eight entries. It now forwards all three batch sizes, refuses an invalid one instead of using the default, and refuses an option it does not know.
- Migration API checks ignored a project's `lib`, so a global from a selected library reported `TS2304` on unchanged declarations. They now load those libraries, and `compareDeclarations` takes `profile` and `workerHeaps`, with stage records streamed as they happen.
- The source-map token check ignored written code on lines with no mappings. It now reports the missing source positions.
- A warning quoting a `//path/to/source` comment could repeatedly recompile a loader project. Path-like line comments now stay in the warning, while listed source files remain watched.
- A hole in an array pattern, as in `for concurrent (const [, b] of pairs)`, crashed the compiler when the pattern sat in a `for concurrent` head, a loop head inside `do`, or a binding with a jumping `do` default. These patterns now compile and skip that value, as they do in a plain `for...of` loop.
- A migration API check could replace an invalid declaration's missing-type error with a later checker crash. It now retains the original diagnostic and stops that comparison.
- A multiline warning containing a `/* ... */` source comment could keep a loader recompiling forever. Block-comment excerpts now remain diagnostic text instead of becoming watched filenames.

- A `react-jsx` project built with `vibelang-vite` gave `.vibex` modules to the React Compiler already lowered, so it could skip them silently. Plugins after `vibelang-vite` now read the JSX when the project uses React's runtime.
- A migration's `--fix` progress waited for the compiler to exit, making a long repair appear stalled. Live phase and check counters now appear while it runs.
- The TypeScript mapper could reject a `for concurrent` loop with an invalid or overlapping edit after reading its head binding. Braced and single-statement bodies now project correctly.

- The source checkout preview could fail with `TS2307` for `vibelang-runtime` in another project. The instructions now install the checkout's runtime there before checking.

- Some integration guides introduced the TypeScript shim before supported plugins or omitted its limitations. The guides now place it last and explain the marked-file exception.

- `vibelang format` silently skipped marked `.tsx` files. Default discovery and explicit paths now check and format them while leaving unmarked TypeScript unchanged.

- Editor formatting rejected VibeLang syntax in marked TypeScript files. It now selects the VibeLang parser from the current buffer, including unsaved directives and JSX.

- Editor formatting through an installed TypeScript shim could report that the formatter module was missing. The launcher now locates the formatter in the installed compiler package.

- A long ordinary comment beginning with `// @vibe` could make loaders or the formatter treat an unmarked TypeScript file as VibeLang. They now check the complete directive line and leave that file unchanged.

- The TypeScript-file guide claimed stock tools always reject VibeLang or preserve its meaning. It now explains that prelude names can compile successfully with different bindings.

- Preparing a release could report the upcoming TypeScript replacement package as unavailable. It now recognizes the prepared source version without treating it as published.

- Reading a pure helper through an asserted `globalThis` receiver could report `EK0107`. Static reads now work, while host operations and object escapes keep their diagnostics.

- Editor formatting could hang on a marked `.mts`, `.cts` or `.tsx` file. Formatting now returns normally and keeps the directive.

- The diagnostic reference said decoding skipped schema constructor overrides. It now explains that decoding calls them, matching the warning and runtime behavior.
- The bundle source-map check could accept retained text with missing or misdirected positions. It now requires the original file, line and column.
- The source-map tool check omitted Metro and Babel. It now runs their real consumer checks too.
- The debugger check could accept a breakpoint in a different function or statement. It now verifies where V8 actually paused.
- An inferred export could fail with `TS2883` when its type came indirectly from a built `.vibe` or `.vibex` project reference. The declaration now names the type through its public package export.
- Source-file helpers could throw on virtual TypeScript module IDs or accept virtual `.vibe` IDs as paths. The compiler and Vite helpers now reject them consistently.
- Moving a helper into a native module could make migration report a changed namespace API even when every export was unchanged. Declaration checks now recognize those re-exports and retain checks for changed members and documentation.
- Parentheses or type assertions around literal keys could hide host operations such as `AbortSignal[("timeout")]`. These accesses now report `EK4402`, including destructured keys.
- A built-in extractor left its subject unnarrowed, and a `default` arm after a rest pattern such as `when Option.Some(...)` still saw the matched case. Arms now narrow as `instanceof` does, and `default` sees only what the pattern left.
- Moving platform code could widen a unique-symbol key and break computed-property access with `TS7053`. Generated local aliases now retain the imported value type.
- The React Compiler reported `Cannot access refs during render` on a ref written in an event handler of a `.vibex` module, because Babel, Metro and oxc read its JSX lowered. They now read the JSX, as for a `.tsx` module.

- The replacement guide ruled out supported TypeScript 5 setups for `vue-tsc` and `svelte-check`. It now explains their reliance on TypeScript's JavaScript API.
- A migrated build-config helper could fail to load an unchanged TypeScript sibling imported without an extension. The Node preload now resolves that sibling and directory indexes while preserving module identity.

- A callback returned by a throwing factory could inherit the factory's errors and be rejected as an argument or assignment; its own explicit throw contract now stays separate.

- The resource quick fix could give an anonymous class an empty name, including the name seen by its static initializer. The editor now withholds the action when the initializer would lose its inferred name.
- Invalid provider headers such as `with Live { … }`, `with cond ? A : B { … }` and `with Service = value { … }` suggested callback rewrites. They now report ordinary syntax errors; use `provide` in effect code.
- Breaking: `service class Name { … }` compiled with a warning. It now fails with `EK0909`; `vibelang --fix` removes `class` while keeping the service key, shape and comments. The editor setup guides now describe the same error and repair.
- Rechecking a module body referenced by an inferred declaration type could report `TS5055` after the first build. Declaration imports now keep reading the body source across builds.
- The editor guides did not distinguish migration warnings from retired `layer` errors. They now document `EK2121` as an error and the preserving quick fix.
- `item is { kind: "a" or "b" }` stopped narrowing `item.kind` in the true branch. It narrows as the same `||` test does in TypeScript again.
- A class pattern naming a schema, such as `when Address { let street }`, reported `EK0702` and then `TS2339` for each field. It now reports only `EK0702`.

- The TypeScript replacement guide told npm to install an unavailable package. It now states that the package is not published and uses the source-checkout preview.

- The `using` resource quick fix could hide later declarations from earlier closures and type references. The editor now withholds the action when moving those bindings would change their scope.
- Breaking: old `layer Live: Service { … }` declarations compiled with a warning. They now fail with `EK2121`; `vibelang --fix` writes the equivalent `Layer.effect` or `Layer.succeed` call.
- The migrate lost-wrapper check flagged kept programs: records of `Effect.fn` members, branches emitted as inline calls, and `do` temporaries. It now reads all three, and a real loss in those shapes still flags.
- Migration API checks ignored `exactOptionalPropertyTypes`, so a declaration valid only under that option left the comparison incomplete with TS2411. The comparison now uses the project's setting.
- Migrating an inherited error could stop at a match that already handled its tag. The class repair now retains that tagged matcher, narrowing and coverage.
- Rest bindings from tuple patterns lost their remaining element positions. They now keep the tuple tail, including optional and variadic elements.
- The migrate flow renamed TanStack Router file routes, and the generator then took the `.d.vibex.ts` sidecar for the route. A one-pass plan now keeps those files as `.ts` or `.tsx`.
- Migration API checks counted a native module body's declaration as a new entry point, so a module with an internal body never compared identical. Its parent's exports now decide the API.
- `vibelang/babel` and `vibelang/metro` read only `.vibe`, so a `.vibex` module failed to parse or was left out of the bundle. Both now read `.vibex`.

- Migrating a package could report a changed API when an unchanged class with private members or enum moved behind a re-export; the comparison now retains its public identity while checking member and alias changes.
- Bundling a project with virtual TypeScript modules could fail while VibeLang checked a virtual identifier as a file. Virtual modules now stay with the plugin that generates them.
- Migrating a code generator could change an output filename from `index.ts` to `index.vibe`; bare filename data now stays unchanged while source inputs follow renamed modules.

- A migrated package could report different exported types depending on how its entrypoints were grouped; API comparison now follows public declaration identities across groups.

- A `for concurrent` head over an `any` operand could infer `unknown` and reject item properties. Identifier heads now retain the native item type and TypeScript narrowing.

- Provider expressions typed as `never` were rejected. Concrete `never` providers now keep Effect's error and service types.
- `effect` on an index signature or after a modifier in an interface or type literal, as in `interface I { readonly effect value: number }`, reported syntax errors. It now reports `EK0108`, with its quick fix.
- The `EK0801` warning on `using` in effect code named a quick fix that the editor didn't offer. It now offers one that moves the rest of the body into `scoped` and acquires the value with `acquireDisposable`.

- A class pattern whose custom matcher returns `boolean` could incorrectly expose class fields in its arm. It now leaves the subject's type unchanged, as a boolean test does.

- Migration could leave source-linked documentation pointing at removed TypeScript files or showing old imports; matching code blocks and their source paths now follow the conversion.
- A `do` expression in a `provide` provider crashed the compiler. The `do` now runs before the block, and a `continue` or `break` inside it leaves the block as written.
- `vibelang --fix` could leave independent type repairs unapplied between uses of a name whose rename was declined. It now preserves the declined binding and its uses while applying repairs between them.
- A `using` of a plain Disposable in effect code ran its disposer when a `try` failed or the fiber was interrupted. It now keeps TypeScript's meaning, as in `Effect.gen`: a failed `try` abandons the generator, so the disposer doesn't run. Use `acquireDisposable` inside `scoped` for cleanup on every exit.

- Array patterns on non-array iterables could give their bindings `any` or reject nested object tests. They now preserve the iterable's element type and narrow nested values as TypeScript does.

- Vite debug output omitted project invalidations, making rebuild traces incomplete. Each invalidation now reports the new revision immediately.
- A `for concurrent` loop over an iterable union could report a type error even when every member was iterable. It now infers the item from every member, as a native `for...of` loop does.
- Type assertions around `import.meta` could block its `.url` read. The compiler now accepts these URL reads.
- Migrated packages could contain emitted imports that still named a VibeLang source file, causing installed packages to fail to load; emission now recompiles imports changed by routing.
- The coding-agent skill said warnings never fail a build, including imported Effect diagnostics. It now distinguishes imported compiler warnings from VibeLang's own warnings and standalone lint.
- The grammar reference described whole-shape services as unsupported; it now links `service Name: Shape {}` to the accepted declaration grammar.
- Inline object and function types in `@throws` could lose their members and admit incompatible callbacks. Throw contracts now retain those members and use the same checks as named types.
- Type aliases of `never` and `unknown` in `@throws` could reject compatible callbacks. They now behave like the underlying types.
- A routed import in a migrated package could point at a declaration file that was never written, so TypeScript fell back to untyped JavaScript and reported TS7016 and TS7006 across the importers. A route now names the declaration the compiler wrote.
- In a repository whose root project also compiles its packages, a routed import could point outside its package, and Bun then failed with `Cannot find module`. A package's own emitted file now wins.
- The site's Proposals page showed a layer as `Layer.effect(Users) { ... }`, a trailing block that `EK1101` rejects. It now shows `Layer.effect(Users, effect { ... })`.
- A project that imports through `paths` aliases and emits only declarations failed with TS5097 at every import of a migrated module, so the migration reverted modules that were fine. Setup now turns on `allowImportingTsExtensions` for such a project.
- With bundle routing on, one test assertion about bundle input names held its whole package back from migrating. The assertion now holds only the modules it names and the imports between them, so the rest of the package converts.
- Destructuring a function, as in `const { constructor: C } = f`, and a template-literal `data:` or `blob:` specifier in `import()` could still reach code that runs a string. Both now report `EK0107`, as `f.constructor` and a string-literal specifier do.
- A layer finalizer around a `provide` block could see an internal record instead of the block's result when a `return`, `break` or `continue` left the block, including through `uninterruptible`, `interruptible` and `restore` inside it. The finalizer now sees the returned value, or `undefined` for a `break` or `continue`, as with `Effect.provide`.
- `vibelang --fix` left an older `service Prefix: string` in a named package at `EK0906`, so a project couldn't upgrade it. It now writes the empty body, `service Prefix: string {}`.
- A project that couldn't rename its files couldn't use VibeLang. A `.ts`, `.tsx`, `.mts` or `.cts` file whose first line is `// @vibe` now compiles as VibeLang; every other `.ts` file keeps TypeScript's verdict.
- `vibelang-vite`, `vibelang-unplugin`, `vibelang/register`, `vibelang format` and `vibelang lint` skipped or failed on a `.ts` file with `// @vibe`. They now compile, run, format and lint it. Bun's bundler and Metro still need `.vibe`.
- Projects that must keep `.ts` names can try the experimental repository implementation of open VIP-42. The `vibelang-typescript` replacement is not yet published to npm; see the [source-checkout preview](typescript-shim.md).

- Some class patterns inferred the wrong instance type or kept the wrong type in a `default` arm. They now narrow as TypeScript's `instanceof` test does, including `Symbol.hasInstance` type predicates.

- Reverting a migrated module could leave its importers naming `./x.ts` in a project where TypeScript rejects source extensions, which failed with TS5097. A revert now writes the name the project's emission policy expects, such as `./x.js`.

- `vibelang --fix` refused a `.pipe` on a parenthesized `try`, as in `(try f()).pipe(g)`, reporting `')' expected`, because its rewrite lost the closing parenthesis. It now keeps the parenthesis, and it leaves a success value's own `.pipe` as written.
- A test or build killed while a `.vibe` module compiled could leave a native compiler running, each holding gigabytes of memory. The compiler now stops when the process that started it exits.

- Migration left a module in TypeScript when it read a clock or random source such as `crypto.randomUUID()`, because the platform split did not recognize the call in the compiler's message. The split now moves that code to the module's `.ts` companion.
- Migrating a repository with routed bundle imports could revert healthy modules: each revert dropped the routes, and the import errors that left were blamed on modules that had none. Settle now emits again before it blames a kept module.

- A `for…of` in effect code called its iterator's `return` when a `try` failed or the fiber was interrupted, and joined a failing close into a thrown defect. It now behaves as the same loop in `Effect.gen`: a failed `try`, a `throw` and an interruption leave the iterator open, and a thrown error wins over a failing close.
- A `return`, `break` or `continue` in a `do` default of an object pattern, as in `const { y = do { return 0 } } = source`, reported `EK0204`, and a `do` default over an object literal such as `const { k = do { () => 1 } } = {}` could report `TS7024`. Both now compile: the jump leaves from the default, as it does in an array pattern.

- Migrating a generator with nested pipelines could crash or corrupt the rewrite; `vibelang --fix` now preserves nested receiver and stage-callback changes when capturing the surrounding pipeline.
- Vite main and worker bundles could compile the same project simultaneously and exhaust memory. Matching plugin instances now share compilation, and closing one keeps the others running.

- Callbacks declared `@throws {any}` could be rejected by compatible typed callback contracts. They now follow TypeScript assignability, while `unknown` and no-throw contracts keep their checks.

- Providers typed as `any` were rejected even though Effect accepts them. They now retain Effect's `unknown` error and requirement types.
- Reverting a module during migration could try to clear build outputs of unrelated packages and stop on an unsafe-output error. Reference refresh now limits cleanup to projects linked by references and records the path behind any refusal.
- Reverting a failing module during migration stopped with "project reference rebuild failed" whenever any other module still had errors, so a migration could never settle. A revert now accepts a rebuild that reports diagnostics, and the next check lists what remains.

- A line break beside a provider comma could hide other errors in the file. The compiler now also reports misplaced `provide` blocks and independent type errors.
- Migration emission could retain a large TypeScript declaration graph while compiling, exhausting the coordinator heap. Declaration layout planning now finishes in a separate process before compilation and records its duration.
- Service-key checks could be skipped after a nullable generic key was narrowed or asserted non-null. Those narrowed values now receive the same errors as direct keys.
- Bundling native error declarations could pull in unused experimental platform services; generated language helpers now keep those services out of the bundle graph.

- A throwing default on a generator callback could be rejected even when its caller caught it. Synchronous and async generators now check that default at the invoking `@rethrows` call; deferred bodies keep their own checks.

- A service key hidden behind a conditional type alias could be treated as an ordinary class. It now reports the same errors as a directly named key.
- Services beside a nested `Context` namespace could emit declarations that TypeScript rejected. Their generated imports now use an unshadowed name.
- The Node loader and bundler plugins removed a line of a string or comment that spelled `//# sourceMappingURL=`, which changed the program's text. Only the compiler's own directive at the end of the file is removed now.
- Under `vibelang/bun`, a stack frame named the `.vibe` file with the line of its compiled JavaScript. It now names the `.vibe` line in a module whose emitted JavaScript is ASCII; other modules keep the compiled line.
- A source map could name a position past the end of a file, or list its segments out of order, after a `match` or another form that lowers to a block. A generated closing brace now maps only to a brace you wrote.
- A service's written `key`, and the name in a call to `Effect.acquireRelease` or `Effect.acquireDisposable`, had no source map position of their own, so a stack could name the wrong column. Both now map to where you wrote them.
- A loader record kept a byte-order mark in a source map's text, and read a UTF-16 source as UTF-8. It now holds the text the compiler read.
- Calls known to throw inside a synchronous generator passed to `Effect.try` or another callback wrapper could compile unchecked. They now report `EK0401`, and `vibelang --fix` preserves the iterator's behavior.
- JavaScript emission during migration could put declaration sidecars somewhere other than their package exports, losing types in consumers. Sidecars now keep the project's declaration layout while JavaScript retains its package-relative paths.
- The Bun guides attributed computed `.ts` alias failures to missing runtime hooks. They now distinguish the preload's fallback for literal imports from Bun's extensionless-alias limitation.
- Converting an `async` function could leave `await` in computed member names or class bases, including definitions inside another awaited expression, and produce invalid code; the editor now withholds those conversions.
- Migration setup stopped when an earlier migrated module reached a declaration that `TS7056` left unemitted on both sides. Setup now records the emit reason, names each unavailable export and continues; the package stays incomplete.
- Bun bundles could fail when native inputs kept relative or aliased `.ts` imports after migration; the build adapter now loads the matching `.vibe` source while preserving native files and external imports.
- A TypeScript barrel in a built project reference could lose exports after a module moved to `.vibe` or `.vibex`; consumers now resolve those native modules through their emitted declarations.
- Migration API checks could report a successfully emitted original as incomplete against itself when its project set `moduleSuffixes` and took `--outDir` on the command line. The check now reads each module's real declaration, so `TS2694` no longer appears on unchanged code.
- Migration API checks refused an export whose type reached a broken dependency declaration through a generic applied to shared arguments, as drizzle's Effect types do. Such a type is the same on both sides, so it no longer blocks the comparison.
- Migration API checks reported names as missing when a project's globals came from a declaration file compared in a different batch, which refused the whole package. Every batch now keeps the entries that add globals or augment a module.
- Migration API checks refused every importer of a workspace package with a `declare module` block when the frozen original and the candidate lived in separate checkouts. The key is now the package and module, and the proof compares the ambient blocks and the local declarations they reach.

- Migration could separate a throwing class from its merged namespace, breaking types such as `Asset.Input`. Type-only namespace companions now move with the declaration; namespaces with runtime initialization keep the original source unchanged.

- Vite+ projects could still lint or format generated VibeLang declarations because their ignores live inside `vite.config.ts`. Migration setup now updates the embedded `fmt.ignorePatterns` and `lint.ignorePatterns` settings while preserving checks on authored implementations.

- A choice between service keys could bypass the usual construction, inheritance and pattern checks. A union made entirely of service keys now reports the same misuse diagnostics as each key on its own.
- Generated declarations for native `module` bodies could fail lint with `unicorn/require-module-specifiers` or formatting checks. Migration setup now excludes these compiler outputs while continuing to check authored implementation files.
- An indexed generic type could hide a service key from construction, inheritance and class-pattern checks. Indexed constraints now retain the key's identity and report the usual misuse diagnostics.
- Migration's API check could report conflicting snapshot paths for native `module` declarations after an import rename. It now records those declarations as compiler outputs, while preserving handwritten declarations and detecting real API changes.
- Computed alias imports can fail before Bun calls a loader; the Bun guides now show literal aliases or computed relative and absolute source paths.
- Migration API checks refused any project that loaded two byte-identical copies of a package such as `@types/node`. Copies now count as one ambient origin when their bytes, dependency closures and load order prove it; differing copies and contributors loaded between them still refuse.
- A migration API comparison that exhausted its 2 GiB worker heap failed the package. It now retries at 4 and 8 GiB where the machine has the memory, and reports the failure if the last size also fails.
- A named tuple type inside an `effect` function, arrow or method could crash the compiler. Tuple labels are now treated as type-only names, and parameter writes retain their native call-time binding.
- A `join` operand typed `any` or `never` could infer a collection-shaped value or impossible error type. It now infers the same result and error types as `Fiber.join`.
- Formatting a `match` arm without its `;` stopped with an internal `formatting changed the program` error; it now reports `EK0701` at the arm and leaves the file unchanged.
- Bun scripts and tests could not load a migrated source through a `tsconfig.paths` alias ending in `.ts`; the preload now follows its `.vibe` sibling while preserving existing native files.

- Migration setup could leave rewritten files unformatted because a formatter plugin was not installed yet. Setup now installs the selected dependencies before formatting, including when adding workspace packages.
- Converting an `async` function could produce invalid code when a nested scope shadowed `Effect`; the editor now withholds the conversion until that binding is renamed.
- Rerunning migration setup left a publication wrapper from an earlier release in place, so packed private imports lost their declarations. Setup now upgrades both wrapper forms.
- Migration could stall after emitting JavaScript while a loader cache compilation kept running; each optional record now has a deadline, reports the affected project and elapsed time, and lets later projects continue.

- Fixed extractors could infer `any` for payloads from open subjects. `Option`, `Exit` and `Result` patterns now give those payloads the `unknown` type from their native guards.
- Quoted, numeric and template `data` variant names reported a generic identifier error. They now report `EK1606` while retaining the following variants and declarations.
- A payload after a malformed `data` variant name, such as `"Bad" { value: string }`, cascaded into unrelated errors and lost the following variants. The payload now stays with its variant, so the name reports only `EK1606`.
- A `schema error` inside a namespace reported its `Schema` import as unused under `noUnusedLocals`. The import now counts at every namespace depth, as it does at the top level.
- A service inside a namespace could lose native key helpers or report a required `Context` import as unused. Namespace services now resolve their runtime types and keep the imports their declarations use.
- Tests using lazy Rolldown or esbuild imports on Bun `1.4.1` and `1.4.2` could not load native bundle graphs; their bundler preloads now route those imports through temporary modules.
- A `module` body that named a sibling by its `.ts` file kept that name after the sibling migrated, which failed with `TS2307`. Migration now updates the name, and a revert puts it back.
- The editor warned that a written `effect { }` block passed as the last argument needed a form annotation, with no fix to offer. The `effect` keyword now decides its form, so the warning no longer appears.
- The migrate flow kept every module under a `node` shebang TypeScript even when the file had no execute bit, and kept script entries whose path it could rewrite. A shebang now counts only on an executable file, bare commands in GitHub workflows and composite actions count as runners, and a rename rewrites a served entry's path in package scripts, workflows and shell scripts.

- Bun builds with an explicit compiler root could bundle a same-named source from the wrong directory; relative entries now resolve from the caller's working directory.
- ESLint could treat a generated concurrency-limit cache as a source variable; the tree now marks that temporary while retaining user-written names and the original limit expression.
- Editor form suggestions could panic on a property access inside a `for` statement; they now read the loop as the compiler does.

- The TypeScript interop guide lacked a throwing helper example; it now shows a named `module` body and its identifier import.

- Contracted dynamic-call examples omitted the unknown-throw error; they now show `EK0403` beside the existing `EK4409` compatibility diagnostic.

- Nullable `for try` examples mixed Stream and receiver errors; they now distinguish the Stream rejection `EK2004` from independent unknown-operand and nullable-receiver TypeScript errors.

- Migrating an abstract plain error could replace its inherited matcher and turn boolean results into arrays; `vibelang --fix` now preserves the original matcher and its extraction results.

- Whole-shape service examples omitted required bodies and failed with `EK0906`; the runtime and declaration examples now include empty bodies for primitive and callable shapes.

- Formatting an Effect type assertion before `<` could fail with a missing `>` error; comparisons now retain their operator and type boundary.
- The debugging recipe’s failure example used a forbidden throw in a plain callback; it now creates an explicit Effect defect and checks the original source location across varied line offsets.

- Diagnostic references for legacy catches, declarations and mapper errors led to sections that did not name their codes; those sections now include the matching warning and repair guidance.
- Migration receipts from installed compilers changed shape after saving or resuming. They now retain an explicit `null` compiler artifact and compare consistently across recovery.

- The cached-service-default migration example expected a lazy factory; its fixed twin now retains eager initialization, the cached static field and all value and type reads through an equivalent native class.

- A service recovery example applied `try` after `catch` had returned its value. It now consumes that value directly; the error guide explains when an outer `try` is valid.

- The TypeScript mapper could mistake an explicit `effect` block for an unclassified callback and reject a valid `catch`; blocks now retain their program form and execution boundary after reparsing. `try effect { … }` also failed there with a syntax error; it now runs the block where it stands.

- Finding references could stall when a project loaded large native libraries; module aliases now use one lookup per document and return the complete reference list promptly.
- Migrating a published wildcard package moved generated source-child helpers into a private sibling and edited `package.json`. They now stay in the documented private `module` body with no manifest change.

- Migrated nested-catch examples could acquire possible `undefined` returns and lose literal types; their explicit catch expressions now keep `undefined` out of the declaration, keep the literal types, and preserve the runtime result.

- The TypeScript mapper could report `EK9001` on an `error` declaration with an `extends` clause that it had already lowered; it no longer reports the generated class member.
- Bun setup did not identify older runtime defects that could return asset paths for modules or corrupt Unicode filenames; the runtime instructions now specify Bun `1.4.2` or newer.
- An invalid `join` operand could suggest retired Promise hatches or leave an Effect unrun. Its notes now show native, runnable Effect expressions and withhold handle advice for incomplete markers.

- Migration retries could leave host `Request` and `Response` uses behind when they collided with Effect modules; saved platform diagnostic notes now route the unchanged code through the TypeScript platform split.
- A project inside a dot directory of its repository could fail a `vibelang-unplugin` Bun build with `Could not resolve` on a `./x.js` import of its own `x.vibe`. The plugin now scans the project as well as the repository.
- A legacy service read inside a held `catch` head, such as `decode((Service()).read()) catch fallback`, kept its retired call and refused the migration with an unknown requirement; the read now migrates with the rest of the head.
- A call signature in a service with a written shape could report `EK0902` twice; each invalid member now reports once while independent key and generic errors remain.

- A module-export repair could change code inside a declined repair site; declined sites are now recorded before independent export edits, preserving their original bytes and report locations.

- Migrating an unmarked function with a legacy service call could freeze inferred channels too early and refuse the repair; its marker, receiver and dependent calls now migrate together before channel inference is written.

- Fork migration examples compared VIP-only repairs with broader ordinary cleanup; they now repeat each selection separately while preserving the fork options.

- Catch-binding examples used a retired statement catch inside effect functions; they now use plain functions and show how an explicit `do` block scopes a default binding.

- The migration table recommended calling the `interrupt` and `yieldNow` Effect values as functions; it now shows `try interrupt` and `try yieldNow`.
- The JSX throw-expression example used a retired statement catch; it now uses a catch expression while preserving the failure payload and lazy JSX evaluation.
- The migrated Effect-function example expected an expanded parameter brand; its declaration check now preserves the written type alias, matching TypeScript.
- Exhaustive-match examples expected an older error-matcher encoding; their output checks now retain the current matcher calls and verify every arm and extracted payload.
- Producer cleanup examples still used retired `try` statements; they now register scope finalizers and check disposal order against native Effect streams.
- The exported-service migration example expected cached defaults to become `Reference` fallbacks; it now checks the documented refusal and preserves every source and shadowed utility type.
- Service member examples still called methods on a service key; they now look up the implementation explicitly and retain native Effect results, failures and call counts.
- Language-service examples omitted the no-throw diagnostic for direct `JSON.parse` calls; their exact diagnostics now include `EK0403` alongside independently configured lint warnings.
- Throw-expression checks still expected comma violations to be warnings; they now require the documented `EK1010` error and verify that parentheses preserve the thrown value.
- Migration reference refresh could fail on a missing child configuration in an unrelated vendor project; missing configurations are now validated only when affected or required by the reference graph, before any outputs are deleted.

- Node and Playwright could fail to import a migrated workspace package before its JavaScript was built; the Node preload now selects its `vibelang-source` target while retaining existing package conditions.

- Rolldown builds started from another directory could compile the wrong project or bundle a same-named source from the caller's directory; the plugin now honors `cwd` for the default compiler root and relative entries.

- Pipeline repairs could reject canonical HTTP setters or change custom stage construction order; safe request setters now keep their data-first form while custom stages retain their receiver, argument order and coldness.

- Generator repairs could silently stop at URL strings because `//` inside the string was mistaken for a comment; complete fragments now distinguish literal contents while preserving real comments.

- Repeated sidecar repair checks could fail because they expected a legacy generator error on valid source; they now require a clean initial compile and keep checking source types, idempotence and overwrite protection.

- The readonly upgrade guide lacked an ordinary TypeScript example; it now shows how written modifiers are preserved in interfaces, nested object types and optional properties.

- The stream countdown example used a retired `try/finally` statement; it now registers a finalizer in the producer scope and still cleans up when collection stops early.

- Dynamic-call examples omitted the required throwing-call error; they now show `EK0403` alongside the unrun-program diagnostic while preserving TypeScript errors for unresolved callees.

- Examples for redacted values, callback adapters, platform services, scope rollback, and schema helpers were still marked unavailable after support landed; they now compile and check their documented output as active examples.

- The interruption example called a removed global and failed to compile; it now calls `Effect.uninterruptible` and checks its result against the native Effect function.

- Reverting ordinary source files could fail when the migration toolchain was unavailable; reverts now load reference-build tools only when the project graph needs them.

- Migration handled a converted `.vibex` module only at its rename: batch scope, sidecar ignores, lint paths, path reads, build inputs, file selectors and emitted routes still expected `.vibe`, and tools read its source untranspiled. Each now treats `.vibex` as it treats `.vibe`.

- Migration rewrote import-shaped text inside JSX and template literals, which changed what a component rendered; it now edits only real imports.

- A file selector an earlier migration batch had widened for `.vibe` dropped `.vibex` modules, so a coverage test could silently skip converted components; it now upgrades when a `.tsx` module moves.

- Migration rejected JSX components in `.tsx` files; they now convert to `.vibex` with matching imports, declaration checks and revert support.

- Plain catch annotation checks still expected retired Effect-only diagnostics; they now require the same diagnostics as TypeScript across binding patterns and callable forms.

- Help examples still expected the old single-project repair wording; they now check build-order repairs and the watch restriction across help aliases and option order.

- Migrating an error with a legacy `mutable` payload field could stop matching foreign values with the same tag. The class rewrite now preserves its own matcher and extractor behavior.

- The inherited-configuration migration example omitted its repository boundary; it now identifies the owned parent configuration and explains why external presets remain unchanged.

- Local-service declaration examples could report an unrelated missing-key error; they now supply an explicit key and explain that disabling declaration output does not remove that requirement.

- Migrating `Option.match` with a generic program constructor could narrow its inferred result type; the repair now preserves the original callback instantiation and cold execution.

- Mapper catch examples could fail by omitting their Effect boundary; the checks now use explicit effect scopes and retain the unmarked examples as boundary-error controls.

- An `is` binding in a `for` head could make the TypeScript mapper reject the file with overlapping edits; it now projects the loop and emits its executable output with valid source mappings.

- Native errors under Playwright could show generated JavaScript line numbers. Native frames now retain their source locations when a test runner uses a custom stack formatter.

- Migration could spend minutes scanning generated modules with many comments. Source-path checks now mask comments in one pass while preserving their protection rules.

- Bun tests that imported Rolldown or esbuild themselves could still fail on native source graphs; bundler preloads now route literal ESM imports through native adapters on supported Bun releases.

- Node tests that created their own Rolldown or esbuild bundles could fail to parse native sources despite a runtime loader; opt-in bundler preloads now add native source support to those calls.

- Bun builds could not find a literal `.ts` entry after it migrated to `.vibe`; the Bun adapter now follows the migrated source while preserving existing TypeScript and in-memory entries.

- Platform extraction could leave a generated `module` body importing a renamed dependency through its old `.ts` path. Generated bodies now use the dependency’s resolved migrated path.

- Migration could crash or leave source selectors stale in JavaScript tools. It now binds their local references before proving filename-selector rewrites.

- Optional object-property bindings reported `EK4704`. Missing properties now leave the binding uninitialized, while present properties initialize it after the cached value read.

- `join` could inspect a fiber marker before joining and trigger a Proxy trap. It now calls `Fiber.join` directly, preserving native observations and failures.

- `join` accepted collections even though it denotes `Fiber.join`. Collections now report `EK1704`; `--fix` preserves their previous values, evaluation order and failure cleanup with an explicit helper.

- Forked children could stop when an Effect helper or loop iteration returned, and storing their handles could report an obsolete escape error. They now stay with the current parent fiber, matching `Effect.forkChild`.

- Native Bun launchers could lose an imported module after its TypeScript source migrated; the preload now follows missing relative or absolute `.ts` imports to their `.vibe` source while preserving existing native files.

- Imported callbacks from native function-type aliases could report `EK0403` after declaration emit; generated `@throws {never}` comments now stay attached when those declarations are loaded.

- Migration could report `TS6059` after treating imported dependencies as temporary project roots. Fixing shards now preserve the original roots and imported dependency views.
- Compiler help incorrectly described `--fix` as incompatible with `--build`; it now explains project repairs in build order and the existing `--watch` restriction.
- Migrating a fieldless abstract error root could leave its child unrepairable; constructor-preserving child repairs now run before the root class expansion.
- Binding-free iterable patterns could produce an undeclared cache during TypeScript checking and omit iterator cleanup in mapped execution; both now retain their cache scope and cleanup.
- Effect parameter defaults could report duplicate no-throw errors; each disallowed call now reports once with parameter-specific guidance.
- The TypeScript mapper reported `EK2109` for valid computed schema keys. It now preserves native key expressions and reports `EK9001` when a key needs VibeLang operations the mapper cannot lower.

- Migration setup left source-linked documentation examples stale after rewriting their source. It now refreshes matching whole-file code blocks after formatting and reports mismatched excerpts for review.

- Bun scripts and tests could load a source module but fail when bundling it with `Bun.build`; the `vibelang-unplugin/bun/register` preload now loads both runtime imports and build graphs while preserving existing plugins.

- Migration API checks could lose ambient types such as `NodeJS` when a project omitted `rootDir`. Declaration snapshots now match the actual output layout and retain each declaration's project context.

- With an Oxlint configuration, `vibelang lint` could skip native files behind a solution configuration. It now follows `references` during discovery and `-p` selection.

- Converting an `async` function with an error per `await` could duplicate an existing error name or capture a local binding. Generated error declarations now use fresh names.

- Source-reading tools could omit renamed snippets or fail on old TypeScript paths. The opt-in `vibelang/source` helpers now discover native sources and resolve migrated source-text references.

- Playwright could parse imported `.vibe` source as JavaScript even with the Node preload enabled. The loader now identifies native modules before transformation, so configs and test workers load them.

- The legacy Cause-catch diagnostic example linked to code that had already been migrated. It now links to an executable original input that still demonstrates the warning.

- Vitest coverage could list generated declarations for inline TypeScript module bodies as source files. Migration setup now excludes those declarations while preserving implementation coverage and thresholds.

- A throwing callback supplied through an optional tuple spread could bypass throw checking. A final tuple spread now retains that callback's contract, including readonly tuples; `--fix` preserves synchronous defects with an explicit bridge.

- A service key passed through a constrained generic parameter could bypass misuse checks. These parameters now report the same service diagnostics as the original key.

- An `effect` function with an inferred return type could report `TS7030` for a bare `return`; `noImplicitReturns` now checks its success value and accepts branches that only complete with `undefined`.

- TypeScript's content mapper could report `TS2305` for missing `$matchCache` or `$propertyKey` helpers when checking `match` or `is`. Cached patterns and computed keys now resolve their helpers through the mapper's prelude.

- Bundlers could write relocated declarations under an incorrect nested path; loader compilation now preserves the configured declaration root and source maps.
- The TypeScript mapper could reject ordinary error declarations because it treated generated matcher registration as authored syntax; valid error members now project normally.
- ESLint reported valid `for concurrent` bindings as unreachable code. It now preserves their scope without false `no-unreachable` errors, while still reporting unreachable statements in the source.
- Adding the Vite plugin could make Node bundles crash on missing optional CommonJS dependencies. Delegated imports now preserve the resolver context that keeps those dependencies optional.
- A throwing TypeScript callback could bypass its function-type contract through `satisfies`. Incompatible contracts now report `EK0402`; `--fix` preserves a simple inline constraint without changing the callback or its inferred type.
- A service key alias with an intersection type could bypass misuse checks. Constructing, extending or matching it now reports the same service diagnostic as the original key.
- Optional array-pattern bindings reported `EK4704`. They now initialize only for present elements and keep absent bindings uninitialized, including in nested patterns and `is` tests.
- Direct `try` calls returning `any` could lose the errors and services their programs require. They now infer the same `unknown` channels as native `yield*`, as stored `any` values already do.

- The example for an unexported failure class showed an unrelated Promise error; it now demonstrates the actual visibility error.

- Some schema migration examples still showed a removed return annotation on generated codec factories; the examples now use native TypeScript return inference.

- Large migrations spent time loading TypeScript dependency graphs for an unused annotation pass. Compilers that keep functions plain by syntax now skip that work.

- Plain JavaScript catch bindings typed as `any` retain native destructuring and defaults; legacy untagged catch filters keep their existing diagnostic.

- The TypeScript mapper could report an obsolete implicit-execution error for a catch outside effect code. It now reports the same catch-boundary error and keyword location as the native compiler.

- The diagnostic guide omitted the replacement for a retired constructor error; it now explains the inheritance diagnostic and native class rules.

- Migration retries left casted `globalThis` platform accesses in native modules. Saved diagnostics now route the unchanged code through the TypeScript platform split.
- Assigning a generic overloaded function declared `@throws {never}` could incorrectly report `EK0402`; callback assignments now use TypeScript's overload relation and preserve the no-throw contract.

- A refused authored `@throws` comment can accompany legacy `Stream<A>` or `Layer<A>` types in the same file. `--fix` preserves the comment and repairs the independent type aliases.

- Converting an `async` callable field or indexed method could violate an inherited or indexed `Promise` contract; the editor now withholds conversions that would leave those properties incompatible.
- A migration could send source modules outside a compiler project to `--fix --only` when an import resolved through declarations. It now uses compiler membership and keeps foreign modules out of temporary fix shards.
- A migration could report fixing complete while skipping selected scripts outside its projects. It now names the uncovered modules and keeps the fix pass incomplete until their projects are included.
- A whole-scope migration could skip bundle dependencies even with `--route-bundled-imports` enabled. Planning now honors that option and includes those modules for conversion.
- Converting an `async` function could produce syntax or type errors when it used `fork` or `join` as ordinary names; the editor now withholds those conversions until the affected bindings are renamed.
- Returning a migrated file to TypeScript could stop on an unrelated generated framework configuration. Reference refresh now checks affected projects and their build dependencies, with the configuration and diagnostic named on failure.
- Migration planning could hold back a native command’s entire dependency graph even with emitted-import routing enabled. It now admits dependencies behind supported native import routes while retaining entrypoint paths and protected test imports.
- Migration left stale imports in authored declarations such as `.d.mdx.ts`, causing `TS5055` or missing-module errors after a source rename. Those imports now follow the renamed source and return to their original spelling when it is restored.
- Converting an `async` function could leave an incompatible `Promise` contract on a variable, callback, inherited member or overload; the editor now withholds conversions that would leave those contracts invalid.

- Error declarations with an inheritance clause consistently report the existing inheritance diagnostic; the superseded constructor diagnostic is retired.
- `join null` and `join undefined` were rejected even with `strictNullChecks` disabled. They now follow `Fiber.join`'s TypeScript assignability, while strict null checking still rejects them.
- Objects with an incomplete fiber shape could pass `join` checking. They now report `EK1704`, while complete fiber types remain accepted.

- JSON preference and provider requirement examples now point to the source spans where their messages are reported.

- A rejected error inheritance clause could expose an argument error from a generated superclass call; only the inheritance error is reported there, while errors in authored methods remain visible.

- A completed migration could still report a refusal from an earlier repair attempt. It now reports the remaining refused changes after resolving inferred requirement types.

- A service could capture an enclosing generic type through a type guard or assertion result. These contracts now report `EK3005`; concrete predicates and member-local generic operations remain valid.

- The service cheat sheet could direct readers to an unavailable external `Name.Shape` alias. It now explains the alias's scope and shows how to name the implementation outside the service body.

- A service could capture an enclosing generic type through a callable's explicit `this` parameter. These receiver contracts now report `EK3005`, while concrete and member-local generic receivers remain valid.

- Interrupted migrations could repeat completed declaration-layout scans. Drivers can now checkpoint package layouts and reuse them after verifying the original source and configuration inputs.
- Retired continuation forms now consistently report `EK3501`; the obsolete provider-contract diagnostic is retired.
- Converting a recursive `async` function could leave `Promise` bridges calling a function that returns an `Effect`; the editor now withholds that conversion when the function refers to itself.
- Preparing declaration sidecars for large migrations could exhaust memory. Explicit `rootDir` settings and `composite` boundaries now let setup plan paths without loading unrelated source programs.

- Native `try/catch` and `try/finally` statements in Effect bodies were accepted. They now report `EK0503`; use catch expressions or a plain function for JavaScript exception handling.

- A legacy abstract error root could reject its own subclass in an `is` or `match` pattern; it now retains native family matching.
- Diagnostic identity updates preserve authored source and project configuration without depending on generated declarations.
- The legacy `infer` migration examples now retain trailing comments after the last declaration, matching the output of `vibelang --fix --fix-vip-only`.

- A class whose own custom matcher was replaced could silently use `instanceof`. Patterns now preserve the native `TypeError` for non-callable values and identity matching for an own `undefined` value.

- A `private` or `protected` constructor in `error` or `schema error` could add a spurious argument error from generated code. It now reports the constructor restriction once; `--fix` preserves constructor visibility and tag matching, while authored type errors remain visible.

- Preserving migrations retain source comments, named parameter types and explicit generator return contracts.

- A conditional callback passed to a rethrowing function could report an incompatible callback or lose a branch’s written throw contract. The enclosing call now retains every written branch contract, and catching or bridging the call admits the callback.

- An inferred service-call migration example used `PlatformError` as a type. It now uses the valid `PlatformError.PlatformError` qualification.

- Migrating schema fields that reference writable codecs could generate an invalid return annotation; generated factories now use ordinary return type inference.

- A throwing callback passed to an optional or nullable parameter, including `sort`, could bypass throw checks. It now requires the same bridge as a required callback, and `vibelang --fix` preserves the original defect.

- Migration API verification could reject unchanged module augmentations when an adjacent callable gained generated `@throws {never}` metadata. Ambient closure checks now allow that addition while preserving authored contracts, comments and types.

- Code coverage no longer counts generated `error` setup as source functions and retains static initialization written in ordinary classes.

- Migrating an implicit generator API could refuse an unannotated foreign call; the repair now preserves synchronous exceptions as defects.
- The recursive contract example now uses explicit service lookup and shows the legacy return-slot migration error alongside its existing recursion errors.
- The fork operand example now distinguishes its assignability rejection from independent native errors inside an operand.
- The plain catch handler example now uses the catch result directly while retaining throw errors and valid Effect-handler controls.

- A service with a written shape could omit its body or declare extra static members. It now requires a body containing only `key` and `defaultValue`, preserving its written shape and TypeScript declaration.

- An extra unparenthesized Effect type slot now reports `EK0302` with a grouping repair instead of a missing-semicolon error.

- Complete matches using `error` extractors could report missing cases after matcher registration. Irrefutable captures now retain coverage for plain and schema errors; guarded captures still require another arm or a `default`.

- Legacy JavaScript errors now offer an editor repair for closed native files that keeps their scope in a TypeScript `module`, preserving `var` hoisting and direct `eval`.

- Automatic repairs could run a catch handler's returned error or Effect as a computation; they now preserve that value as data, with an explicit editor action available to run it.
- A preserving call repair could emit an obsolete return annotation and leave a native type error; generated argument functions now use current syntax.

- Converting an error declaration to an explicit class could lose its own matcher and break saved callbacks or tag-based patterns. The quick fix now preserves the matcher on the converted class.
- Class patterns could read an inherited matcher getter and throw before testing the instance. Generated patterns now check ownership first and leave inherited matcher getters untouched.
- Deleting an error class's own matcher could leave tag matching active through its generated base. The class now falls back to native `instanceof` matching.
- Nested callbacks use their own rethrow admission; functions escaping those callbacks still retain the plain-code throw check.
- The global replacement table could turn Node's version string into a component object. It now selects the Node version and retains its leading `v`.
- Following the random-integer replacement could return the excluded upper bound. The guide now uses `halfOpen: true` to preserve the native range.

- The fibers guide omitted labeled `continue` targeting the `for concurrent` loop itself. It now explains that this ends the current item.
- `vibelang --fix` left ordinary incomplete finite matches unchanged. It now adds a `default` that preserves the implicit empty-message `TypeError`, including an Effect defect or Promise rejection, without widening the function's result or channels.

- The legacy `any` call example omitted the native throw-contract error emitted at the same position. The guide now shows both diagnostics.

### Upgrade from 0.0.11

| Before | After and repair |
| --- | --- |
| An unused named `for concurrent` head with `noUnusedLocals` enabled | `TS6133`, as for native `for...of`. Run `vibelang --fix` to prefix an unused head with `_`; a captured or shadowed head name needs a scope-preserving manual rename. |
| A synchronous generator passed to a wrapper, with a call known to throw in its body | `EK0401`: run `vibelang --fix` to retain a supported call in a local TypeScript invocation helper. The generator stays lazy and throws the same value when iterated; parameter defaults keep their original call-time evaluation. |
| `join [a, b]`, `join record` or an effect-body `await` of a fiber collection | `EK1704` / `EK0102`: `join` takes a single fiber. Run `vibelang --fix` to preserve the old collection behavior through an explicit compatibility helper, including reads and failure cleanup. |
| A generic parameter constrained to a service key's value type, such as `Key extends typeof Users` | `EK3002`, `EK3003` and `EK3004` apply through the constraint. Obtain the implementation with `try ServiceName`, implement its shape or inspect its members; choosing that behavior requires a manual repair. |
| Constructing, extending or matching a service key through an intersection-typed alias | `EK3003`, `EK3002` or `EK3004` applies as for the original service. Obtain the implementation with `try ServiceName`; implement its shape or inspect its members. Choosing the implementation or test requires a manual repair. |
| Destructuring `constructor` from a function, or a template-literal `data:` or `blob:` specifier in `import()` | `EK0107`. Keep the read or the inline module in a `.ts` or `.js` adapter. |
| A `using` of a plain Disposable in effect code that relied on disposal after a failed `try`, a defect or an interruption | The disposer now runs only when JavaScript control leaves its scope. Use `acquireDisposable` inside `scoped`, which `EK0801`'s fix writes, for cleanup on every exit. |

## 0.0.11

Update `vibelang`, `vibelang-runtime` and your bundler plugin together to
0.0.11. Use exactly `effect@4.1.1`, the earliest Effect version VibeLang
now supports, with matching `@effect/platform-*` and `@effect/vitest` when
used, and the `@effect/platform-node-shared` override at 4.1.1. Effect's
failure rules from 0.0.10 still apply.

### Upgrade from 0.0.10

- Empty `data` declarations now compile as `never`; remove workarounds that added a dummy variant. This follows VIP-16.

- A computed `schema error` field key whose type may be `"_tag"` now reports `EK2117`: a `string`, an enum or union containing `"_tag"`, a branded string, `any`, `PropertyKey` or a generic constrained by `string`. Give the field a literal key, a literal union without `"_tag"`, a number or a symbol; no automatic fix applies.

- Error payload readonlyness is shallow. Migration-only fixes write explicit readonly on nested payload members that the pre-pin compiler made readonly, preserving published declarations; ordinary fixes retain written modifiers.

- Run `vibelang --fix` to update imports and re-exports of older generated `data` helpers while preserving local bindings and exported names; native TypeScript consumers remain unchanged and need an explicit helper-import update.

- Ordinary interface and object-type members retain their written modifiers during `vibelang --fix --fix-migration-only`.

- The old bare `Effect<number>` alias was accepted without its migration warning; it now reports `EK4856`. The migration fix preserves comments and explicit default slots, uses shorthand when it needs no new parentheses, and retains a qualified type in other positions. Local and imported types named `Effect` keep their meaning. Later style passes keep the qualified spelling when an automatic shorthand edit would change grouping or declaration output.
- A comment containing `function` before an `effect` or `async` modifier could hide a missing-keyword error; the compiler now reports it and the quick fix preserves the comment.
- Effect function expressions could name themselves `fork` or `join`; these names now report `EK1702`, while declaration names follow their enclosing context and method names remain allowed.
- `data` payload readonlyness is shallow. Migration-only fixes write explicit readonly on nested payload members that the pre-pin compiler made readonly, preserving published declarations; ordinary fixes retain written modifiers.

This release changes platform access and name resolution in `.vibe`.
Run `vibelang -p tsconfig.json --fix`, then check the remaining diagnostics
against [Platform globals](../platform/platform-globals.md).
The fixes keep a rewrite only when it adds no compiler error.

| Before | After and repair |
| --- | --- |
| A direct `try f()` with `f(): any` inferred no errors or requirements | Its channels are `unknown`, as for native `yield*`. Declare the actual `Effect.Effect<A, E, R>` return type when known. |
| A service type guard or assertion result captures an enclosing generic type | `EK3005`: choose a concrete predicate result or a member-local generic operation independent of the enclosing type; this contract choice requires a manual repair. |
| A callable service contract whose explicit `this` parameter captures an enclosing generic type | `EK3005`: use a concrete receiver or a member-local generic operation independent of the enclosing type. Choosing that contract needs a manual repair. |
| A throwing callback checked with an inline function type using `satisfies` | Run `vibelang --fix` to retain the structural constraint in a local type-only `module` that admits the callback's thrown type. The callable and inferred public type stay the same. Named constraints, comments and incompatible outer callback contracts need an explicit compatible type or exception-handling wrapper. |
| A throwing callback supplied through a final optional tuple spread | Run `vibelang --fix` to keep the original defect with `Effect.orDie(Effect.try(...))`. Readonly tuples and optional callbacks after fixed prefixes follow the same rule. |
| A `private` or `protected` constructor in `error` or `schema error` | Run `vibelang --fix` to retain it in an Effect TypeScript class, preserving constructor visibility and tag matching. |
| Throwing callbacks passed through optional or nullable `@rethrows` parameters, including `sort` | Run `vibelang --fix` to keep the original defect with `Effect.orDie(Effect.try(...))`. |
| RHS closures in `for concurrent` that formerly captured an outer name with an incompatible type | `--fix` renames the item binding and its uses, keeping the RHS closure on the original outer binding |
| Extra modifiers or `?`/`!` on a whole-shape service’s `key` or `defaultValue`, or a default factory without `readonly` | `EK0902`: run `vibelang --fix` to remove extra header syntax while retaining an existing `readonly` initializer. Supply a missing factory explicitly; adding `readonly` to a mutable default chooses `Context.Reference` fallback behavior and needs a manual migration. |
| An index signature or constructor in `service Name: Type { … }` | `EK0902`: put the signature in `Type` and create the implementation in a layer. Move constructor behavior explicitly; the compiler does not discard or relocate it. |
| Reading `f.constructor` when `f` has a `Function` intersection, inherited interface or generic constraint | `EK0107` now applies through those types. Keep native constructor access in a `.ts` or `.js` adapter, as for a direct `Function` receiver. |
| A `data` variant constructor as a pattern: `when Delivery.Sent:`, `when Delivery.Sent { let tracking }:` or `delivery is Delivery.Sent` | Match the tag with an object pattern (`EK0702`): `when { _tag: "Sent" }:`, `when { _tag: "Sent", let tracking }:`, `delivery is { _tag: "Sent" }`. `vibelang --fix` rewrites a bare variant and a variant with a field list, and refuses a site whose rewrite would report another error. Two forms need a hand: a `let` binding of an optional field, which the tag pattern would require to be present, reads the field from the narrowed subject instead, `delivery.carrier`; a subject of no tagged type whose fields the arm reads needs the data type's own guard, `Delivery.$is("Sent")(value)`, since a tag pattern narrows only a tagged union. |
| Node value imports written as `import FS = require("node:fs")` bypassed `EK4402` | `vibelang --fix` writes `import type` for aliases with no value use. Move actual Node value access to a `.ts` adapter or use the named Effect service. `export import` keeps its value export and requires that manual repair. |
| Unicode escapes in an `error`, `schema`, `service` or `data` declaration keyword, such as `er\u0072or E` | Write the literal keyword (`TS1260`). Run `vibelang --fix` to unescape each keyword while preserving the declaration, escaped names and ordinary identifier expressions. |
| `Key.Shape` for an ordinary native `Context.Service` class without a declared namespace | The native TypeScript namespace diagnostic now applies. The editor and `vibelang --fix` write `import("effect/Context").Service.Shape<typeof Key>` for a non-generic shape reference to that service key, including imported aliases. Explicit namespaces, shadows and type arguments remain unchanged. |
| `for concurrent(record(), 4) (...)` | `for concurrent((record(), 4)) (...)`. `vibelang --fix` preserves the order of evaluation. |
| `vibelang.tracing` or mapper `options.tracing` | Remove the unsupported option. Add named operation spans explicitly with `try withSpan(program, "name")`. |
| `try load?.()` or `try program` with a possibly `undefined` Effect operand | Under `strictNullChecks`, `EK0502` requires narrowing or an Effect fallback before `try`. A callable proven present remains valid. |
| `try load?.()` with `load: any` | An absent call delegates `undefined` and defects with `TypeError`. Write `try (load?.() ?? Effect.succeed(undefined))` to make absence succeed. |
| `when var name:` or a `var` binding in an `is` pattern | Pattern bindings use `let` or `const` (`EK0107`, VIP-7). The quick fix and `vibelang --fix` replace the pattern's `var` with `let`. |
| Bare compound types beside `!`, such as `number!Error \| string` or `number!! \| null` | `EK0301` (VIP-3). Run `vibelang --fix` to preserve the existing channels with parentheses, such as `number!(Error \| string)` or `number!!(\| null)`. To mean an Effect or `null`, write `(number!!) \| null`. |
| A nested Effect error pattern used class identity, such as `Csv.CsvError`. | It now uses the module guard. `vibelang --fix --fix-migration-only` preserves the old class matcher through fresh constructor aliases and call-only extractors, with the same constructor, matcher observations and declared types. |
| `effect@4.0.6` and `@effect/*@4.0.6` | Effect 4.1.1 is now the minimum supported version, pinned exactly: install `effect@4.1.1` and `@effect/*@4.1.1`; the runtime refuses any other version. Effect 4.1 removed `effect/Crypto` and `TestCrypto`, so `Crypto` in a `.vibe` file is the DOM's again. Use `effect/crypto`'s services: `try (try SecureRandom.SecureRandom).randomBytes(16)`, `try (try SecureRandom.SecureRandom).uuidV4()` and `try (try SecureRandom.SecureRandom).intBetween(min, max)` for `Crypto.randomBytes`, `Crypto.randomUUIDv4()` and `Crypto.randomIntBetween`; `try (try Digest.Digest).digest(Digest.sha256, bytes)` for `Crypto.digest("SHA-256", bytes)`; `Mac` and `Signature` for HMAC and signatures. `NodeServices.layer` and `BunServices.layer` no longer provide a crypto service: provide `NodeCrypto.layer`, `BunCrypto.layer` or `BrowserCrypto.layer`. `Experimental.Crypto` keeps its members, and its platform layers provide Effect's crypto services too. Node.js 22.19.0 is the minimum for `@effect/platform-node`. A test terminal built with `Terminal.make` must now supply `size`, a scoped queue of resizes, such as `size: Queue.unbounded<Terminal.Size, Cause.Done>()`. |
| A schema tuple rest uses a local type named `Array` or `ReadonlyArray` | The generic must resolve to the TypeScript library array. Run `vibelang --fix` to preserve an old accepted decoder as explicit `Schema.TupleWithRest` codecs. |
| `Readonly<Record<K, V>>` with a shadowing type or a canonical `Readonly` alias that selects an array | Library bindings now select the mapped codec. Run `vibelang --fix` for rejected shadows or `vibelang --fix --fix-migration-only` to keep a previously accepted decoder explicit. |
| A library `Array` imported as `Record`, then used as `Record<K, V>` | The library binding must match the mapped form and arity. Run `vibelang --fix` to retain the previous record decoder through explicit `Schema.Record` code. |
| `Array<T>` imported as the library `ReadonlyArray`, or the reverse | Normal compilation now uses the library binding. Run `vibelang --fix --fix-migration-only` to retain the previous decoder and public type through explicit Effect codecs. |
| A value after `catch`: `x catch "guest"`, `x catch onErr`, `x catch effect { … }`, `x catch async (e) => 7` | A `catch` handler is a function literal (VIP-5, amended 2026-10-29); anything else is `EK0509`. `vibelang --fix` writes `x catch () => "guest"`, `x catch (e) => onErr(e)`, `x catch effect () => { … }` and `x catch (e) => 7`; a value that is an Effect, such as `x catch Effect.succeed(1)`, becomes `x catch effect () => try Effect.succeed(1)`, which runs it as the old fallback did. In a chain or a conditional's test it parenthesizes the inner `catch`: `(a catch () => b) catch () => c`. |
| Commas between `schema` declaration fields | Separate fields with `;` or a new line. `vibelang --fix` replaces commas with semicolons (`EK1013`). |
| `import { Path } from "effect"`; `Path.Path.join("a", "b")` | Every unambiguous Effect module is global; write `Path.join("a", "b")`. Existing imports still work. `--fix` removes redundant imports and shortens the module's same-named export. |
| The type `Option.Option<number>` | Write `Option<number>`; the long form remains valid. A module's own exports still win over its same-named export. |
| A DOM type named `Cache`, `Console`, `FileSystem`, `Scheduler`, `Transferable` or `Worker` | Bare type names retain their ambient meanings. Values and namespaces name Effect modules; qualify an Effect type, such as `FileSystem.FileSystem`. Emitted declaration imports use fresh aliases. |
| `console.log("hello")`, or holding `const logger = console` | The call was already EK4402; holding the value is newly rejected. Use `Console.log("hello")`; the map lists the Effect service for each platform global. Node/web I/O globals are out of scope outside TypeScript escapes. |
| A value import such as `import { join } from "node:path"` | EK4402, even before a call. Use `Path.join`; for an uncovered API, import it in a named `module` block or a `.ts` file and call through a hatch. A type-only import remains allowed. |
| An entry that manually provides `NodeServices.layer` around `FileSystem.FileSystem.readFileString(path)` | It can start with `import "vibelang/platform/node"` and call `FileSystem.readFileString(path)`; the entry provides the required platform bundle. This spelling is provisional. Existing explicit providers keep working; no import is required for a main with no platform needs. |
| Early 0.0.11 experimental layer imports named `NodeServices`, `NodeCrypto` or `BrowserLocks` | Exports from `vibelang-runtime/experimental/platform-*` now start with `Experimental`: import `ExperimentalNodeServices`, `ExperimentalNodeCrypto` or `ExperimentalBrowserLocks`. Rename the other experimental layers the same way. Imports from Effect's `@effect/platform-*` packages keep their names. |
| Both `import "vibelang/platform/node"` and `import "vibelang/platform/bun"` in one file | EK3206 rejects conflicting imports. Keep one platform import per file; use a separate entry file for each host. Repeating the same platform is allowed. |
| A platform API in a hatch because Effect has no equivalent | Prefer the new `Experimental.FileSystem`, `Experimental.Crypto`, `Experimental.Process` or `Experimental.Locks` where covered. Their layers and platform limits are listed below; an uncovered API stays in TypeScript. |
| `interrupt` alone as a statement | `EK4801`: it previously ran nothing. Choose `try interrupt` explicitly when execution is intended, likewise `try yieldNow` and other Effect values; execution has no automatic quick fix. |
| A bare native Effect value such as `interrupt` or `yieldNow` | Run it with `try interrupt` or `try yieldNow`; `vibelang --fix --fix-vip-only` rewrites `try interrupt()` and `try yieldNow()` that way. `vibelang --fix` also migrates bare `yieldNow(priority)`, `yieldNow()` and `interrupt()` factory calls, preserving held and returned cold Effects and evaluating an optional priority once. For new code, write `try Effect.yieldNowWith(priority)` for a number, or `try yieldNow` for the default priority. These are values; native functions such as `log` still take parentheses. |
| `return x ?? throw c ? a : b` | EK1010: it previously parsed as `(x ?? throw c) ? a : b`, throwing only `c`. Write `return x ?? throw (c ? a : b)`. |
| `throw cause` where `cause` is a `Cause`, as in `when Exit.Failure(let cause): throw cause` | It now fails with the Cause object itself as an expected failure, as `Effect.fail(cause)` does: `throw` fails with the value it is given (VIP-4). It previously rethrew every reason the cause held. To keep that, write `return Effect.failCause(cause)`, as Effect code does. |
| `control Ask { … }`, `try { … } handle Ask.ask(x) { … }`, continuation-runtime bindings or `select { … }` | Outside the first release (`EK3501`, or `EK4607` for `select`). Run `vibelang --fix` for the proven local-service subset; continuation-dependent behavior requires an explicit service or Effect redesign. |
| `return value` in a producer, as in `effect function* upTo(n) { …; return n }` | `EK2128` (VIP-21): a Stream has no return value, and the value was dropped. `--fix` writes `return`, or `{ value; return }` where evaluating the value runs code. |
| `error Sub extends Base { path: string }` when Base's constructor takes a primitive or list | EK2118 at the declaration; before, construction usually failed later with TS2345. Write a constructor that calls `super` with the arguments Base expects. |
| `module { export const value = 1 }` | EK4408 replaces misleading platform/call errors. Name it: `module helpers { export const value = 1 }`. |
| A `module` declaration whose code relies on running before the file's other imports, or an importer that relies on an exported `let` keeping its first value | Each module declaration the file imports is now a JavaScript module of its own, `main.vibe.text.js` beside `main.js`. It runs in its place among the file's imports, after its own imports, and imports of its exports are live bindings; before, every module's imports ran first and an import kept the value the export had when the module ran. Its `import.meta` is its own file's. Order the imports as the code needs them, and ship the `main.vibe.*.js` files with `main.js`. |
| An `await` binding such as `const await = 1` | Rejected in a VibeLang module; rename the binding. It previously compiled despite the reserved word. JavaScript `await` remains available inside TypeScript escapes. |
| A plain object, default or parameter typed with a service's name, such as `const impl: Users = { … }` or `function f(users: Users)` given `Users()`, or a TypeScript class that `implements Users` | TS2739 or TS2420: a service's name is now its identifier, Effect's `Context.Service` instance type, which carries its key, so another service with the same members or a structural type no longer stands for it. Type the implementation `Users.Shape`: `const impl: Users.Shape = { … }`, `static readonly default: Flags.Shape = { … }`, `function f(users: Users.Shape)`. `Users()` has the type `Users.Shape`, as `yield* Users` has. TypeScript writes `implements Context.Service.Shape<typeof Users>`. |
| A package compiled by 0.0.10 that exports a `service` declaration | Its declaration file declared `interface Users`, a key typed with the runtime's `ServiceKey` and a `namespace Users { interface Shape }`; it now declares what Effect TypeScript does, `declare const Users_base: Context.ServiceClass<Users, "<key>", { … }>` and `class Users extends Users_base`, and a service with only a default `const Flags: Context.Reference<{ … }>`. `.vibe` code doesn't change. Recompile the package; TypeScript that wrote `Users.Shape` writes `Context.Service.Shape<typeof Users>`. A `Context.Service` class migrated to a `service` keeps its key with `static readonly key = "…"`. |
| A `match` without `default` whose arms name classes that are not error classes (classes that don't extend `effect`'s `YieldableError`), `Error`, or a class with its own `[Symbol.hasInstance]` or `[customMatcher]` | EK4701: such an arm no longer proves the match covers its subject, and the diagnostic's note names each arm that did not count. Add a `default` arm, or declare the classes with `error` or `Data.TaggedError`. An error class counts wherever it is declared, a `.ts` file or a declaration file included. |
| A package compiled by 0.0.10 that exports an `error` declaration | Its declaration file now declares exactly what `class E extends Data.TaggedError("E")<{ … }> {}` declares. `.vibe` code doesn't change. Recompile the package so its `.d.ts` matches. |
| A trailing block, such as `Layer.effect(Users) { … }`, `it.effect("loads") { … }` or `Effect.scoped { … }` | `EK1101`: Code that compiled before now has a compile error: VibeLang has no trailing blocks (VIP-11). `vibelang --fix` writes the block as the call's last argument, `Layer.effect(Users, effect { … })`, `it.effect("loads", effect () => { … })`, `Effect.scoped(effect { … })`, or `f(x, () => { … })` for a plain callback. Runtime behavior is unchanged; comment printing and equivalent arrow layout can differ. |
| A block after an Effect dual, such as `withSpan("load") { … }`, `timeout("1 second") { … }` or `semaphore.withPermits(1) { … }` | A block is always its call's last argument, so the callee's type no longer moves it. Write the program first, `withSpan(effect { … }, "load")`, or use the curried form, `semaphore.withPermits(1)(effect { … })`. `vibelang --fix` rewrites each site. Where the appended call still type-checks, it is EK1023. |
| `() => fork p()`, or a `fork` in a branch or block | VIP-17 uses Effect's native current-fiber ownership for plain `fork`. Returning or storing the handle does not transfer that ownership. Legacy `EK4838` region diagnostics have no automatic lifetime conversion; choose an explicit owner with `try Effect.forkScoped(program)`, `try Effect.forkIn(program, scope)` or `try Effect.forkDetach(program)` when intended. |
| A function that is an Effect function because of its body or its return annotation, such as `function load(id: string) { return try getUser(id) }`, a method like it, or a function literal passed where an Effect function is expected, as in `forEach(ids, (id) => getUser(id))` | Mark it `effect` (VIP-1), which goes exactly where TypeScript allows `async` (VIP-39): `effect function load(id: string)`, `effect (id) => try getUser(id)`, or a method `effect find(id)`. A function literal with no parameters that became a program where an Effect was expected, `retry(() => save(x), policy)`, is an effect block (VIP-2): `retry(effect { return try save(x) }, policy)`. `vibelang --fix --fix-vip-only` writes both, with `try` before a value such a function runs, and keeps a function that compiles to plain JavaScript unmarked. Only `effect` makes an Effect function: a function without it is plain JavaScript, returns an Effect it builds unrun, and gains no Effect type from its body or from where it is passed; `try` in it is `EK0501`, and a return type written on an `effect` function is an Effect type, `User!NotFound`, where `User` alone is `EK0106`. Run the codemod before you upgrade: this release no longer infers which functions to mark. A declaration without `function`, `effect load(id) { … }` or `async get(url) { … }`, is `EK0101`; its quick fix writes `effect function load(id)`. |
| A call of an Effect value: `Users()` for a service, `Port()` for a Config, `body()` for an Effect parameter, or `Journal.read()` for a service member that is an Effect | `TS2349` or `TS2348`: an Effect is not a function, and only `try` runs it (VIP-5); a service is read with `try Users` (VIP-10). `vibelang --fix --fix-vip-only` writes `try Users`, `(try Users).find(id)`, `try body` and `try (try Journal).read`, and drops the argument list from `try Users()`. |
| `async function load() { … }`, and `await` inside it | No longer EK1003: an `async` function means what it means in TypeScript (VIP-1), and `await` there waits for a promise. Awaiting an Effect there is EK4617: write `await runPromise(program)`. |
| `using h = Effect.acquireRelease(() => openDisposable(), release)` with a plain-holder workaround | The acquisition's release is now the only release, so `using` no longer also calls `[Symbol.dispose]()`. Bind the Disposable directly and drop the holder. |
| A package compiled by 0.0.10 that exports a `schema` declaration | Its declaration file declared the type as `interface User extends Schema.Schema.Type<typeof User> {}`; it now declares what Effect TypeScript does, the constant and then `type User = typeof User.Type`. `.vibe` code doesn't change. Recompile the package so its `.d.ts` matches. A TypeScript consumer can no longer merge declarations into the type, as with Effect's own alias. |
| `using n = count()` where the value has no disposal method and the initializer needs no `Scope` | TS2850. Bind it with `const`, or acquire it with `acquireRelease` so its release is recorded. |
| `const spawn = fork`, `const run = sync`, an import that renames `fork`, `join`, `sync`, `try` or `callback`, or `R.fork(x)` through a namespace import of the runtime | EK4410: a call spelled otherwise read its first operand by a binding its reader cannot see, so `spawn(work())` deferred `work()`. Call each under its own name where it runs; to pass forking as a function, write `(job: () => A!E!R) => fork job()`. In a `module` block the runtime's functions stay ordinary values. |
| A pause in a `using` initializer, such as a wait in the function that opens the resource | Cancellation now follows Effect. Every initializer runs with the interruptibility in force where the `using` stands, whether or not it requires `Scope`, so cancellation reaches its waits and `using` registers nothing. A `timeout` around `using db = openDb()` now ends at its deadline instead of waiting for `openDb`. To wait one out, write `using db = Effect.acquireDisposable(() => openDb())`: its acquisition holds cancellation off, and `using` adds no second release. |
| A package compiled from VibeLang whose consumers call its plain functions from Effect code | Its build now writes `vibelang.manifest.json` beside its declarations, listing each declaration file emitted from a `.vibe` file. Consumers check each callable's emitted `@throws` contract; the retired `trustedPackages` setting is ignored. Publish the manifest with the declarations: add it to `files` in `package.json`. Stock TypeScript ignores it. |
| An Effect function held where a declared type makes it plain: `runAll(fs)` with `fs = [tick, tick]` and `runAll(fs: ReadonlyArray<() => unknown>)`, `const cb: (n: number) => void = logged`, an object such as `{ onSave(doc: string) { … } }` passed as `{ onSave(doc: string): void }`, or `const r: Resettable = new Counter()` whose unannotated `reset()` is an Effect method | EK4301: the caller of the plain type would drop the program unrun. These compiled before; only an Effect function passed by name or in an array written at the call was caught. Annotate the function or method with its plain return type, `(): void`; write `class Counter implements Resettable`, which makes `reset()` plain; or declare the destination to return an Effect, `() => void!!`. |
| A TypeScript caller of a `trusted(impl, [Errors])` value, such as `Effect.runSync(rows())`, or a `.vibe` file that passes one to `map` | `trusted` now returns one plain function of `impl`'s type, carrying its classes as `f[$errors]`: a TypeScript call returns what `impl` returns and throws what it throws, so drop the `Effect.runSync`. A VibeLang call still makes a listed exception an expected failure. `lines.map(slugify)` passes a value with an empty list and is EK4301 for one with listed classes; use `Effect.forEach(lines, slugify)` there. |
| `fork(() => work())`, a `fork` whose operand is a function | `EK1703` (VIP-17): `fork e` is `Effect.forkChild(e)`, so its operand is an Effect. Write `fork work()`, or `fork job` for an Effect `job`. |
| `await.all [a(), b()]`, `await.race`, `await.any` or `await.allSettled`, or `await.all { a: a(), b: b() }` | EK1802 (VIP-18): the await operations are retired. `vibelang --fix` writes `try.all`, `try.race`, `try.any` or `try.allSettled` over explicit Effects, so each element still runs when the operation runs, and an object becomes `try all({ … }, { concurrency: "unbounded" })` with its keys in the order written. `try.allSettled` gives each element's `Exit`; where the old operation gave a `Result`, `--fix` writes `all(…, { concurrency: "unbounded", mode: "result" })`. |
| A `schema` field typed `unknown`, `any`, `never`, `object` or `void`, such as `schema Event { payload: unknown }` | EK2109 (VIP-15): among keyword types only primitives map to a schema. Name the schema instead, `payload: Schema.Unknown`; `--fix` writes it. |
| An abstract class used as a service | EK4854 (VIP-9): write a `service` declaration. `--fix` removes the class spelling and preserves its members and key. Abstract classes now have ordinary TypeScript semantics. |
| `static readonly default = shape` on a service | `EK4855` (VIP-9): `--fix` writes an equivalent native `Context.Service` class for a local key, retaining eager initialization, cached identity, field and type reads, shape mutability and missing-provider failure. An exported key, commented body or key with `defaultValue` needs an explicit native class migration. |
| `A!E` on a function with a body inferred its requirements | EK4853 (VIP-3): every omitted slot is `never`, exactly as in `Effect<A, E, R>`. `--fix` writes the requirements previously inferred from the body. Leave out the annotation to infer the whole contract. |
| `for (const x of stream)` or native `for await (const x of stream)` | Native loops keep JavaScript iteration and TypeScript operand diagnostics. Choose `for try (const x of stream)` explicitly for `Stream` consumption inside effect code; `for await` in effect code is `EK0102`. |
| `try do { …; value }` in effect code whose value is not an Effect, such as `try do { try sleep(d); "late" }` | The `do` was a program that `try` ran; it now runs where it stands and `try` runs its value (VIP-2), so a value that is not an Effect is `EK0502`. `vibelang --fix` writes `try effect { return do { … } }`, which runs the block when `try` does and keeps its completion value. |
| A `do { … }` passed where an Effect is expected, such as `exit(do { 1 })` | `do` always runs immediately (VIP-2). `vibelang --fix` writes `exit(effect { return do { 1 } })`, delaying the block until the Effect runs and keeping its TC39 completion value. Ordinary `do` expressions stay immediate. |
| Nested `schema` aliases using `unknown`, `any`, `never`, `object` or `void` | Run `vibelang --fix` to write `Schema.Unknown` and keep the previous decoding and public declaration. The editor also offers the keyword’s explicit schema when that change is intended. |
| A `schema error` payload referencing a mutable-key codec, or a required payload referencing an optional-key codec | `EK2109`: run `vibelang --fix` to retain the codecs and decoding in an explicit Effect TypeScript class. |
| Nested `schema` aliases containing named, optional or rest tuples | Normal compilation now maps the tuple positions. Run `vibelang --fix --fix-migration-only` to retain the previous `Schema.Unknown` placeholders and public declarations through explicit Effect codecs. |
| Generic `data` with a default, such as `data Box<A = string>` | `EK2803`: run `vibelang --fix` to retain the default on an equivalent Effect TypeScript type alias and preserve the constructors. |
| A non-schema object used as a `schema` alias | If it has a public `Type` member, run `vibelang --fix` to expand the alias into its original `const` and `type` declarations. |

Direct platform calls such as `console.log` and `process.env.NAME` were
already EK4402 in 0.0.10; holding their values and importing Node values
are newly rejected. The trailing-throw example compiled with an inferred
return in 0.0.10 and is now EK1010; a restrictive return contract could
already reject it with EK2001. A nameless module already failed with less
useful diagnostics. The DOM type example, bare program statements,
primitive-base declaration, effectful method under a plain annotation and
`await` binding compiled then and are rejected now.

Before installing the packages or running the checks, update the existing override in `package.json` to `4.1.1`:

```json
{ "overrides": { "@effect/platform-node-shared": "4.1.1" } }
```

With npm:

```sh
npm install --save-exact vibelang-runtime@0.0.11 effect@4.1.1 @effect/platform-node@4.1.1
npm install --save-dev --save-exact vibelang@0.0.11 vibelang-vite@0.0.11 @effect/vitest@4.1.1
npm run build
npm test
```

With Bun:

```sh
bun add --exact vibelang-runtime@0.0.11 effect@4.1.1 @effect/platform-node@4.1.1
bun add -d --exact vibelang@0.0.11 vibelang-vite@0.0.11 @effect/vitest@4.1.1
bun run build
bun run test
```

Projects using another bundler update `vibelang-unplugin` to 0.0.11
instead of installing the Vite plugin. See the 0.0.10 notes below for the
Effect 4.0.6 defect-precedence and interruption migration.

### Effect globals

- Every export of Effect's `Effect` module is a global in a `.vibe` file
  ([VIP-6](https://github.com/smithersai/vibelang/blob/main/docs/design/vips/0006-effect-globals.md)),
  not only the 15 most used: `tryPromise`, `promise`, `map`, `andThen`,
  `result` and the rest need no `Effect.` prefix, and the emitted JavaScript
  imports each one used from `effect/Effect`. A local declaration or import
  shadows one. A name that is a reserved word, a JavaScript global or a
  VibeLang keyword stays `Effect.x`: `Effect.try`, `Effect.undefined`,
  `Effect.match`. Set `"vibe": { "effectGlobals": false }` to turn the
  globals off ([Effect's modules](../getting-started/008-importing-effect.md)).

### Configuration upgrade

| Before | Now |
| --- | --- |
| A written Effect return slot such as `Effect.Effect<A, infer E, R>` or `A!(infer E)!R` | Run `vibelang --fix` for `EK4857`: it writes the inferred slot types, or omits an all-`infer` return annotation while preserving its declared API. New code omits the annotation to infer its return type (VIP-3). |
| A schema field with a JavaScript initializer | `TS1247`: run `vibelang --fix` to remove the ignored expression. Choose an explicit codec default when a default is intended. |
| A required schema field whose referenced codec has optional or uncertain decoded key flags | `EK2109`: run `vibelang --fix` to keep the existing codec as an explicit `Schema.Struct` value. Written optional fields keep their optional behavior. |
| A `Record` value referenced optional decoded keys or a readonly `Record` referenced mutable decoded keys | `EK2109`; `vibelang --fix` preserves the existing codecs, declarations and decoding. Schema-error declarations retain their constructors and matchers. |
| A schema reference with an empty type argument list, such as `schema Name = Address<>` | `EK2109`: run `vibelang --fix` to remove the empty list. The codec, decoded values and declaration types stay the same. |
| A schema field with repeated `readonly` modifiers | `TS1030`: run `vibelang --fix` to keep one modifier and preserve its codec. |
| The `try` hatch, `try((text) => parse(text), (e) => new Bad({ e }), text)` | EK4616: `try` is an operator that runs an Effect (VIP-5), so `try(…)` is no longer a hatch. Wrap the code with Effect's own `Effect.try` or `Effect.tryPromise` and run it with `try`: `try Effect.try({ try: () => parse(text), catch: (e) => new Bad({ e }) })`. `vibelang --fix` rewrites each hatch, writing an arrow's body as the thunk with its inputs bound to its parameters, or else passing its inputs to its function, and refuses one whose inputs run code. A function that is not `async` but returns a promise is no longer awaited: write it `async`, or wrap it with `Effect.tryPromise`. The function `Effect.try` or `Effect.tryPromise` wraps is TypeScript, as a hatch's is: a `throw` there is JavaScript's, for the wrapper to catch, while platform APIs such as `fetch` still report `EK4402` in a `.vibe` file; keep native platform work in a sibling `.ts` adapter. `import { try } from "vibelang-runtime"` no longer resolves. |
| `/** @throws {E} */` or `@rethrows` in a `.vibe` file | `EK0406` (VIP-4, amended 2026-10-31): VibeLang functions never throw. Run `vibelang --fix` to remove the tag, and write an `effect` function's failures in its error type, such as `number!NotFound`. |
| `vibelang.diagnostics` | Run `vibelang --fix` to move configurable warning settings to `vibe.severities`. Remove obsolete legacy policy entries before rerunning `--fix`. |

### Diagnostic codes

| Before | Now |
| --- | --- |
| Old diagnostic numbers, including `EK4617` | Appendix B numbering, including `EK0103`. Diagnostic triggers are unchanged. See the [old-to-new map](../vibelang-features/diagnostic-code-map.md). |
| Unused host namespace aliases such as `import NativeModule = WebAssembly.Module` | `vibelang --fix` removes already-erased aliases. Move a needed alias into a `.ts` adapter or use the injected Effect service. |

### Bugs fixed since 0.0.10
- Throwing callbacks passed through fixed tuple spreads could bypass throw checks or use the wrong parameter contract. They now keep their thrown contract and argument position, and `vibelang --fix` can preserve their defects with an Effect bridge.

- Calling a parameterless `effect function` declaration could invoke or throw from a replaced `Function.prototype.apply`; it now constructs its unrun Effect without that extra lookup.
- `is` bindings in `for concurrent` and `for try` heads now retain their lexical homes and per-item values. Native catch annotations `any` and `unknown` retain TypeScript behavior; `is` bindings in those parameter homes report `EK0705` instead of retired catch and home errors.
- The grammar admission audit could mistake TypeScript assertions on loop targets for undefined syntax. It now derives asserted `for … of`, `for … in` and `for await … of` targets while retaining malformed-head restrictions.
- The grammar admission audit could mistake a native `for … of` target named `async` inside an async callable for undefined syntax. It now follows that context through nested callables while preserving plain-body restrictions.
- The grammar admission audit missed an invalid module-level `for … of` target named `async`. It now records that parser-context gap separately from native async functions and `for await` heads.
- The grammar admission audit could mistake a valid `for await … of` target named `async` for undefined syntax. It now derives that native form while retaining the ordinary `for … of` restriction.
- The grammar admission audit could mistake an already rejected `for … of` head named `async` for undefined syntax. It now recognizes the native `TS1106` error while preserving ordinary identifier and property targets.
- The grammar admission audit could miss an incomplete computed member after a combined pattern. It now tracks that existing parser gap through `and`, `or` and `not` while preserving pattern boundaries.
- The grammar admission audit missed an incomplete computed pattern member split across lines. It now records that parser gap while retaining class-pattern type errors as semantic diagnostics.
- The grammar admission audit could mistake native type-only and mixed import clauses for undefined syntax. It now derives those forms while retaining local binding restrictions.
- The grammar admission audit could mistake rejected import declarations and default export assignments with modifiers for accepted syntax. It now recognizes their existing native errors.
- The grammar admission audit could miss an invalid `static` schema modifier when its field name started on a new line. It now records that form under the existing diagnostic gap.
- The grammar admission audit could mistake default exports containing objects, functions or classes for undefined syntax. It now derives these ordinary TypeScript forms.
- The grammar admission audit could mistake keyword or string-literal export names for undefined syntax. It now derives native export names while preserving import binding restrictions.
- The grammar admission audit could misreport valid type-only exports and trailing commas in named export clauses as undefined syntax. It now derives these ordinary TypeScript forms.
- The grammar admission audit could misreport an invalid export declaration as accepted syntax. It now recognizes the compiler's existing modifier error while preserving valid exports and name errors as controls.

- The relocated declaration example now matches its owning source root and retains native identity boundaries for symlinks and unproven mappings.

- Invalid `@throws` and `@rethrows` tags require a manual edit that preserves descriptive documentation.
- Migrating `trusted(f, [])` keeps public declarations, capture timing, and the identity of thrown defects.
- Promise-producing call examples now show the boundary error alongside independent host-access and root-runner errors.
- Error-family examples use native class tests and object destructuring, retaining subclass tags, catch routing, public declarations, and runtime results.
- Pattern predicate checks use an explicit source callable for an unannotated foreign predicate, retaining every matching result and the guarantee that global objects stay untouched.
- Plain catch handlers returning tagged errors as data keep the Effect-result advisory; the returned error objects and migration behavior remain covered.
- Unknown foreign calls in plain code no longer require a retired platform diagnostic; effect code still requires an explicit throwing-call boundary.

- Declaration-check failures repeated full library paths until their logs became unreadable. They now report a total and bounded examples of distinct library names.
- Contributor diagnostic identity checks could reject later compiler fixes. They now verify the recorded allocation transition while retaining checks against changed checker predicates in that transition.

- Producer return contracts accept `any`, `unknown`, aliases, and compatible unions as TypeScript does; incompatible contracts remain errors.

- Stream-loop diagnostics identify outward returns, labeled jumps, and invalid operands directly, without an unrelated generic head error.

- Invalid data-method calls keep their native missing-property errors without unrelated inferred-argument advice.

- Tagged-data pattern examples match variants by their tag, and renaming payload bindings keeps the original property names.
- Following the platform clock mapping could change a timestamp's origin on Node. The guides now use differences for elapsed time and explain how to retain native performance timestamps.

- Throw-repair examples retain declaration types, initialization order, iterator cleanup, and exact failure channels across a wider range of input values.
- The error inheritance example now records every forbidden declaration and retains the independent native property-type error.
- A rejected producer `yield*` could hide native iterator errors inside its operand. Those errors now remain visible beside `EK2103`.
- Platform misuse reports keep callback contract errors alongside the platform diagnostic, so each invalid argument remains visible.
- Calls through `any` or `Function` could bypass the foreign-call check in effect code; they now require an explicit bridge, and `vibelang --fix` preserves thrown exceptions as defects.

- Concurrent operators could hide a literal's `satisfies` error or add an unrelated array error. They now preserve the literal's own TypeScript errors beside `EK1801`.
- Error-class custom matchers could lose their tag when saved or called with a subclass receiver. Plain errors now own their matcher, and both error forms return the original subject in either matching mode regardless of the caller's receiver.

- Self-namespace-export declaration tests repeatedly loaded unrelated browser libraries. Their native validation and API comparison now select ES5 while retaining assignment, nominal-type and changed-export checks.

- The cross-source declaration example now checks the TypeScript import route while retaining its original JavaScript runtime results.

- The host-clock example now checks the platform diagnostic and verifies that retired clock severity settings cannot hide a host access.

- Invalid Stream loop heads now have regression coverage for the single owning diagnostic, without obsolete parser cascades.

- The object runner example now retains Promise values through explicit synchronous boundaries, without running stored work or changing call order.

- The process identity example now reads its native comparison through an explicit boundary, retaining native values and unexpected defects.

- The interruption example now uses lexical masks and retains its restored interruption result and outward return value.

- The Option match example now checks direct consumption without a spurious generic-argument warning, while retaining its match advisory and runtime results.

- The plain runner example now creates its Promise through an explicit synchronous boundary and awaits it at the original later step.

- The service member example now retains the teaching advisory on its valid native service class alongside every invalid-member error.

- The optional callback example now shows the possibly undefined operand error alongside its existing failure and service contract errors.

- Setup examples now verify the original TypeScript build and emit outcomes while retaining printed lint diagnostics and explicit author overrides.
- The compatibility severity example now checks every interim diagnostic against all supported severity spellings and keeps their configuration rejection explicit.
- The Fiber diagnostic example now includes the accepted array and object forms while retaining its guidance for waiting on a Deferred.
- Lint activation examples now distinguish unconfigured projects from preserving legacy severity migration and retain the migration warning.
- The grammar admission audit still expected an invalid `join` for-of head to be accepted. It now retains the original examples as syntax-rejection controls.
- The grammar admission audit omitted concurrent-operand diagnostic coverage. It now accounts for that helper under the existing array-operation rule.
- Following the platform table could turn file bytes into decoded strings. It now preserves the default read as bytes and explains the UTF-8 text alternative.
- Conditional-import declaration tests repeatedly loaded unrelated browser libraries. Their native validation and API comparison now select ES5 while retaining `import` and `require` branch checks and changed-dependency errors.
- Setup now preserves unpatched compiler lint exit behavior when plugin settings are inherited from an owned shared configuration, while retaining explicit author overrides.
- The invalid catch-value example now shows its syntax error without an unrelated generic-call advisory, while retaining independent native errors.
- An invalid or misplaced `for try` could hide iterator errors inside its operand. Native iteration, spread, destructuring and delegation errors now keep their own diagnostics.
- Generated-contract declaration tests repeatedly loaded unrelated browser libraries. They now select ES5 and independently validate each declaration while retaining authored documentation and contract checks.
- Empty Effect functions and blocks could share one Effect value across separate constructions, changing explicit equality results. They now follow their `Effect.gen` construction counterpart; reusing a saved Effect still shares that value.

- The legacy JSON advisory example now enables its warning through the supported project configuration and retains the disabled default.

- Contributor provider checks confused missing providers with an Effect-version mismatch. They now verify the distinct diagnostic identities and retain their provider coverage checks.

- The declaration example for a service with a whole written shape now matches its TypeScript counterpart without adding an extra exported namespace.

- Physical-sidecar declaration tests repeatedly loaded unrelated browser libraries. Their native validation and API comparison now select ES5 while retaining physical import resolution, missing-dependency and changed-type checks.

- Release notes placed pending fixes under a version beyond the current compiler candidate. Those fixes now remain with the candidate until it is published.
- Contributor optional-call examples passed foreign helpers without the required no-throw contract. Those pure helpers now declare their contracts; unannotated callback rejection remains checked.
- Contributor declaration checks expected an inferred import spelling that differed from TypeScript. They now use the native spelling and verify suffix and path variations against stock TypeScript.
- Global-augmentation declaration tests repeatedly loaded unrelated browser libraries. Their native validation and API comparison now select ES5 while retaining self, copied and changed-type checks with both compiler versions.
- Contributor checks could mistake a diagnostic expectation update for newly rejected code. Changing only the first-line expected code list now preserves existing rejections while checking new errors and program changes.

- Adding a platform guide example could make contributor checks report errors against a different example. Checks now follow named example files when their positions change.

- Generic service declarations could lose their error when another member was invalid; both errors are now reported.
- A rejected service member could hide an enclosing type parameter in another member's contract; the compiler now reports that capture.
- Rejected whole-shape service members could add a misleading generic-capture error; only the written shape now determines that error.
- Invalid service keys could hide errors in their expressions and type annotations; those TypeScript errors now remain visible.

- Object patterns could read a getter or test a property more than once across match arms. They now retain each property observation for one `match` or `is` evaluation.
- Requesting an unavailable extra compiler for declaration checks could silently rerun the default compiler. It now reports the requested compiler's load or API error.
- Following the platform tables could drop the executable and script entries from an argument list. They now distinguish `Stdio`’s user arguments from the full `process.argv` array.

- The throwing-callback example now writes its foreign contracts explicitly and retains every expected failure when a local parameter shadows the constructor name.

- Contributor forms examples still required the retired declaration manifest. They now verify its absence while retaining declaration and runtime checks.
- A migrated service contract could unexpectedly qualify another requirement beside `FileSystem`. The FileSystem guide now explains why both `FileSystem.FileSystem` and `Path.Path` appear.
- The editor's receiver-refusal checks assumed a retired finalizer would still produce a suggestion. They now retain the refusal when a client sends a stale suggestion, alongside current valid suggestion sites.

- The platform migration guide and experimental module catalog omitted the pure scoped IPv6 predicate. They now show `Experimental.NetAddress.isIPv6` and explain its Node-compatible zones without a service or layer.
- Schema-error repair checks stopped at a separate retired inheritance clause. They now migrate that clause independently and still verify family encoding, decoding and child identity.

- Joining a value typed `any` or `never` incorrectly reported `EK1704`. Those types now follow TypeScript's operand assignability, while `unknown` still needs narrowing.

- Contributor checks rejected the scoped IPv6 diagnostic example because its sample address was missing. The example now has a typed string input in the check.

- Repairing a throwing call in a class base or a schema error field now preserves defects and produces valid, repeatable source.

- Migration declaration snapshots could lose project types such as `NodeJS.ProcessEnv` and reject an unchanged API. They now retain the original project’s type selection and module-resolution context.

- Compound extractor patterns could repeat matcher calls and reject regex bindings with spurious TypeScript errors. They now capture each extraction once and preserve the binding types.
- Passing a generic foreign method to a rethrowing helper could require a bridge even when its selected thrown type was `never`. Callback checks now retain the receiver’s type arguments.
- Contributor documentation checks rejected the expanded foreign-call repair guidance. They now verify both defect preservation and the conditions for adding a no-throw contract.
- Two compatibility diagnostics gave undefined execution advice. Their explanations now name `try` as the Effect consumer.
- The CLI guide incorrectly said published `error` and `schema error` declarations add generated matcher members and a runtime type reference. It now describes their TypeScript declaration surface and runtime matcher behavior.
- Contributor catch-result examples constructed a Promise without the required explicit boundary. They now retain that Promise as data through the boundary while checking identity and lazy thenables.
- Contributor resource-binding checks omitted the accepted Effect cleanup warning. They now verify it alongside unchanged disposal and jump errors, including severity overrides.
- The bundled coding skill repeated platform guidance with conflicting service lists. It now lists each platform bundle once and retains the DNS transport requirements.
- Migrating a tracked source under an ignored directory could remove it from repository snapshots. Renames and returns now retain the exact authored path while leaving unrelated ignored files excluded.

- Catch-variable examples using type-keyword names could corrupt type annotations or use a forbidden synchronous `throw`. They now assert only the variable value and acquire the caught value through a controlled TypeScript helper.

- The throwing match-arm example could fail TypeScript's impossible-comparison check. It now uses a general `boolean` parameter and retains the selected failure.
- The `Experimental` namespace documentation described every addition as a service; it now makes clear that pure modules need no service key or layer.
- Contributor pipeline checks stopped on empty markers before checking implemented missing-topic diagnostics. Both direct and nested cases now run, with positive topic controls.
- Contributor build checks could miss tool declarations, cache prerequisites and omitted regressions. A bounded check now verifies these contracts before compiler jobs run.
- Contributor declaration checks rejected generated no-throw metadata or added it to the TypeScript reference. They now compare unmodified references while preserving exported types and authored comments.
- Match coverage checks could reject correct boxed-string matching or a harmless temporary-name change. They now exercise both string forms and retain the branch check independently of generated names.
- Contributor API checks loaded browser declarations while comparing aliases of built-in generic types. Those fixtures now load only their ECMAScript declarations.

- A misplaced `fork` or `join` operator could hide errors inside its operand. Those TypeScript errors now remain visible beside `EK1701`.
- Parameterless Effect arrows and function expressions with several statements could lose their source names, and arrows could become regular functions. They now keep their source callable form and name while their bodies remain cold.

- `--fix` could report both an `Effect.fn` wrapper and an immediate call of its returned function. It now reports the wrapper once.

- A rejected service member could hide an invalid key; the compiler now reports both member diagnostics.
- Contributor cache warmup omitted the Effect lint package and recompiled it during validation. The warmup now includes it.
- Contributor validation omitted stale-manifest preservation checks. It now runs both disk and editor regression cases.
- Contributor API checks failed after a comparison helper moved into another file. Their fixtures now include local helper dependencies transitively.

- Ambient overload-order declaration tests repeatedly loaded unrelated browser libraries. Their native validation and API comparison now select ES5 while retaining isolated overload results and changed-export checks.
- A written `./target.ts` import could silently select `target.vibe`, even ahead of `target.d.ts`. It now keeps TypeScript's native substitutions and reports `TS2307` when none exists.
- Contributor checks omitted the retired declaration-import option regression and expected its old warning text. They now verify the native TypeScript wording and unchanged nonfatal behavior.
- Peer-context declaration tests repeatedly loaded unrelated browser libraries. Their native validation and API comparison now select ES5 while retaining distinct peer resolutions and changed-peer checks.
- Merged namespace declaration tests repeatedly loaded unrelated browser libraries. Their native validation and API comparison now select ES5 while retaining type, value, name and documentation changes.
- Migration sidecar checks could reject valid declaration routes after TypeScript inferred a source root. They now qualify explicit, inferred and composite layouts against TypeScript's declaration output.
- A declaration before `for concurrent` in a labeled block could reject a valid `break` from its iterable with `EK0205`, or accept an invalid `continue` to that block. A `break` from the iterable can now leave the enclosing block, and a labeled `continue` must name the loop itself.
- Converting a `Schema.TaggedError` field could narrow its schema input type when the codec moved into a constant. The repair now preserves the original contextual type on that constant.
- JSX inside a native `module` body in `.vibex` failed to parse; bodies now support TSX syntax, format JSX and emit `.jsx` under `jsx: preserve`, with matching imports and declarations.
- Contributor checks mistook the compiler’s sharded tests for a missing target. They now verify the runtime build dependency of every shard.
- Contributor diagnostics checks could compile a second set of packages with workspace paths. They now use the compiler’s `-trimpath` settings.

- A `for try` loop with a possibly missing Stream could show duplicate nullability errors. It now reports `EK2004` once and preserves independent errors in the operand and loop body.

- A rejected `join` operand could hide errors inside its arguments. Those TypeScript errors now remain visible beside `EK1704`.

- Rejected `try.all`, `try.race`, `try.any` and `try.allSettled` operands could hide errors inside calls, assertions and literals. Those TypeScript errors now remain visible beside `EK1801`.
- A misplaced `fork` statement, including in a class static block, could report a discarded-Effect error alongside `EK1701`. It now reports the owning placement error alone; ordinary discarded Effect calls keep their diagnostic.
- Destructuring a generic foreign method into a `const` could lose its thrown type and require an unnecessary bridge. Nested object patterns now keep the resolved receiver’s contract.
- The Effect type guide now shows the grouping used when repairing nested Effects and array boundaries.
- The error guide now explains why a reserved tag payload and an inheritance clause each report an error, and how a native class retains their contract.
- The error guide now explains how bodyless, empty and payload-bearing ambient schema errors convert to erased native classes.

- The grammar admission audit could stop on a static schema field with an unresolved type. It now tracks that separate diagnostic gap without treating keyword-named fields or methods as the same form.

- The grammar admission audit could stop on an async schema field with a `static` prefix. It now records the existing modifier-diagnostic gap while preserving static properties, methods and keyword-named fields as controls.
- Extracting a generic foreign method into a local `const` lost its thrown type and could require an unnecessary bridge. Aliases now keep the receiver’s substituted contract.
- Long Go checks could omit compiler and test subprocesses from their progress records when Go started them on another thread. Progress sampling now includes those thread-owned subprocesses.
- A whole-repository migration could change documentation examples or JSON test data and spend excessive time scanning prose. It now leaves those files unchanged while updating source and configuration paths.
- The Bun testing guide now explains how to set a longer deadline for service-initialization tests without changing their Effect lifetime.

- Vite rejected typed `.vibex` inputs with a JavaScript parse error. The adapter now compiles native JSX before parsing, passes preserved JSX to framework transforms, and retains source locations through development updates.

- Renaming or reverting a source could leave dependent projects reading stale build outputs; migration now rebuilds affected projects and their dependents before checking them.

- Declaration text comparison could report a difference when a class extended a value whose name also had an unused private type alias. It now distinguishes class base values from type references while preserving observable aliases.

- Callback-factory migration coverage rejected valid data-first `Option` namespace calls; it now accepts those rewrites while comparing eager evaluation order and runtime results with TypeScript.

- Migration could rename a source while a computed Vite build entry still named its missing TypeScript path. It now refuses a matching template or concatenated filename before renaming, identifies the entry and source, and preserves the original build command.

- Migration verification could reject an inherited declaration error after its quoted module acquired a `.ts` or `.js` suffix. It now accepts that spelling change only when both paths resolve to the same declaration and the complete diagnostic evidence agrees.

- `JoseError` extractors could report `EK0704` and bare patterns could miss branded errors from another installation. They now use Effect's `isJoseError` guard through imports and immutable aliases.

- Migrated helpers with an inferred return could expand a written `ReturnType` assertion in declarations. They now preserve the assertion and its imported name.

- A closure in the iterable expression of `for concurrent` could not refer to the loop-head binding, or captured an outer binding instead. It now retains the uninitialized head binding, including destructuring, so calling it after the loop throws `ReferenceError`; a written limit still reads the enclosing scope. When the corrected head type rejects an old outer capture, `--fix` renames the item binding and its uses while preserving that outer capture.
- Migration receipts could label an older native compiler as a newer producer; staged conversions now pin the executable digest and revision, and reject mixed compiler receipts.

- `FuzzFixGate` could pass without exercising cross-file refusals after explicit effects were introduced; its two saved examples now require a real narrowing refusal.

- A comment after the semicolon of a `schema` body could disappear from declarations, including a comment before its written type alias. Declaration emit now retains it in TypeScript’s position.
- Converting `.pipe(...)` could interleave stage construction and application, read options early, or change a custom stage’s receiver. The quick fix now preserves construction order and declines custom stages that may observe the receiver supplied by `.pipe`.

- `vibelang --build --fix` rejected project-reference builds. It now applies each project's safe source and config repairs in dependency order before building.

- `vibelang --fix` silently left plain `Effect.fn` callbacks wrapped. It now preserves them and reports why they require a manual rewrite.

- `--fix` could leave annotated `Effect.fn` generators with later pipeline stages unchanged. It now converts them while preserving the generator's return contract before applying those stages.

- Legacy throw expressions before commas had no automatic migration. The editor and `vibelang --fix` now parenthesize the whole throw, including VIP-only upgrades, and the compiler reports the retired spelling as an error.

- The grammar admission audit could stop when an unsupported `import.meta` value occupied a static import or export specifier. It now records that diagnostic gap while keeping ordinary metadata reads and dynamic imports as controls.

- The grammar admission audit could mistake valid bitwise AND and XOR expressions for undefined syntax. It now derives these TypeScript expressions, including their continuations after an `is` pattern.
- The declaration guide now distinguishes generated no-throw metadata from authored documentation when comparing TypeScript APIs.
- The CLI guide now distinguishes the explicit program and callback arguments produced when repairing a legacy trailing block.
- The CLI guide now explains the cached value identity, type reads and initialization behavior preserved by a service default repair.
- The CLI guide now explains how an explicit service key keeps standalone migrations focused on their intended repair.
- The CLI guide now explains how to call throwing validation helpers from Effect code while retaining the original thrown value.
- The devtools guide's `hostname` repair example called an Effect like a function and failed to compile. It now runs the service's Effect-valued property with `try`.
- Invalid whole-shape service keys could also report a misleading inheritance error. They now report `EK0901` once and retain independent errors.
- Selected Effect lint rules skipped Vibe inputs or reported the legacy floating-Effect error. They now use the imported rule, severity and exclusions on both source types; `--fix` preserves a deliberate discard with `void (expression)`.
- A possibly `null` or `undefined` `catch` operand could report a duplicate TypeScript assignment error. It now reports `EK0506` once and keeps independent errors in arguments and handlers.
- Generated error-family matchers could fail through the normal Node or Bun runtime import because matcher registration was missing from the guarded entry. That entry now exports the same registration helper as the runtime ABI, with a build check preventing export drift.
- The migration planner could keep a module in TypeScript after `Bun.build` excluded its package from the bundle. It now follows proven `packages: "external"` boundaries while retaining local source dependencies.
- The runtime interop guide now shows Effect's interruption and yielding values alongside the runtime's masking and finalization helpers.
- The runtime README omitted the `ChildProcess`, `Headers`, `NodeStream` and `Request` companion paths; all four are now listed.
- The pattern-matching guide now explains boxed primitive extraction with `String` and `valueOf()`.
- Diagnostic configuration guidance now explains how supported legacy settings enable compatibility warnings that otherwise default to off.
- The HTTP example now adapts Node's server callback in a TypeScript module, so it compiles with foreign callback checks while opening the server only when its layer is acquired.
- The Effect-parameter inventory check rejected the valid pair of diagnostics for nested Promise-returning root runners. It now requires both rules at the same call while continuing to reject unrelated Promise errors and accidental Effect-as-data warnings.
- Compiler emission checks retained output from before the coverage and native tail-delegation repairs. Their snapshots now match those repairs while retaining exact JavaScript, declarations and runtime results.
- Services with a written whole shape could accept malformed `key` and `defaultValue` headers. They now report `EK0902`, with header repairs available through the editor and `vibelang --fix`.
- Generic foreign calls still required a throw bridge when their thrown type became `never`. They now use the selected type arguments, and throwing-call diagnostics show the substituted type.

- Comparing declaration APIs could falsely report a missing `NodeJS` namespace in packages with configured ambient types. The comparison now keeps the package's `types` and `typeRoots` settings.
- The generator guide could imply that plain generator bodies may throw. It now states their `EK0401` restriction and distinguishes `async` generators from Effect producers.
- Sidecar self-comparison regression fixtures repeatedly loaded unrelated browser declarations. Their entry declarations now select ES5 while retaining actual project discovery, generated nominal and structural shapes, type mutations and missing-library checks.
- The fuzzing research guide incorrectly said an unchanged callable reexport must fail migration verification. It now describes the accepted API identity and the retained type, documentation and missing-dependency controls.
- Contributor helper re-export checks now require a missing `BigInt` library to produce `TS2583` and make comparison unavailable, matching stock TypeScript validation.
- Services with a written whole shape could silently accept index signatures and constructors in their body. They now report `EK0902` and explain where to put the signature or initialization.

- The grammar admission audit could stop on arithmetic after a signed or relational `is` pattern. It now records that known precedence gap while preserving valid pattern prefixes and grouped expressions.

- JSON asset comparison tests repeatedly loaded unrelated browser libraries. Their fixtures now select ES5 while retaining inherited settings, explicit overrides, wildcard exports and invalid-input checks.
- Optional schema fields and tuple elements with an explicit `undefined` union could expose a different codec type from `Schema.optional(S)`. They now retain the underlying codec type while accepting omission and present `undefined`; repairs keep an explicit union codec when rewriting it would change its type.
- The schema guide omitted how ambient error declarations differ from runtime schemas. It now explains `EK1307` and erased native-class contracts.
- The matching guide described cached iterators without showing reuse after a failed arm. It now gives that example and clarifies the cache boundary of each match.
- The platform guide mapped `os.tmpdir` to creating a new directory. Its replacement now reads the system temporary-directory path without creating anything.
- The matching guide left regex capture types under strict indexed-access and optional-property checks implicit. It now explains the native types of global literals, other literals and named expressions.
- Primitive patterns such as `String(let value)` rejected boxed values. They now accept the corresponding native wrapper and bind its primitive value.
- Factory examples could fail with `EK0402` when a TypeScript validation callback was passed through a non-throwing parameter. Their explicit exception bridge now preserves the original defect and cold evaluation without relaxing that callback contract.
- Declaration-order checks could report false differences around adjacent `@throws` comments. They now compare each function with its own comments and return type.
- The grammar admission audit stopped on a bare `import` used as a comparison operand; it now records that native recovery gap while keeping dynamic imports as valid controls.
- The expected-errors guide cited obsolete draft labels for throw-expression restrictions. It now describes the rejected operator position directly.
- Reading a function constructor through a `Function` intersection, inherited interface or generic constraint could miss `EK0107`. Those reads now report the same restriction as a direct `Function` receiver.
- The coverage examples for `and` and `not` could stop at a stale rule reference. They now use the current rule and keep their existing coverage diagnostics.

- A label inside a `for concurrent` body could repeat an enclosing label without an error. It now reports `TS1114`, matching TypeScript.
- Compatibility validation could demand an old implicit-execution error from module-level cold calls. It now checks the current module-call rule and retains the saved legacy inputs and their remaining errors.
- Foreign calls annotated with a type that resolves to `never` incorrectly required a throw bridge. They now call directly in effect and plain code.
- With `allowUnusedLabels: false`, a label used by `continue` in `for concurrent` could report `TS7028`. The compiler now preserves that use while still reporting unused labels.
- Failure-alias examples could still report a resolved declaration-tag assignment gap. They now require the correct `EK0402` rejection and retain the saved examples.
- An `is` binding in a `do…while` condition reported `EK4703`. It now has fresh loop-head cells for each condition: the initial body sees uninitialized cells, closures retain their own iteration, and `continue`, `break` and labels keep their meaning. A skipped `for` condition or update binding now also stays uninitialized instead of inheriting the previous value.
- Checking diagnostic documentation could stop with a TypeScript syntax error in obsolete variant-pattern exemptions. The check now loads correctly and uses the current diagnostics.
- The diagnostic reference still listed `EK4707` for a retired variant-pattern form. It now records that code as retired and points to the current `EK0702` diagnostic.
- The legacy abstract-error migration lacked generated preservation examples. Its error and schema-error forms now exercise field types, optional fields and line-ending trivia through the same API and runtime checks as other repairs.
- The diagnostic reference’s replay link made syntax checks reject the published effect-block jump rule. Those checks now quote the complete rule and keep its existing diagnostic cases.

- The grammar admission audit missed reserved words in identifier module specifiers; it now records those spellings while preserving ordinary missing-name diagnostics.

- The grammar admission audit stopped on nullable schema type suffixes; it now records them under the mapped-type gap and keeps optional tuples as valid controls.

- The grammar admission audit still expected a repaired plain-generator fiber gap; it now retains the original program as a syntax-rejection control.

- The grammar admission inventory omitted match-arm yield and coverage helpers; it now records their existing specification authority.

- The grammar admission audit could miss invalid `async` schema fields when an unresolved type hid their syntax diagnostic; it now records that gap explicitly.
- The producer guide left mixed files unclear; it now explains that nearby Effect code preserves plain generators’ native calls and `yield*` delegation.
- Effect type examples could fail on a missing non-null assertion group or a discarded Effect value. They now use `(value as number!!)!` and retain the asserted value.

- `Experimental` service references called operations on module namespaces or service keys and failed with missing-property errors. They now look up the implementation before calling it.
- `--fix` could rewrite a generator whose bare `return` violated `Effect.fn.Return<A>`, leaving an invalid generated function. It now leaves that generator unchanged and explains why; valid `void` and optional success types still migrate.
- Converting an inline program passed to `Effect.provide` could stop at a construction-order refusal. The repair now captures the program before its provider and preserves the original execution order.
- Pure `HttpClientRequest` setter pipelines could remain unconverted or use the wrong pipe argument order. Supported stable-argument pipelines now convert with the request first.
- Converted generator callbacks in array maps could leave stored programs with an inferred-effect warning. The repair now records their program contract explicitly.
- Converted `Effect.fn` callbacks could read destructured inputs when the program was constructed. Supported bindings now run on each execution; bindings whose scope, public labels or rest semantics cannot be preserved keep their original generator.
- Declaration self-comparison tests repeatedly loaded unrelated browser libraries. Their fixtures now select ES5 while retaining nominal types, unrelated diagnostics and changed-export checks.

- Bare `forkIn` used the old scope-first wrapper, and disabling Effect globals left some functions available. It now exposes the native function, and the option disables all implicit Effect functions.
- Declaration sidecar tests repeatedly loaded unrelated browser libraries. They now select ES5 while retaining project discovery, saved migration examples and changed-export checks.
- A `catch` handler missing `=>` could receive an editor repair that still failed to parse when its body began on a new line. The repair now keeps comments and line breaks after the inserted arrow.

- Declaration checks could report valid relative re-exports as mismatches. They now compare public `.d.ts` output with the TypeScript twin and compatibility sidecars with the source spelling.
- The diagnostic reference defined retained compiler and migration codes without listing them among its numbering exceptions. Those assignments are now explicitly documented.

- Migrating a cached service default delayed and repeated its initializer and changed repeated object reads. The repair now keeps eager initialization, cached identity, the service key and missing-provider behavior.
- JSX examples without a compiler prerequisite could make specification checks crash. They now use ordinary diagnostic checks, while explicit prerequisite markers still reject extra errors and stale markers.
- References and highlighting could disagree when an imported type and a `module` shared a name. The editor now follows the binding through its aliases in either direction.
- The legacy layer migration warning cited the unrelated trailing-block proposal. Its diagnostic reference now points to the accepted layer and migration rules.
- Generated proposal examples could reuse an existing diagnostic code. They now choose an unassigned code while preserving coverage of the published assignment.

- Severity settings could accept a diagnostic code that still reports mandatory errors in some contexts. Codes with both error and warning variants now reject those settings with `EK3006`.

- `Map(let m)` and `Set(let s)` patterns lost the subject's type arguments; their bindings now keep the matched collection's specialized type.

- Plain functions with an inferred return type keep the `EK0107` check for `var` declarations; write `let` or `const`, or keep JavaScript `var` behavior in a `.ts` file.
- An inherited `schema error` could report an extra TypeScript base-type error alongside `EK2117`. It now reports the inheritance diagnostic while preserving independent errors inside the declaration.

- The `data` guide left multiline assertions ambiguous; it now explains how parentheses preserve an assertion whose type continues on another line.

- Migration-only fixes could leave foreign calls unwrapped in effect code or reject a private callback that accepted the original throwing function. They now preserve those exceptions as defects and retain supported private callback contracts through a TypeScript module body.
- Cancelling an inherited child process waited for its exit; `try (try Experimental.ChildProcess.ChildProcess).runInherited(command, args, options)` now sends one signal and returns immediately while the child is still active.
- Copying native `Headers` could normalize duplicate `Set-Cookie` values; `try (try Experimental.Headers.Headers).copy(input)` now uses the native constructor and returns an independent mutable copy.
- Checking a scoped IPv6 address could reject Node-accepted zone names; `Experimental.NetAddress.isIPv6` now preserves the ASCII zone syntax accepted by Node.
- An unread Web response body could stay uncancelled after response close; `try (try Experimental.NodeStream.NodeStream).fromWeb(body, options)` now owns the body eagerly and destroys it when the response closes.
- Replacing a native `Request` URL required TypeScript; `try (try Experimental.Request.Request).atUrl(url, request)` now preserves request options, body, headers and signal.

- The matching guide repeated conflicting rules for `is` binding homes. It now describes the current scopes, temporal dead zone and native redeclaration errors together.
- Converting sequential catch pipelines could leave recovery combinators behind, and a grouped `try` could leave part of its operand outside recovery. The converter now keeps intermediate programs cold and recovers the complete grouped operand.

- The check for `yield` in Effect parameter defaults remained pending after `EK2104` was implemented; it now runs as an active regression for functions and producers.

- Legacy JavaScript checks inside `match` subjects, guards and arms still appeared as pending after the diagnostics were fixed; the existing regression now runs as an active check.

- The legacy JavaScript regression check failed on a call to `Function` after its throwing contract was tracked; it now checks both the legacy-reference error and the plain-call error.

- Optional property access on a nullable function could read its `constructor` without `EK0107`; it now reports the same diagnostic as a direct function-constructor read.
- Migration batches still ran project-wide repairs before restoring unrelated files, making small retries slow in large packages. The flow now passes the selected files through `--only` and skips an empty batch.
- Migration verification could report a missing declaration for a module returned to TypeScript when its package export kept a source `types` condition. Declaration snapshots now preserve that recorded source path and still reject changed types, documentation and missing provenance.

- Re-exporting a documented type or value through a root namespace could report missing prose even when the authored comments remained. Migration verification now reads the target declaration and still rejects changed comments, tags and types.

- Migration could drop refused-site span reports and overlook a changed-site violation beside other diagnostics; it now retains those spans, accepts independent safe fixes, and fails on a preservation violation.

- Declaration module-identity regression tests repeatedly loaded unrelated browser declarations; their fixtures now request ES5 while retaining generated module-resolution, API-mutation and invalid-target checks.

- The grammar admission audit omitted native meta-properties; it now derives valid spellings and records invalid spellings hidden by a platform diagnostic.

- Grammar admission fuzzing now retains invalid native `import()` arities as pending witnesses when their diagnostic does not fail the VibeLang build.

- Grammar admission fuzzing now recognizes native dynamic `import(...)` calls, including options and chained property access.

- Grammar admission fuzzing now retains invalid JSDoc prefixes in schema types as pending witnesses, including optional and readonly fields and schema errors.

- Grammar admission fuzzing now records identifier arguments in import-alias `require` references as a pending gap instead of stopping at an unclassified mismatch.

- Grammar admission checks could overlook undefined field modifiers when a schema type was unsupported; these type errors now leave the syntax check active.

- Migration API verification could stop before comparing apps that import declarations from sibling packages or scripts. Those declarations now resolve inside the isolated comparison layout, while real API changes and paths escaping that layout still fail.
- Migration setup could add a loader helper to a script that launches built JavaScript and break tests evaluating it in a VM. Proven JavaScript paths now preserve the script’s original bytes, and repeated setup removes the unnecessary generated helper.
- Migration could add an inferred `Generator<…>` return type and reject an unchanged `Effect.fn` contract. The rename step now leaves unwritten return types unwritten when functions are plain by syntax.

- Conformance checks could treat supported `async match` expressions returning a `Promise` as an unimplemented feature. They now enforce the required `EK0404` diagnostic as a normal regression.
- The diagnostic reference still listed the retired `EK4503` service error and linked to a removed example; it now records its retirement, and missing-provider examples use the current `EK9211` diagnostic.
- Migration verification could accept a version-only dependency path change while an original declaration error was missing. It now requires the complete original error count before relaxing those paths.

- Migrated packages could leave Node loading a TypeScript source graph when an export array began with `null`, or select a fallback behind an empty array. Runtime routing now follows Node's array fallbacks and condition blockers.

- The diagnostic code map displayed `EK0201` and `EK0202` descriptions as replacement codes. They now appear with their rules in the diagnostic reference.

- The `Option.match` quick fix could refuse a payload whose type was private to another module because its generated annotation used an unresolved name. The repair now expands private interface payloads and preserves the public declaration.

- `vibelang --fix` shortened a written `Experimental.Process.Process` type to `Experimental.Process` and left the `Option<number>`, `Scope` and `FileSystem.of` shorthands as written; every `--fix` scope now writes the export (`Option.Option<number>`, `Scope.Scope`, `FileSystem.FileSystem.of`) and keeps written qualified types.
- Helper re-export declaration tests repeatedly loaded browser libraries in native, stock and API comparison programs. Their fixture now selects the required ES5 declarations while preserving native output and API checks.

- Contributor checks for variance-annotated declarations loaded unrelated browser libraries. They now use ES5 while retaining native validity and changed-field checks.

- Migration verification rejected unchanged callbacks returning void Effects and plain factories returning `effect` blocks. It now checks each callback against its own original and still rejects dropped return values and delayed call-time work.

- `vibelang --fix` could refuse comments on `Schema.TaggedError` fields or getters, or write invalid code for a private class with a codec field. It now preserves those comments and applies the private-class rewrite without overlapping edits; a JSDoc comment that would gain a new member attachment keeps the native class.

- Generated declarations for a `module` body could import a relocated compiler output and make a rebuild fail with `TS5055`. They now retain source-module imports, and returning a migrated source to TypeScript removes the declarations owned by its module bodies.

- Using `continue` in a `const value = do { … }` initializer inside `for concurrent` could be rejected as crossing a function boundary. It now skips the intended item or nested loop iteration.
- A labeled jump from a `for try` loop through a `for concurrent` body could report a native function-boundary error. It now reports `EK2003`, while source-written functions keep their own jump boundaries.
- A labeled `continue` naming its own `for concurrent` loop could produce invalid JavaScript. It now ends that item, including through nested native loops and chained labels.
- A `catch` execution head wrapped in `satisfies` could report a generated TypeScript operand error beside `EK0505`. It now reports the source diagnostic while preserving independent wrapper type errors.

- Moving an exported `unique symbol` into a private module could make an unchanged API fail migration verification. The checker now follows its public export path while still rejecting changed symbol keys, member types and documentation.

- Migrating a factory that returns an Effect function could falsely report that the outer call had changed. Verification now compares each returned function with its own original.

- ESLint and migration verification could reject a file that had only a parser warning. They now receive its syntax tree, while actual syntax errors still report their own locations.
- Declaration checks could select a missing JavaScript output when a conditional export named a TypeScript source file. They now use its existing emitted declaration and retain TypeScript's condition order.

- Declaration verification could reject an unchanged package when its snapshot included both an original declaration and its shipped copy. It now recognizes their recorded common file while retaining conflicts for different declarations.

- Migration verification could let a converted factory delay work inside an `Effect.succeed`, `Effect.fail` or `Effect.die` argument. It now rejects that change while keeping supplied callback bodies deferred.

- A service method written as `effect read(): number!!` could report both `EK0108` and `EK0902`. It now reports `EK0902` once, and the quick fix removes `effect` while keeping the contract.
- Inferred `const` aliases could replace a foreign callable binding's `@throws` annotation with an intrinsic default. Calls now retain the binding contract, and preserving fixes keep the previous error channel.

- Compiler examples that relied on implicit bridges for throwing builtins failed their checks. They now use explicit bridges while retaining their results, declarations and evaluation order.

- Compiler validation no longer fails on a stale pending entry for ordinary generator callback bodies. Their throw-context tests remain enabled.

- Compiler validation no longer fails on a stale pending entry for ordinary async generator callbacks. Their callback tests remain enabled.

- `vibelang lint` reported `EK4806` when an identity-mapped `Effect.try` was piped into `Effect.orDie`; direct and piped defect bridges, including parenthesized forms, now lint alike. An unprotected mapping still warns.

- The exact-optional schema tables hid the explicit-undefined mappings; both settings now display their intended schema mapping.

- Nominal declaration-reference regression tests repeatedly loaded browser libraries and could mask a missing `BigInt` library reference. Their native validation and comparison programs now share the fixture's library baseline and retain explicit reference checks.

- `Effect.gen` migrations stopped at written generator return types; supported annotations now preserve their contextual success type and failure and requirement channels in the converted cold program.

- Private-member declaration API tests still loaded browser libraries during comparison. Their fixed and generated comparisons now use the same ES5 baseline as native validation.

- Companion namespace regression tests loaded browser declarations for every generated project. Stock TypeScript and native checks now load only the required ES5 library while retaining suffix and type-error checks.

- A foreign callable binding could bypass its `@throws` annotation when its function type came from a builtin. Calls now use the binding contract and require an explicit exception bridge when it may throw.

- Stock TypeScript tools rejected the mapper prelude after the old interruption and yield factories were retired. The mapper now imports `interrupt` and `yieldNow` directly from Effect and preserves their native value identities.
- Match-chain migration validation now retains the explicit fallback required for destructuring combinator arms and checks that exhaustive tagged handlers keep their results and public types.

- Migration could accept a source-mode or transform suffix check because an unrelated `".vibe"` string appeared in the same statement. It now requires a native-extension alternative on the same tested path and refuses unsafe conversions.

- Known-throwing builtins such as `JSON.parse` could run without an explicit exception bridge in effect code. They now report `EK0403`; `--fix` preserves their typed failures and unexpected defects.

- Bun treated explicit `.vibex` imports as file assets and missed extensionless imports; the preload now compiles JSX sources and loads their named exports, directory indexes, aliases and native module bodies.

- Migration could omit renamed source modules from published packages whose `files` allowlist selected only `.ts` sources. It now records exact `.vibe` additions in `files` and `publishConfig.files`, preserving exclusions and removing only its own entries on revert.

- One-pass migration repair could repeatedly retain a module whose original declaration baseline was unproven; it now restores that module to TypeScript, keeps its cause for retries and requires fresh verification.

- Migration verification could miss factory snapshots moved from the call to execution. It now rejects deferred property reads, destructuring and spreads, with the moved operation in the report.

- A generated lint bridge could crash on a type-aware rule before checking repository JavaScript plugin rules; type-aware TypeScript rules now stay with the native projection pass.

- Optional extractor bindings were rejected as unsupported; they now initialize only for present values, and missing values retain native lexical binding behavior.

- Contributor tests could pass while invalid build inputs stopped CI from loading its graph; the release tests now load the real build declarations.
- Exhaustive matches with irrefutable `and` captures no longer report missing cases. Captures preserve coverage on either side and when nested; refutable conjuncts still require coverage for the remaining cases.

- `vibelang --fix` left every `EK4402` platform access inside a bare `sync`, `callback` or `tryPromise` wrapper unrepaired and unreported once `sync` and `callback` became Effect globals. It again moves the wrapper into a `.platform.ts` companion, or reports why it refuses.
- A `data` variant field keyed by an enum member whose value is `"_tag"`, `readonly [Key.Tag]: string`, compiled silently, and the variant constructor then overwrote that field with the variant name. The key now reports `EK1601` like a literal `_tag` key.
- `EK4701` printed a unique symbol subject as `unique symbol | unique symbol: unique symbol is left`. The subject and the missing case now print as TypeScript writes them at the match, `typeof A | typeof B: typeof B is left`, namespace-qualified names such as `Option.Option<number>` included.
- A global regular expression extractor, `when /(\\d)/g(let a, let b)`, bound `RegExpMatchArray` elements, so `a.index` was `number | undefined`. The compiler now passes the `g` flag of a literal to the runtime, and the bindings are matchAll's `RegExpExecArray`, as the Typing table says; a non-global literal or a `RegExp` value still binds one `RegExpMatchArray`.

- Stock TypeScript tools could receive an unchanged `.vibe` file for iterable `is` patterns because projection edits overlapped. Function and nested-block projections now preserve the iterator cache and its cleanup without overlapping edits.

- Diagnostic validation now recognizes the specification’s contextual error and warning variants for `EK1010` and `EK4402`, while continuing to reject severity overrides for them.
- Forms validation now recognizes the explicit `effect` arrows in service-lookup examples instead of treating their intended classifications as unapproved changes.
- An unbraced loop body containing an `is` binding could make editor projection fail with overlapping edits. Its recovery block now projects as one unit, preserving the source diagnostic and span map.

- Automatic migration could discard an authored `@throws` or `@rethrows` paragraph. Descriptive and contract-only tags now retain their text with a located refusal, including neighboring tags and exported members.

- The compiler package README omitted its formatter API and ast-grep export and gave no Prettier setup; it now documents `vibelang/prettier`, `vibelang/format` and `vibelang/ast-grep`, with export coverage checked against the package manifest.
- Platform extraction skipped JSX sources or misread their callbacks; it now splits `.tsx` and `.vibex` in JSX mode and preserves native companions and exported signatures.
- Migration API verification reported valid declaration snapshots as unavailable with a relative `TMPDIR`; it now compares them using the resolved temporary directory.
- One-pass migration could reuse an old success or timeout after changing its baseline or compiler; the next step now reopens stale work and keeps historical results separate.
- Migration could convert a module reached by bare Node inside a build shell script; setup now names that runner and retains its source graph until a loader is proven.
- The runtime package README omitted `vibelang-runtime/data-methods` and several experimental subpaths, and said generated code used only the root; it now documents those entry points and checks every exported path against the README.
- Knip could mark native exports as unused when an import resolved to their compiled JavaScript. Migration setup now persists a patch for affected installed Knip releases under pnpm or Bun, so compiled output maps back to configured source extensions such as `.vibe` and `.vibex`.
- Migration verification could reject inherited `TS4023` and `TS4058` declaration errors after a dependency upgrade changed only a resolved package version in their paths. It now accepts proved version-only path changes and records the evidence while preserving other diagnostic and API checks.
- Changing a migration run's toolchain could make older conversions appear freshly produced. The provenance check now uses saved conversion receipts and refuses missing receipts.
- Migration left snippet imports and re-exports such as `"./counter.ts?raw"` pointing at renamed files; it now updates the source path while preserving query strings, fragments and exported names.
- Migration inventories omitted `.vibex` sources and their import and test dependencies; they now include those modules and resolve their source and JavaScript output names.
- Migration could redirect a Bun-only TypeScript source entry to emitted JavaScript because its relative imports needed emission for Node, changing worker-loader behavior. Native runtime roots now follow Node's selected conditions, preserving unrelated Bun and worker source entries.

- Malformed JSX containers in `.vibex` could add the trailing-block migration diagnostic `EK1101` to native syntax errors; they now report the same errors as the `.tsx` twin, and `vibelang --fix` preserves the legacy callback as an explicit argument.
- Calling an implementation method through a service key silently looked up the service and could hide native key properties. Keys now follow TypeScript; use an explicit `try` lookup, and `vibelang --fix` preserves the old direct call's run phase.

- Calls imported from the retired `vibelang-runtime` `yieldNow` and `interrupt` factories stopped at missing-export errors; direct calls through named aliases and namespaces now migrate to cold native Effect values.

- A `match` expression whose arm yields, `const x = match (xs) { when [let a, ...]: (yield a); default: 0; }` in a generator, was compiled inside an arrow function and the module failed to load. The match now runs in the generator, and a yielding match that no statement surrounds reports `EK0204`.
- The shared bundler load hook skipped `.vibex` JSX modules; it now compiles explicit `.vibex` source IDs, including IDs with query strings, alongside `.vibe` modules.

- `--fix` could leave an `Effect.fn` or `Effect.gen` generator unchanged when it constructed DOM `Headers`, reporting that the proposed constructor was not constructable. It now preserves the native constructor binding while retaining `EK4402` for banned host APIs.

- Compiler package tests failed against correct output: they expected sidecars without the generated `@throws {never}` contract, `TS5101` for the retired `declarationImportStyle` setting, mapped sidecars under `src/` with `rootDir: "src"`, an unsharded `compiler-test` target and old specification wording. They now expect `@throws {never}`, `EK3011`, the source-root path, the four `compiler-test-N` shards and the current wording.
- A `yield` or an assignment written as a whole pipe body, such as `x |> y = %` or `x |> yield %`, reported `TS1005`, `TS1109` or `TS1134` at the following tokens. It now reports `EK2301` with the repair, parentheses around the body: `x |> (y = %)`.

- Migration verification could miss a removed doc comment or changed exported type in a shipped deep module of a package without `exports`; it now checks those consumer entrypoints, including bin-only packages and refreshed snapshots.

- A `try` in a computed method or accessor name of a class defined in effect code, such as `class C { [try key()]() {} }`, reported `EK0501` and named the member after the unrun Effect. The name now runs where the class is defined, as `await` does in an `async` function, in order after the `extends` expression. A class with decorators keeps the old error.

- `EK0106` on an `effect` function annotated `any` or `unknown` read "write no return annotation (infer the Effect), or leave the return type out", naming the same repair twice. It now says to leave the return type out, and its quick fix is described as removing the return type.

- Migration setup made Bun build checks with `-p` or `--project` fail with `TS5072`; it now selects the same project using TypeScript build-mode arguments.

- The grammar admission inventory failed after schema header diagnostics were added; the declaration dispatcher and missing-body recovery now name their existing grammar authority.

- A callback interpolation passed to a foreign tag's `@rethrows` parameter incorrectly reported `EK0401` inside the literal, even in an `Effect.try` bridge. Its known throws now belong to the tagged invocation, with `EK0403` at the tag in effect code.
- A function literal passed to a `@rethrows` parameter, as in `invoke(() => parse(s))` or `xs.map((x) => parse(x))`, reported `EK0401` inside the literal. Known throws now belong to the enclosing call or constructor, including when its own contract is `@throws {never}`: effect code reports `EK0403` at the invocation, while native `try/catch` and `Effect.try` handle it.
- Appendix conformance cases retained stale pending markers and older callback, service and inline `module` forms; they now check the accepted rules against TypeScript twins and treat resolved diagnostics as passing tests.

- Runner callback conformance treated an unwrapped Promise call in effect code as valid. It now requires the Promise boundary while continuing to allow root runners inside the plain async callback.

- `vibelang --fix` could ignore a producer return-contract repair reported as `TS2322`; it now applies that specific repair while leaving unrelated assignment errors alone.

- Geolocation, Permissions, UserDirectories and the experimental Process, FileSystem and Locks diagnostics suggested calling members on the module namespace, where they do not exist; their advice now obtains the injected service and runs its member.
- Migrating legacy bare `yieldNow(priority)`, `yieldNow()` and `interrupt()` factory calls stopped at `TS2349` or ran a held Effect; `vibelang --fix` now keeps held and returned programs cold and evaluates optional priorities once.

- Bare `interrupt` and `yieldNow` had legacy function types, so the documented `try interrupt` and `try yieldNow` failed; both now bind to the pinned Effect values. The redundant runtime wrappers are retired (VIP-6/VIP-33).

- A `catch` over `(try x)` could infer the outer program's error type and reject a handler for the Effect it returned. It now catches that returned Effect with its own value and error types; failures while executing `x` escape to the enclosing activation.

- EK2104 now offers an editor quick fix and `vibelang --fix` for Effect delegation in a nonproducer body: `yield* e` becomes `try e`, and `yield* try e` becomes `try e`. Native generators, producers, bare yields and parameter initializers keep their own rules.

- A `catch` could recover a failure while evaluating its head, before that head returned the Effect to protect. Head evaluation now happens first, its failures escape, and only the returned Effect is caught; `--fix` preserves the previous boundary for heads that produce plain values.

- `yield` in a nonproducer Effect activation or an Effect callable's parameter initializer reported native generator errors; it now reports `EK2104`, including inside an outer producer, while retaining independent operand errors.

- A `catch` handler missing `=>` could omit `EK0509`; recovery now reports it while retaining independent TypeScript errors in the parameters and body.
- A `data` variant constructor was accepted as a class pattern, `when Delivery.Sent:`, and `when Delivery.Sent(let t):` gave an obsolete extractor error. Both now report `EK0702`, whose quick fix writes the tag object pattern, and the retired `EK4707` is no longer emitted.
- An optional list element, `[1?]`, required its element to be present under the iterable cache, so an array without it matched nothing. An absent optional element matches again; an elision still requires its element.
- Assigning to a `schema error` field reported `TS2540` without the note that data variant and error fields get; the note now says every schema error field is readonly, as in `Schema.TaggedError`, and to construct a new value.
- A `for` loop whose head bound a name with `is`, `for (const item of (x is let cell) && items())`, threw `ReferenceError` on the first read of that binding in its body: the per-item copy was emitted uninitialized. It now copies the head's cell.

- Migration setup left forced Bun build checks such as `bun check --no-script -b` unable to resolve unchanged tests' imports after conversion; setup now selects VibeLang's build mode with the same projects and emit settings.
- A member pattern on `super`, `when super.inherited:` or `s is super.inherited`, produced JavaScript that passed `super` to a function and failed to load. The member is now read in place with `this` as its receiver.

- Generated synchronous defect bridges now use a nonthrowing inline catch mapper, so `--fix` no longer refuses EK0403, generator conversion or EK0407 retirement because an imported `identity` adds EK0402. Existing imports and the original defect value are preserved.

- EK0403 now offers the synchronous defect bridge first to preserve Effect.gen defects without widening E; its optional @throws {never} declaration fix comes second only when every reachable body, overload and callee is proven non-throwing, with unknown builtins and implicit getter, intercepted object, JSON and iteration throws rejected (intercepted object ruling, 2026-11-04).

- Match migration advice named an unregistered diagnostic for its prerequisite generator rewrite. It now names `vibelang --fix` and preserves the same repair order.

- Migration could stop with an unknown function-model declaration when the compiler emitted `@throws {never}`; it now recognizes that generated contract while still rejecting unknown declaration shapes.

- An Effect expression named `fork` or `join` could report `EK1702` twice. Its parser diagnostic now appears once, with the existing rename fix preserved.

- A computed method or accessor name in an object literal inside an `effect` function could receive `EK0501`, or leave its Effect unrun. It now evaluates in the surrounding activation; method bodies and parameter defaults keep their own contexts.

- A computed object-pattern key such as `{ [keys.name]: let value, ...let rest }` could run its getter repeatedly, convert an object key twice, or read a different property after a custom presence check. Each property clause now saves one converted key for its presence check, value read and rest exclusion.

- In effect code, calling a TypeScript const typed by a function-type alias whose own JSDoc says `@throws` drew no `EK0403`: the alias tag was read as the call's contract. A tag on an alias does not attach, so the call now needs `try Effect.try(() => …)`; put the tag on the call signature, `type Reader = { /** @throws {never} */ (): string }`, or on the const.

- A permitted `globalThis.Function.prototype` access could receive `EK0107` when its literal key used parentheses or an erased assertion. Those keys now keep the prototype exemption; variable keys remain rejected.

- Declaration identity checks could report `TS1262` for a valid export named `await`; keyword export aliases now compare normally, including through namespace re-exports.

- Signature platform errors suggested namespace methods and omitted effectful key conversions; they now show the injected service and how to obtain keys.

- Authenticated-encryption platform errors suggested namespace methods and omitted effectful key conversion; they now show the injected service and how to obtain its key.

- A comma between `schema` declaration fields, between `data` variants or between a variant's fields reported `EK1013`, though the language admits `;`, `,` or a line break there. Commas now separate them, as in a TypeScript type literal; `error` and `schema error` payloads already accepted them.

- Environment-access errors suggested calling a config value as a function; they now show how to run its Effect directly.

- Migration API verification repeatedly walked the same deep type graph for each exported name; it now reuses completed error-free walks while preserving type, documentation and dependency-error checks.

- Ambient `schema` and `data` declarations were accepted or produced native initializer errors; they now report `EK1506` or `EK1607`, including inherited ambient contexts and incomplete bodies.

- Timer-cancellation errors suggested a legacy method without running its Effect; they now show how to run the public `Fiber.interrupt(fiber)` Effect.

- Passing Effect's own callable values or factory results as callbacks, such as `Order.mapInput(Order.Number, f)` or `Schema.String.pipe(Schema.brand("Id"))`, reported `EK0402`. They compile again while the rule for unannotated foreign callable values is decided; written `@throws` contracts are still checked.

- Clipboard errors suggested an unavailable namespace function; they now show how to obtain the injected service and run its `readString` Effect.

- Malformed imports keep their TypeScript syntax errors even when `vibelang-runtime` is absent.

- Diagnostic identities now have matching Appendix rows and distinct native/editor/mapper meanings and severities. Existing editor advice retains EK9100/EK9101; fatal mapper refusals use EK9005/EK9006.

- Filesystem platform errors recommended methods on the `FileSystem` namespace, where they do not exist; their advice now gets `FileSystem.FileSystem` before calling the implementation.
- Migrating imports inside native `module` bodies could replace `./leaf.js` with `./leaf.vibe` and cause `TS5097`. These bodies now keep their original TypeScript import spelling.

- Migration prompts told converters to replace `ensuring` with retired `try`/`finally` in Effect code; they now keep `ensuring` or `onExit` and reserve native `try`/`finally` for plain and `async` functions.

- Parentheses inside schema unions could create extra union codecs; grouping now stays transparent and literal-only unions expose `.literals` in source order. Run `vibelang -p tsconfig.json --fix --fix-migration-only` to retain an older grouped schema codec layout, public declarations and decoding behavior.
- Storing or renaming `sync` and `callback` reported `EK4410`, and their arrows rejected captured locals with `EK4405`. Stored bindings now use the native Effect exports, `never` resolves to `Effect.never`, and wrapper arrows may capture locals. If an older `typeof sync` or `typeof callback` annotation, including a factory return type, needs the compatibility signature, `vibelang --fix` qualifies its runtime import type while preserving the function and its calls.

- Inline TypeScript modules now retain case-sensitive identities, enforce the accepted restricted module profile, and keep identifier imports in module rename, references and highlight results without merging unrelated type imports.

- A list pattern with an elision or an optional element, such as `when [,,3]:` or `when [1?, 2?]:`, was a syntax error; it now matches as chapter 4 says. A binding in an optional element reports `EK4704`.

- Importing the runtime could fail with a duplicate-binding `SyntaxError`; matcher registration is now exported once so the entry module loads normally.

- Empty `data` declarations were rejected; they now produce an empty tagged union, as `Data.TaggedEnum<{}>` does.

- Declaration builds no longer emit or watch obsolete `vibelang.manifest.json` files. Foreign declarations use their written throws contracts; legacy migration still preserves the historical failure and defect split.

- A `match` over an ordinary tagged-error class could appear exhaustive although a structurally compatible instance fell through with `TypeError`. Ordinary constructor patterns now cover no finite case; cover the tag explicitly or add a `default`.

- The call-forms table reported stale plain-function decisions for the parameter-forwarding examples; it now records their explicit `effect` functions.
- Imported lint severity settings could silently stop activating rules before their configuration was migrated; `EK3012` now identifies those projects, and `vibelang --fix` preserves their behavior with an explicit plugin entry.

- The migrate flow left `import.meta.resolve(specifier)` in `.vibe` files and conversion failed with `EK4402`. It now moves the resolver into a fresh sibling `.ts` function and keeps each call, its captured input and its failure handling in place; source wildcard exports explicitly keep the helper private.

- The runtime package failed to build because `$registerErrorMatcher` was exported twice; its entry now exports the helper once.

- ESLint reported `no-unreachable` on reachable completions of `do` expressions containing `match`, including migrated lint rules; its source tree now keeps generated arm exits inside the match, while written unreachable code still reports.

- An `is` binding in an `if` head was scoped to that `if` alone, so `if (!(x is { id: let id })) return; use(id)` reported `EK4703` and `||` or nested conditions could not bind; the bindings now live in the block that holds the `if` (chapter 004, decided detail 245), an unbraced binding body requires braces (`EK0705`), a `for concurrent` limit may bind, and two patterns binding one name in one block report TypeScript's `TS2451`. A binding written `const` keeps const immutability: an assignment to it is TypeScript's `TS2588`.

- An `is` binding in an unbraced statement body silently acquired an implicit block; it now reports `EK0705`, and the quick fix and `vibelang --fix` add the required braces.

- An off-pin Effect dependency now reports one project-level EK3201 on the configuration file (or package manifest), with the resolved and pinned versions. Platform peers each report once; adding source files no longer duplicates the mismatch or attaches it to an Effect use.

- In an `effect` function, a call of an unannotated `.ts` function inside a class field initializer or `static` block reported `EK0403`, as if it ran in effect code, and the same call in a parameter default reported `EK0403` too. A field initializer or `static` block is plain code, so the call is now an ordinary call there; a default in an `effect` function's or producer's parameter list runs before its Effect exists and now reports `EK0401`.

- The starter uses explicit service lookup and catch expressions, wraps test assertions with `Effect.try`, and starts `main` explicitly. Every template is compiled without diagnostics or warnings and run against its expected output in the queue.

- Passing a foreign generic callback directly as `fn<T>` could evade its throw bound; direct instantiation values now receive the same check as retained aliases.

- Callbacks returned by foreign factories could bypass their throw bounds; the compiler now checks the returned callback’s own contract, including through retained aliases.

- Passing an unannotated foreign callable variable to a callback could bypass its throw bound; these values and retained aliases now require a callback that admits their throws.

- Unannotated foreign function declarations could be passed or stored where callbacks must never throw; their default `unknown` contract now requires an admitting callback type, including for retained aliases and class fields.

- Grouped string keys such as `f[("constructor")]` escaped the function-constructor restriction, while `Function[("prototype")]` was incorrectly rejected. Parentheses and erased assertions now preserve the same static member checks as the literal key.

- The agent guide left member readonlyness unclear while the historical decision still described the retired default. It now states that `schema` and `service` fields are writable unless marked `readonly`, and `error` and `data` payload fields are readonly.

- EK4839's direct `Option.match` quick fix now handles callbacks returning Effects, preserving cold construction and an explicit `try` on the selected result, including `try Option.match(…)` as a statement. These choices previously kept a blanket program-result refusal. A call whose handler is an `Effect.fn` generator now waits for `EK1002`'s rewrite instead of refusing first and blocking it.

- A generic `schema error`, such as `schema error Invalid<T> { value: T }`, reported `EK2109` for each field naming a type parameter beside the `EK1303` that rejects the parameters; it now reports `EK1303` only.

- A `schema error` extending another `schema error`, such as `schema error UserNotFound extends NotFound {}`, reported TypeScript's `TS2509` ("Base constructor return type 'never'") beside its `EK2117`; it now reports `EK2117` only, as `error` does.

- The optional-schema compatibility upgrade kept decoded values but changed the published codec to `Schema.optional<Schema.Union<…>>`. It now writes the original `Schema.optional` codec explicitly, preserving declarations, constructors and matchers.

- Combining the chained-assertion and pipe-parser changes stopped compiler builds; the assertion probe now passes the pipe parser's arrow-context argument, with continuation tests covering both assertion operators and conditional tails.
- Getting Started promised that every caller leaving a failure unhandled gets a compile error; it now distinguishes an inferred error channel from a written contract that excludes the failure.
- A TypeScript file importing a migrated VibeLang module could emit a declaration through the package index and pull unrelated types into downstream consumers. Inferred imports now name the declaring module chosen by the TypeScript twin.

- A pipe whose body never used its topic, `1 |> f()`, or a `%` outside every pipe body reported `EK1006` or `EK1007`, codes Appendix B does not assign. Both now report `EK2301`, the code for the pipe proposal's early errors, with the same message.

- Recent fix notes appeared before the release introduction; they now sit under the bug list, and the trailing-block migration remains in the upgrade table.

- Declaration-name checks still required the retired spelling option; they now verify native TypeScript options, separate sidecar identity and real packed-declaration consumers.

- A type-predicate matcher could make an incomplete finite `match` appear exhaustive. User matcher functions now cover no cases for `EK4701`; their arm and `default` reads still narrow normally. Add explicit case patterns or a `default`.
- A call-only extractor could accept a broken `Symbol.iterator` protocol and fail at run time, while rejecting `never` or reporting an internal property error for a matcher returning only `false`. Extractor return types now follow TypeScript assignability to `Iterable<unknown> | false`, reporting `EK0702` for an invalid protocol.
- Migrating legacy service calls with an inferred error slot could freeze that slot as `never` and then refuse to insert `try`. `--fix-vip-only` now migrates the body before writing inferred slot types.

- Effect return annotations accepted a written `infer` slot that TypeScript rejects. They now report `EK4857`; `vibelang --fix` writes the inferred slot types, or removes an all-`infer` return annotation, preserving the declared API.

- ESLint reported extra newline warnings around method calls containing a lifted `do` expression; it now follows the source method and receiver boundaries while retaining warnings for written call or property newlines.

- Migration instructions still said native clock and random calls were forbidden after those calls became legal; the instructions now allow them and explain when to use injected services.

- Some release-note migration instructions rendered as plain rows outside a table; their missing column headers are now restored and a shared checker rejects orphaned rows.

- A release-note claim grouped `react-native` with `.jsx` output. A TypeScript-backed check now rejects that claim and exercises every JSX output mode.

- Layer dependency diagnostics could mention the retired `wire` form. They now explain provider changes using native `Layer` composition.

- Hashing platform errors suggested a namespace method; they now show how to obtain the digest service and run its operation.

- A `catch` handler written as a parameter list followed by a block, `x catch (e) { … }`, was a syntax error (`TS1005`) that hid every other error in the file. It is now `EK0509`, with a quick fix to `x catch effect (e) => { … }` when the block has no `break`, `continue`, `await` or `yield` of its own.

- Migration setup could change entries or plugins on a local `Bun` object; it now changes only Bun's genuine build API and preserves local bindings and explicit API replacements.

- Migration setup stopped when an application already failed to pack before conversion, such as t3code's server with versionless private workspace dependencies. It now records upstream pack exclusions and compares the packages that packed originally; a pack broken by migration still fails verification.

- The migrate flow's platform split read the host global from two of `EK4402`'s three wordings. A module the compiler reported with `AbortSignal.timeout reaches the host and cannot be used in a .vibe file.` (a platform member) went back to TypeScript on every pass, because `platformGlobalsOf` named no global for it. It now names `AbortSignal` (or `URL` for `URL.createObjectURL`), and the next pass moves the declarations that read it into the `.platform.ts` sibling. A test reads the compiler's `EK4402` message table and fails on a wording the flow does not classify.

- The generator migration guide did not name how to run a returned inner Effect; it now shows the separate `try inner` operation.

- The runtime reference omitted `$registerErrorMatcher`; it now documents the exported helper and how it preserves error-family matching.
- Migrated packages could fail to build or load because the migrate flow deleted the JavaScript emitted for inline module declarations. It now keeps those companion files beside their parent and records every generated file without replacing the parent entry.
- Migration setup could enable Vite’s native config loader while a helper still used an extensionless import, causing `ERR_MODULE_NOT_FOUND`. Setup now spells owned relative runtime imports with the source extension TypeScript resolves before enabling native loading, and stops if a required helper edit is unsafe.
- `vibelang --fix` could refuse a named `Effect.fn` returning a literal object with `TS2322`. It now retains the written or contextual return type inside the span.

- After a build wrote declaration sidecars, `vibelang --fix` could refuse an `Effect.fn` migration with `TS5055` because expanding a parameter type imported those outputs. It now retains the checked source annotation, so repeated builds and fixes keep the same type identity; explicitly selected declaration inputs still have overwrite protection.
- `vibelang --fix` left `EK0403` on a plain TypeScript call that reads a guarded property when the call is the whole branch of an `if`, as in `if (field.description) log.info(field.description)`: an unbraced branch got no fix, and `if (o.p) { f(o.p) }` on one line was refused with `TS1005`. The branch now becomes a block that holds the `const` keeping the guard's proof, so the call still runs only when the guard holds. An unbraced branch whose call runs an Effect operand, such as `if (n > 0) return f(try one())`, is now fixed the same way instead of being left alone.

- Fixing a shared module under a server config could shorten `FileSystem.FileSystem` to `FileSystem`, making browser consumers read the DOM type instead. `--fix` now preserves qualified type names and imports that keep bare type references bound to their written module.

- The service conversion examples still left named and primitive shapes as `Context.Service` classes; both now use whole-shape `service` declarations with the same keys.

- Crypto platform errors suggested methods on a module namespace; they now show how to obtain the secure-random service and run its result.

- Standard-I/O platform errors suggested namespace methods and called the arguments property; they now use the injected service and its Effect, stream, or sink members.

- Find References and rename could miss identifiers inside retired `select` arms; the editor now follows their written callees and bindings during recovery.

- Qualified namespace aliases could read host globals without a platform error; they now report `EK4402`, including unused aliases, while local namespaces and type queries keep their ordinary rules. `vibelang --fix` removes unused aliases that TypeScript already erases.

- Grouping or a type assertion around `Function` in an `instanceof` test or a `prototype` access incorrectly reported `EK0107`. These forms now keep the same exemptions as the unwrapped reference.

- Terminal platform errors suggested a namespace function; they now show how to obtain the terminal service and run its line-reading property.

- An object shorthand such as `{ Function }` could copy the global constructor without reporting the legacy JavaScript restriction. It now reports `EK0107`; local bindings and ordinary property names remain allowed.

- Browser audio code needed a TypeScript helper to construct `AudioContext`; `Experimental.AudioContext` now provides scoped `acquire`, and raw construction in a `.vibe` file reports `EK4402`.
- A variable named `module` followed by `as`, `satisfies`, `is` or `of` and an object type, pattern or literal, as in `(module as { model?: unknown }).model`, failed with `EK4003` ("A module expression is not supported"). It now reads as the identifier `module`, as in TypeScript; `module { … }` and `module name { … }` inside an expression still report `EK4003`.
- Native `|>` pipelines could incorrectly report a nested pipe chain. Lint now checks written `.pipe` calls and ignores the calls generated to type native pipeline stages.

- EK4833's quick fix refused every Effect type whose shorthand needs parentheses, such as `Effect.Effect<string | null, E>`, so `--fix` left annotated t3code modules unconverted. It now writes the grouped shorthand, such as `(string | null)!E`, with unchanged declaration output. A full `--fix` run on a legacy `Effect<A | B>` now ends at `(A | B)!!` rather than `Effect.Effect<A | B>`. Refusals now name the source-written parentheses or type-argument comments they would lose.

- Migrating a module reached through an exact `paths` alias could rewrite imports to a name absent from the configuration, such as `models.vibe`. Those imports now name the same migrated source by a relative path, and revert restores the original alias.

- Host writes and deletes in `sync` callbacks with explicit inputs could block migration with `EK4402` and no repair. They now migrate through one fresh `.platform.ts` companion per source, preserving input evaluation, deferred execution and public types; formerly accepted wrapper access reports a migration warning.

- An `is` pattern inside a generic Effect callback could report `EK9206` even though no source function called itself. Pattern predicates now keep their Boolean meaning without inventing a recursive contract requirement.

- `vibelang --fix` delayed construction of an Effect held in a variable and recreated its closure state on every run, moving startup errors to later requests and allowing a transaction-close guard to run twice. It now constructs the program once at its original binding and reuses that value.

- An unrelated Oxlint config could switch `vibelang lint` away from its compiler project, hide TypeScript errors and reject compiler flags. Native lint now keeps the selected project's options and diagnostics regardless of those files.

- Loading `vibelang-runtime` through its guarded entry lacked `$registerErrorMatcher`, which the main entry exports, so the two entries disagreed on the runtime's exports. Both entries now export the same names.
- Classes extending `Context.Service` with a named shape had no automatic migration. `vibelang --fix` now writes a whole-shape service declaration that preserves the shape type, key and public declaration.
- The migrate flow could return healthy importers to TypeScript for a dependency’s error, or blame an innocent dependency for an importer’s own type error. It now returns the files that own the root diagnostics first and checks the whole project again before deciding whether an importer also needs to return.
- A `.vibe` module's declarations could import a type through its package's re-exporting index, such as `import("..").Providers`, where `tsc` names the declaring module (`import("../Providers.ts").Providers`). That pulled the whole package into every consumer's program and could change a downstream package's public declarations. Synthesized specifiers in a `.vibe` file now take the endings of the file's TypeScript twin, so they name the module `tsc` names.
- `vibelang lint` reported each `EK4802` twice when a rule it ports, such as `effecttsgo/effect-in-void-success`, was enabled, because the diagnostic was both a port and a configurable code. Each diagnostic is now reported once, at the rule's severity.
- The acceptance-case harness rejected its documented `--report` option, leaving performance comparisons without fresh timing receipts. It now records case and command durations with tool identities, preserves incomplete runs, and refuses to overwrite an earlier trial.

- Programs using retired `control` and `handle` forms or continuation runtime calls could compile; they now report `EK3501`. Retired `select` blocks report `EK4607`. The errors point to `vibelang --fix`.

- Calling an `effect` function with defaults or destructured parameters could run user-modified array iterator hooks and change its arguments or produce a defect. Argument forwarding now preserves TypeScript's parameter binding without those extra iterator observations.

- Calling a producer with defaulted or destructured parameters could invoke modified array iterator methods before consumption. Producer calls now bind their arguments without those extra iterator steps.

- Native `Schema.TaggedError` classes with spread fields or a written static `_tag` incorrectly drew a declaration advisory, and a stale `Data.TaggedError` diagnostic could offer a rewrite that removed static members. These native classes now keep their spelling without that advisory or repair.

- A `catch` handler missing `=>`, such as `program catch (error) { return 0 }`, reported native `TS1005`. It now reports the catch-handler diagnostic `EK0509`, while independent syntax errors keep their native codes.

- `Option.match` repairs could introduce an argument-count error when `onSome` ignored its payload; the repair now preserves the callback type and passes the original payload safely.

- Creating a producer that uses `this` could invoke a modified `Function.prototype.bind` or throw before returning its stream. Receiver capture now preserves the native counterpart without that extra property read.

- Child-process platform errors suggested methods on a module namespace; they now show how to obtain the spawner service and run its result.

- `return try value` could replace a noniterable operand's native `TypeError` message, including through typed and generic parameters. Tail returns now preserve the message and the source function's name, arity and callable kind.

- Capturing `this` could erase an Effect arrow's field or default-parameter function name. These callables now keep TypeScript's inferred names, including private and computed fields, while receiver reads remain lazy.

- Building an `effect` block or Effect arrow before a derived constructor calls `super()` no longer reads `this` early; each run checks the receiver only when it reaches the read, and a computed `super` key runs after that check.

- A `static` constructor in an error declaration could report two member errors; it now reports the constructor error once, while computed static methods keep the static-member error.

- An unchecked nullish `for concurrent(limit)` limit ran all items at once. Written limits now reach Effect unchanged, while omitting the limit still runs unbounded.

- `EK4802` warned on `try x.pipe(Stream.runCollect)` and `try take(job)`, though `try` runs the inferred Effect at once. A call that is the direct operand of `try`, parenthesized or not, no longer warns; the same call assigned, passed, returned or pushed without `try`, such as `const value = take(job)`, still does.
- Browser-storage platform errors suggested a method on a module namespace; they now show how to obtain the key-value store and run its lookup.

- `--fix --fix-migration-only` now follows the member readonly rule: existing unmarked schema fields, including nested `schema error` structs, and service shape properties gain `readonly`. Legacy nested service and error/data payload members also gain explicit modifiers to preserve their pre-pin declarations. Ordinary native members and the already readonly error/data fields stay unchanged. A pre-existing `EK2109` on a schema no longer blocks the upgrade (foldkit-174).

- `vibelang lint` could turn inferred Effect argument warnings into `effect-in-void-success` errors, including a stream collected with `try`. The imported rule now matches the TypeScript twin and reports `EK3830` independently of `EK4802`.

- The function-controls example read the callable `Function` constructor and reported `EK0107`. Its erased constructor comparison now uses the explicit `any` boundary allowed by VIP-1, while the `instanceof` and prototype controls remain checked.

- A `do` expression after an unreachable outer statement lost its normal-completion type and reported property errors on `never`. It now retains the type of its local normal completions, while a `do` with no normal completion still has type `never`.

- The lower and inference examples’ emitted JavaScript snapshots expected older arrow wrappers and anonymous generators. They now record the compiler’s equivalent explicit-return wrappers and preserved `greet` and `lookup` frames; their runtime checks remain in place.

- Publication helper properties now quote the current native JavaScript and declaration output names. Both 100-case properties retain their distribution-path, shadowing and unsupported-expression controls.

- Lint output-preservation and public Effect-version citation checks now follow the current tooling text, retaining all refusal, output and public-authority assertions.

- After migration, bare `node` entries and test-local esbuild bundles could fail when a TypeScript importer reached a converted module. The flow now emits private packages and routes those product imports to committed JavaScript without changing the command or test.

- `vibelang --fix` added an unused catch function to every generated defect bridge, lowering function coverage in migrated modules that never threw. It now reuses Effect's `identity` mapper while preserving the original thrown value and defect channel.
- `vibelang --fix --only` stopped with exit 3, "a fix reached a file --only does not list; wrote nothing", and kept no fix when a listed module held a platform wrapper, because moving the wrapper creates a new `.platform-N.ts` file; it also moved wrappers in unlisted modules. Under `--only` that move is now refused at its site, unlisted modules are left alone, and the run keeps its other fixes.

- A binding inside an `or` or a `not` pattern, such as `when { a: let v } or { b: let v }:`, reported `EK4702`; alternatives now share one cell, a later alternative replaces what a failed earlier one wrote, and the name has the union of its types. Written names retain their identity alongside generated temporaries, while invalid `var` bindings retain `EK0107`.
- Running the migrate flow's setup on a tree an older staged toolchain set up deleted `.vibelang-toolchain/` and copied the new tarballs, but a `vibelang` whose scripts already ran `vibelang` and a `vibelang-unplugin` whose `Bun.build` was already wired kept the old tarball's `file:` specifier, so the install failed with `ENOENT` (opencode, toolchain m26); setup now moves every specifier into `.vibelang-toolchain/`, in every package's dependencies, overrides, resolutions and catalogs, to this toolchain's tarball of the same package, and a second setup writes what a fresh one does.
- Large `vibelang --fix` migrations kept earlier rounds' checker caches alive while checking new fixes, increasing peak memory. Earlier programs are now released before the next round's check, and the progress log identifies the current stage and reports heap usage, the garbage collector's target and collection count.
- `vibelang --fix` could refuse an `Effect.gen` whose typed `Effect.fail<E>` or `Effect.succeed<A>` supplied an object literal, tuple or callback. Generator conversion now keeps those type arguments on the call under `try`, preserving its contextual types.

- Running a comma expression with `try` could be rejected as an old hatch; it now evaluates the operands in order and runs their final Effect value.

- Sharded Go checks left a temporary directory after running a package with no selectable tests, including benchmark-only packages. The launcher now removes its discovery files before running the native test binary.
- On a host without `Symbol.customMatcher`, `vibelang-runtime` defined it as a configurable property, so any module could delete or replace the key that every matcher uses. It is now non-writable, non-enumerable and non-configurable, like a well-known symbol, and a symbol the host already defines is kept.

- `try.allSettled [a, b]` added a call to `Array.prototype.map` that its native counterpart omits; literals without spreads now wrap each element directly with `Effect.exit`.

- Installing the documentation tools printed a duplicate-dependency warning for `fast-check`. The tools now declare its existing version once, and a repository check catches competing production and development declarations.

- A throwing tagged-template call could escape the synchronous no-throw check; known tag contracts now report `EK0401`, while native `try/catch` and admitting wrapper thunks remain allowed.
- A package that re-exported or referenced a `.vibex` module shipped declarations that named `./App.vibex`, which a consumer of the build output could not resolve (`TS2307`). Ordinary declarations now name the module's `.tsx` twin, `./App.tsx`, in written specifiers, `import()` types and inferred import types, as `tsc` does; compatibility sidecars keep `./App.vibex`.

- Applying `vibelang --fix` to a `Match` chain could skip getter reads or delay captured operands until a later call. Observable operands now keep their eager reads and an explanation that the conversion has no automatic fix.

- A schema-alias quick fix could join its initializer to the statement after the removed type alias, silently changing `Base; …; value;` into `Basevalue`. The editor and `vibelang --fix` now keep the original statement terminator.

- Path platform errors recommended namespace calls, a callable `Path()`, and unrun URL conversions; their examples now get `Path.Path` and run conversions before using the path.
- Applying `vibelang --fix` to a `Match` handler with an object parameter could send a matching value with a missing optional field to the fallback. Handler fields are now destructured after arm selection, preserving missing fields, defaults, rest bindings and getter reads.

- Passing a throwing foreign callback to a `@rethrows` parameter could escape the synchronous no-throw check; calls, constructors and tagged templates now retain that callback’s known thrown contract.

- A foreign function that throws before returning a `Promise` could bypass the synchronous no-throw check; its written `@throws` contract now requires handling at the call.

- The ESLint corpus check rejected deliberately constant source literal conditions as generated code; it now checks each reported literal against its source while continuing to detect unwritten constants.

- The optional-schema runtime witness still quoted the old unconditional mapping rule. It now cites the current optional-property table while keeping its source, TypeScript twin and probes unchanged.

- Service declaration checks still expected an implicit namespace for a written shape and omitted the legacy `Effect` migration warnings; they now enforce the direct written type and the current migration output.

- Converting an ambient `schema error` to a native class inserted static initialization that TypeScript rejects. The editor repair now keeps the ambient class erased and valid while runtime class repairs retain their matchers.

- An `EK4833` warning on an Effect type with a union slot lost its concrete shorthand suggestion when the automatic fix was unsafe; it now shows the required parentheses while retaining the refusal to change grouping or declarations. Legacy `Effect<…>` annotations in callback and service cases also retain their required `EK4856` warning coverage.
- Assigning to a field of a `data` variant or an `error` reported `TS2540` with a note to write `{ mutable name: T }`, a retired marker that a variant rejects with `EK2125`. The note now says every such field is readonly, as in Effect's `Data.TaggedEnum` and `Data.TaggedError`, and to construct a new value instead.

- Contract diagnostic checks omitted the `EK4856` warnings on transitional `Effect<…>` aliases; their snapshots now retain those warnings alongside the exact missing-error and missing-service diagnostics.

- The migrate flow's `module throwing { }` and `module platform { }` bodies exported every private declaration they took, so a module failed `TS2883` when one had a type its package does not export, as t3code web `themePalette.ts` did with `const convertToOklch = converter("oklch")`. A body now exports a private declaration only when the rest of the module reads it or a kept declaration's type may name it, and the module's declarations are the original's.

- `vibelang --fix` and `--fix-vip-only` refused (`no fix applies`) an `EK4402` inside an `Effect.try`, `tryPromise`, `sync` or `callback` callback that reads a binding of its file, such as `Effect.try({ try: () => decrypt(Buffer.from(value)), catch: (cause) => new DecryptError({ cause }) })`. Code like this compiled before host access was checked inside these callbacks. Both now move only the platform code into a new sibling `.ts` function and pass its arguments as parameters: `$platform(value)` in the `.vibe` file and `export function $platform(arg0: Uint8Array) { return Buffer.from(arg0); }` beside it. The wrapper and its `catch` stay where they were, so a throw still becomes the same failure, the call still runs only when the Effect runs, and the public declarations stay the same. In a composite project, such as t3code Desktop with `"include": ["src"]`, the check now lists the new file as `tsc` does once it is written, instead of refusing with `TS6307`. Under `--only`, which writes no unlisted file, the split is refused for that site with the reason; it used to stop the whole run with `wrote nothing`.

- Setup left literal `Bun.build` entrypoints such as `src/index.ts` pointing at files it had migrated, so the build stopped with `ModuleNotFound`. It now follows the existing converted source and keeps native entries as written.

- Migration returned error-free modules to TypeScript for warning diagnostics whose safe fix refused, including `EK4833`, `EK4839` and `EK4802`. Every warning category now keeps the module as `.vibe`, including imported Effect and future codes, with located, named exceptions and refusal reasons in module provenance and the migration report. Errors still return modules. This extends the earlier `EK4833` grouping exception.
- Upgrading an older `service` body could turn its readonly API fields writable. `vibelang --fix --fix-migration-only` now spells the old `readonly` fields and nested type members explicitly, preserving their declarations across the compiler upgrade.

- Large compiler messages containing Unicode could display replacement characters in bundlers or misidentify source files; their text and paths now stay intact, and old cached warnings are refreshed.
- Imported `EK38xx` severity entries activated Effect lint without its plugin and reactivated `diagnosticSeverity: null`; they now only configure an enabled plugin.

- Native `Context.Service` classes accepted an undeclared `Key.Shape` namespace that TypeScript rejects. They now report the native TypeScript diagnostic; use `Context.Service.Shape<typeof Key>` or an explicitly declared namespace. Member-body `service` aliases keep working.

- Foreign calls with a written throwing annotation could bypass the required bridge in effect code. They now report `EK0403`, and `--fix` preserves their former failures and defects.

- `vibelang --fix` migrated legacy severity maps in external and dependency configs; it now reports those configs without editing them, including through symlinks.

- A synchronous call to the ES2026 `JSON.parse` overload could escape its `SyntaxError` check; all overloads now retain the shipped contract and report `EK0401` outside an admitting boundary.

- EK4802 could follow inferred payloads inside declared Effect data parameters and warn on intentional composition. It now checks the parameter before inference and exempts declared Effect, Stream and other Effect data types, including aliases, unions, intersections and constraints.

- Producers with compatible written return annotations such as `any`, `unknown` or an optional `Stream` were rejected with `EK2102`; they now follow TypeScript's return checking, while explicit `Stream` channels still check yielded values, errors and requirements. Marked generator methods receive the same checks, including without an explicit `Stream` import; `--fix` can write their inferred `Stream` contract without changing the body.

- A chained `as` or `satisfies` after `!!` could be consumed as a requirement type and leave the following type stranded. The parser now keeps a complete chained expression while preserving valid contextual type names and automatic semicolon insertion.

- Generated spec pages and compiler diagnostic defaults could lag accepted rules. They now match the published chapters, including the warning default for `EK3012`.

- Bare `interruptible` and `uninterruptible` could be stored as global functions. These keyword names now report missing bindings; use `Effect.interruptible` or `Effect.uninterruptible` for function values.

- A class could `implement` a pure callback member while storing or inheriting a throwing function; incompatible member contracts now report `EK0402`, including getters and generic interface bindings.

- A `do` expression with no normal result suppressed native iterator errors in loops, destructuring, delegated yields and call spreads, so migration missed a required cast. These uses now retain TypeScript's `never` protocol checks; array literal spreads keep their native behavior.

- The migrate flow rejected a valid Knip configuration that registered both `.vibe` and `.vibex`; it now accepts both compiler bindings and the generated sidecar excludes.

- Computed assignment keys around `do` now have native-JavaScript differential coverage, including compound and logical assignments, coercion side effects and abrupt completion.
- A computed `schema error` field such as `{ [key]: number }` with `key: string` compiled, although the key could be `"_tag"` and replace the generated tag, and a singleton `"_tag"` key reported only a mismatched tag type on the class name. Such keys now report `EK2117` at the key unless their type excludes `"_tag"`.

- Migrating an SSR entry left Vite's `/src/…` `serverEntry` or `clientEntry` URL pointing at the renamed TypeScript file. The codemod now follows those URLs in owned Vite configuration variants and records exact reversible edits.

- Upgrading a `schema error` to a class could refuse the migration with `EK0704` at its extractor patterns. The checker now recognizes the own matcher that the migration installs, while inherited matchers remain excluded.

- Nested Effect types keep their qualified spelling when shorthand would need new grouping, including direct nesting and array boundaries.

- `--fix` could change an inferred return type on a call through a generic receiver. Calls with deferred or combined target types now keep their original source and report a refusal.

- `--fix` refused native throws caught inside an Effect-returning factory. It now preserves the existing catch result and cleanup through a TypeScript instruction helper, including in exported factories.

- `--fix` refused native throws inside inline `Effect.suspend` factories. It now preserves them as defects at the same run phase, including tail throw expressions, and refuses cleanup-sensitive or non-tail cases.

- `vibelang --fix` left tracked throwing calls unrepaired; supported synchronous calls now retain their receiver, evaluation order, and return type through a TypeScript module helper, and immediately run internal Effect factories retain native exceptions as defects.
- `--fix` left synchronous `EK0401` throws unchanged in functions, callbacks and parameter defaults. It now moves the throwing instruction into a TypeScript `module` while preserving the operand's scope, evaluation order and synchronous exception behavior; sites that cannot preserve their contract are reported individually.

- Malformed `data` variants reported unrelated TypeScript errors or the old `EK2125`; parenthesized payloads and payload members that are not fields now report `EK1606`, with guidance to use fields in braces.

- Bare `pipe` could fail to resolve when only `effect` was installed, or add a runtime import when the runtime was present. It now resolves and imports directly from `effect/Function`, like the other root functions; local bindings keep their meaning.

- Computed presence keys such as `{ ["field"] }` incorrectly required a colon; they now test property presence without reading its value or creating a binding.

- Host `performance` and `crypto` reads used an obsolete diagnostic that legacy settings could weaken, while ECMAScript `Temporal.Now` reads were rejected. Host reads now report `EK4402` with native Effect replacements; ECMAScript reads stay allowed, and obsolete `EK4403` settings are rejected.

- Vite coverage counted private tail-delegation wrappers as extra functions or uncovered statements, especially in callbacks and throwing catch handlers. It now counts the authored functions and statements through the composed source map.

- A native checker reported `TS2307` when it reached a package whose VibeLang declarations were hidden under `vibe.sidecarDir` through another package’s TypeScript sources. Setup now supplies private type routes to the physical declarations, preserving loader identity and the normal built JavaScript and declaration paths. Bun’s native `bun check --no-script` keeps its existing command.
- The service-read migration check rejected the simplified tooling specification because it quoted retired wording. It now checks the current requirement to preserve types, behavior and declaration output.

- Migration verification could crash or record hashes from stale JavaScript when a package emitted into batch scratch. Content receipts now name and hash the files actually written.

- A `do` expression ending in `for concurrent` compiled even though a final loop is forbidden. It now reports `EK0201`, including through labels and empty suffixes; `vibelang --fix` preserves its discarded result and `void` type with an explicit `void 0 as void` value.

- A throw expression followed by a comma (including an object property, array element or call argument) now warns with EK1010 until its parenthesizing `vibelang --fix` ships. Existing operator-left EK1010 errors stay errors.

- A closure created in a `for try` `Stream` expression could read an outer variable or fail to resolve the loop head. Reading its captured head binding now throws `ReferenceError`, including when the `Stream` is empty or emits several items.

- `await` in Effect callable parameter defaults reported retired `EK4602`. It now reports `EK0102` for functions, arrows, methods and producers, while nested native callables keep their own rules.
- A `throw` with no operand before a comma or binary operator, such as `const x = throw , b` while typing, crashed the compiler and the language server with `slice bounds out of range`. It now reports TypeScript's `TS1109` Expression expected.

- Declaration sidecars with disabled prelude imports now have active checks for their stock TypeScript types, runtime results and all prelude option combinations.

- Wildcard project inputs could hide `.vibe` and `.vibex` source files behind existing declarations or JavaScript. Sources now take priority over those files, as their TypeScript twins do; explicitly listed `files` inputs remain unchanged.

- The editor stopped offering "Run it with try" on a direct Effect argument that `EK4802` reports at a plain generic call. It offers it again when the enclosing contract accepts the Effect; a returned program stays data and gets no action.
- The TS7 mapper stopped parsing every `for try` loop after its head began lifting the Stream into a separate scope. The mapper now keeps the loop as written.
- The TS7 mapper crashed on `x catch function (e) { ... }`, because it read every handler as an arrow function. It now projects a function expression handler.

- Release checks used the old API comparison helper set and Go package census. They now include the split ambient helper and language-service package.

- The ESLint tree check missed source functions inside an effect block. It now visits the generated builder call and checks those functions.

- Specification validation rejected accepted matching, catch and declaration rules because their diagnostic authorities were missing or a retired code looked current. The registry now names the accepted VIPs and marks `EK0511` as historical.

- An error accessor with a forbidden `effect` modifier and a reserved `_tag` name reported an extra tag error; it now reports the modifier error without the extra reserved-tag error, preserving independent TypeScript errors.

- `vibelang --fix` resolved every import of a large project again for each checking program. It now reuses module resolutions while the set of created files stays the same, reducing the time spent finding unchanged modules.

- Vite, Vitest, source loaders and typed ESLint rejected `.vibe` modules included only by a sibling `tsconfig.json`, sometimes preventing tests from starting. They now find a containing project within the package and use its compiler options. Overlapping projects follow nearest-config and project-reference selection; modules no project contains still fail clearly.

- A build that the migrate flow's setup moved from plain `tsc` to `vibelang` failed when its only diagnostics were Effect warnings, though `tsc` ignores the tsconfig's `@effect/language-service` entry and passed: opencode's `@opencode/http-recorder` build exited 2 on `unstableApiUsage` warnings, so its `script/pack.ts` published nothing. In a repository whose package scripts never run `effect-tsgo` or `effect-language-service`, setup now adds `"ignoreEffectWarningsInTscExitCode": true` and `"ignoreEffectErrorsInTscExitCode": true` to each `@effect/language-service` entry in its tsconfigs, keeping any value the entry already sets. `vibelang` honors them, so those diagnostics still print and no longer fail the build. A repository that patches its compiler keeps the Effect exit policy.

- A plain generic call such as `expect(awaited())` could report `EK4802` without its direct-argument repair. The editor and `--fix` now offer `try` when the written contract accepts it; returned Effects retain their existing repair policy.

- The VIP migration could refuse a generic call with an Effect supplied by another argument, reporting `EK0502` after running a program the old call held. It now preserves that sibling-established program context.

- Grammar admission checks still expected the old interruption-placement bug after the compiler fixed it. Their saved witnesses now verify rejection and no longer report an obsolete pending gap.

- The grammar admission audit could mistake TypeScript’s `for await…of` loops for undefined VibeLang syntax; its grammar now derives those loops and checks malformed heads separately.

- `fork` and `join` in plain functions, nested callbacks, initializers and parameter defaults could compile or report an operand error. They now report `EK1701`; `vibelang --fix` preserves the old cold program construction with an explicit API call.

- `vibelang --fix` refused to remove two adjacent prelude bindings of one import, such as the last two of `import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"`: its edit dropped the closing brace and added `TS1005`. It now writes the import with the bindings it keeps.
- Nested `effect` activations inside concurrent items could report a missing interruption mask even with an outer mask; they now report `EK2202` for crossing that activation boundary.

- Passing a foreign function returning `Effect`, `Stream` or `Layer` as a callback could report `EK0402` from its written `@throws`; these effectful signatures now keep their intrinsic synchronous thrown type `never`, including constrained generics.
- A shorthand object member could hide a TypeScript callback's written throws contract. It now follows the same callback checks as an explicit property value, while destructuring targets and native type errors keep their usual behavior.
- Saving a union of TypeScript callbacks could lose the alternatives' written throws contracts. Assignments and arguments now check each alternative against a compatible destination signature, including optional callbacks.
- Passing, assigning or returning a foreign constructor could lose its written `@throws` contract; incompatible construct signatures now report `EK0402`, while native argument and abstract-constructor errors keep their TypeScript diagnostics.
- `Effect.forkChild(e)`, `Effect.forkDetach(e)` and other calls whose type parameter is constrained to an `Effect`, such as `<Arg extends Effect<any, any, any> | Options>`, warned `EK4802` that the call receives the unrun program. Such a parameter declares that it takes a program, so it no longer warns.
- A function whose only statement is `return try value` showed V8 coverage, and tools that read it, a second function for the generator the compiler makes. That generator now maps to no source position, so coverage counts one function, as before tail `try` kept native delegation.

- Migration setup added star imports to source-child launchers and triggered their existing lint rules. Helpers now reuse runtime imports or add unaliased named imports, including inside private TypeScript modules, while retaining authored bindings and comments.

- A one-pass migration stopped when a selected module's import closure exceeded `240` modules, such as t3code Mobile's `369`-module closure. The fix pass now uses the original whole project and its compiler safety gate, keeps only selected rewrites, and records why it fell back.
- Migration verification rejected package scripts that the codemod had repointed to migrated entrypoints. It now accepts exactly the recorded replacements, while extra flags, changed test scripts and unrelated manifest edits still fail.

- Migration verification lost valid `./x.ts` to `./x.js` spelling receipts when another declaration target was absent. It now records each proven pair independently and still refuses unresolved or changed APIs.
- Migration verification marked every opted-in private module unproven because setup skipped its stock declarations. Setup now captures and checks their API identity, while changed or unavailable APIs still fail.

- Imports written as `./App.js` or `./App.jsx` could miss `App.vibex`, and generated `.d.vibex.ts` files could enter the project's source list. JSX VibeLang modules now follow the configured extension priorities, explicit `.vibe` and `.vibex` names substitute for each other, and wildcard discovery leaves out sidecars that have a source.
- `EK4834`, `EK4835` and `EK4836` warned on `try Effect.succeed(1)` and the other form spellings in plain functions, where `try` is already `EK0501` and runs nothing. These warnings now appear only in effect code, as the specification requires.
- `--fix` left `try (x |> Effect.catch(%, h))` as written after a pipeline migration. It writes `x catch h` again; the `EK4835` warning still reports only a direct `try` operand.

- Type-checking the build graph reported a duplicate Go formatter target, while loading it could silently replace its description. The formatter and dprint packaging target is now declared once.

- An object requirement in `A!E!{ ... }` failed to parse in aliases and signatures; these positions now accept it, while implementation return annotations keep their body-brace boundary.

- Editor projection could treat a callback marked `effect` as plain or ask the user to choose its form; it now preserves the keyword's Effect function kind, including through callback annotations and imported calls.

- A namespace type ending in `Shape`, or a missing `Name.Shape` qualifier, could overflow the compiler stack. Namespaces now resolve normally and missing qualifiers report TypeScript diagnostics.
- Repeated test-harness runs reported `declaration API comparison unavailable` ("Ambient declaration load order differs") for Chapter 4 and VIP-7 match cases: a case's runner left `typescript/node_modules/effect` linked to its pinned reference Effect, and the next run compiled the TypeScript twin against it. The harness now removes that link, so the twin compiles against the case's Effect on every run.
- `vibelang --fix` rewrote every qualified call such as `Effect.succeed(1)` to the bare global `succeed(1)` once VIP-6 made every Effect export a global, so the fixed forms of the TypeScript-form and migration examples changed again on a second run and `--fix` built more checking programs than its bound allows. `--fix` again leaves qualified `Effect` calls as written.

- Fixing several modules could stop with `fatal error: concurrent map writes` while checking declaration imports, leaving a partial result. Parallel declaration collection now synchronizes its writes.

- The grammar inventory could fail after the escaped `effect` keyword repair because its helper lacked an authority entry; the inventory now records the existing lexical rule.

- `var` declarations silently compiled despite the language restriction; every source `var` now reports `EK0107`, while ordinary property names and strings remain valid. Rewrite the declaration with its scope in mind; there is no blanket `var` to `let` quick fix.

- Nested object properties and method types inside an `error` or `schema error` were implicitly readonly, so ordinary TypeScript writes failed. Nested types now keep their written mutability; payload keys remain readonly.

- A literal `__proto__` key in a `match` or `is` pattern could report `EK0707` twice; it now reports one error per invalid key.

- A `match` could miss cases after a guard narrowed a broad subject to a finite type. `EK4701` now checks the type at the match expression, including narrowed properties and assigned values.

- Regular-expression and relational patterns, such as `when /^a/:` and `when >= 10 and < 20:`, reported `EK4704` or a syntax error; they now run as the pinned proposal says, including stored `RegExp` values, and a regular expression with an argument list extracts its match.

- Private service-shaped `control` handlers previously required manual migration. `vibelang --fix` now rewrites a provably safe tail-`resume` subset to ordinary services, preserves its existing key in scopes without a derived key, and reports unsupported continuations without changing them.
- Error recovery could leave an assigned value possibly `undefined` and lose an unhandled error type. Running calls now keep omitted generic branches at their defaults while still inferring supplied arguments.

- Binding a computed property from an `unknown` match subject could report `TS7053`; the binding now has type `unknown`, while typed records and source-written accesses keep their checks.

- An invalid Effect type operand such as `number!!(string?)` also offered an unrelated parenthesis repair; it now reports the ordinary syntax error.
- ESLint suggested changing compiler-generated `do` temporaries to `const`; it now omits those temporaries from declaration queries while keeping genuine source warnings.
- A `return` inside a `do` in a `for concurrent` limit or operand was rejected with `EK0204`. It now leaves the enclosing function, and the limit still runs before the operand.
- Reading `globalThis.eval` and `globalThis.Function` bypassed the legacy JavaScript restriction; these reads now report `EK0107`, with the permitted `Function` uses preserved.
- ESLint could miss written methods and getters beside a plain `error` payload field named `constructor`. They now remain in the source tree alongside the fields, with their original names, scopes and locations.

- A service with a whole-shape annotation could capture an enclosing generic type under one shared key. It now reports `EK3005`, as the equivalent member declaration does.
- A service with a written shape annotation gained an extra public `Shape` namespace in its declarations. It now keeps the written shape directly and exposes no implicit namespace outside its own body.
- Formatting a generated subprocess helper could make migration setup treat it as hand-edited and retain unused loader imports. Setup now recognizes formatting changes while preserving edited code, types, comments and documentation for review.
- Migration setup could add source-loader helpers to JavaScript CLI launches merely because later arguments were dynamic, introducing unnecessary install-time dependencies. Proven JavaScript entrypoints now keep their native launch; unknown and typed source entrypoints retain loader handling.
- Reverting converted Mobile dependencies keeps the original import spellings in converted consumers; a named T3code corpus now protects this across both migration record formats.
- Rerunning migration setup could leave obsolete subprocess loader helpers in shell launchers. Setup now writes the validated cleanup even when no source child remains, preserving the native launch without adding loader dependencies.

- Bundler sidecar checks failed on an obsolete specification quote; they now read the current declaration-output contract.

- Packed packages could leave private emitted imports pointing at compatibility declarations that were absent from the archive. Publication now maps each exact source to the package’s regular built declarations while preserving its runtime targets.

- The `effect` quick fix was missing for arrows with one bare parameter; it now adds the required parentheses and preserves comments.

- Compiler checks for `unknown`-operand repairs could fail on an invalid `@throws` annotation in their input. They now use a valid declaration while preserving the diagnostic and error/service-channel checks.

- `do` blocks could report implicit `any` errors on generated names, widen literal alternatives to `number` or erase `never`; `match` on `[]` could report implicit `any[]`. Generated bindings now keep the source expression's checked type, including in unreachable code.

- `--fix` and the editor could make `Match.instanceOf` accept primitive values it previously rejected; unproven constructors now retain the `EK4839` warning without a repair, while proven ordinary classes still convert to `match`.
- Retired `declarationImportStyle` and `trustedPackages` settings could still change compilation or reject malformed values. They now warn, ignore every value and omit the keys from `--showConfig`; foreign-call advice recommends an explicit boundary instead of retired package trust.

- Exported plain functions, methods, constructors and callable constants could lose their nonthrowing contract in declarations, making downstream VibeLang callers treat calls as potentially throwing. Their emitted signatures now carry `@throws {never}`, including interface and object-type signatures, while preserving documentation.

- An explicit `try` of an unchecked call could warn that its returned Effect would not run. That false `EK4409` warning is no longer shown; the Effect still runs normally.

- Passing a local alias such as `const saved = parse` could hide a TypeScript function's written `@throws` contract. The `EK0402` callback check now follows the retained foreign call signature through bindings and destructuring.

- An unchecked optional call could succeed when its factory was absent. `try` now delegates the actual optional result, so absence produces a native `TypeError` defect. Use an explicit Effect fallback when absence should succeed.

- Migration setup could leave a nested workspace consumer on `tsc` when a semver peer or npm alias resolved to migrated workspace sources. Setup now follows installed workspace links for compiler, test-runner and worker wiring while respecting nearer registry packages.
- Automatic repairs dropped service declaration imports when ordinary declaration output was disabled. They now apply the same import checks with sidecars and keep source unused-import checks effective.

- ESLint treated a multiline `for concurrent` head as a function call; it now follows the loop's source children while preserving item scopes and real call warnings.

- Passing a throwing TypeScript method through indexed access, such as `handlers["parse"]` or `handlers[key]`, could bypass callback checks. Its written `@throws` contract now receives the same `EK0402` check as dotted access, including numeric and symbol keys.

- Platform diagnostics for microtask and immediate scheduling recommended calling `yieldNow()`. They now show `try Effect.yieldNow`, which runs Effect's native value.

- VibeLang could treat a namespace re-export in a `.d.vibe.ts` file as untyped and report `TS7006` in TypeScript callbacks. Explicit `.vibe` imports now find compatibility declarations when no source exists, preserving contextual types and real callback errors.

- `EK0401` offered no TypeScript-file migration and `--fix` skipped safe no-throw repairs. The editor now moves self-contained declarations with their imports and re-exports, preferring that option for published exports; `--fix` repairs plain handlers and unused local functions.

- A build with only an imported Effect warning, such as `promiseInEffectSuccess`, incorrectly exited successfully and could emit under `noEmitOnError`. Imported diagnostics now follow the pinned Effect TypeScript compiler's exit and emission options, including ignored warnings and explicitly enabled suggestions; VibeLang's own warnings retain their existing policy.
- Migrating a discarded `yield*` result that was itself an Effect could leave a bare program statement and prevent the migration from compiling; the fixer now writes `void try`, preserving the discarded value and keeping the inner program cold.
- Migration returned modules containing TaggedError classes the compiler deliberately kept to preserve their published tags. The style gate now accepts those explicit refusals while retaining other style checks.
- Two calls of a plain TypeScript function in one effect function, each with an Effect operand, made `vibelang --fix` refuse both with `TS2451`, because each fix named its operand's `const` the same; each now gets its own name, and `EK4401` is fixed.

- `for concurrent("unbounded")` and limits typed `Types.Concurrency` incorrectly failed with an argument type error; they now accept Effect's full concurrency domain.

- Old bare `fork { ... }` blocks, including `fork{}`, stayed behind during migration; `vibelang --fix` now writes explicit Effect construction while preserving the body and captures.
- Legacy `wire` calls kept their automatic dependency ordering after migration; `vibelang --fix` now writes explicit layer composition while preserving argument evaluation and public declaration types.
- Typed statement catches and exit-aware finalizers stayed behind during migration; `vibelang --fix` now converts safe cases while preserving declaration types and observed exits.
- Importing `vibelang-runtime/experimental/platform-node` loaded `@effect/platform-node`'s HTTP server with Effect's http stack and `ws` on import, about 180 modules a program providing only `ExperimentalNodeProcess` never used; the server module now loads when its layer is built.

- Importing `vibelang-runtime/experimental/platform-node` loaded the whole `@effect/platform-node` root, Redis client included, so every process using it (a `vite build` with a migrated plugin) paid for about 900 extra modules; the entry now imports only the `NodeHttpServer` module.

- Escaped declaration keywords such as `er\u0072or` were accepted while TypeScript rejected the corresponding contextual keyword. They now report `TS1260`; `vibelang --fix` restores the keyword without changing escaped names or identifier expressions.

- Declaration sidecars changed exported literal types containing source-map or reference-looking text. They now preserve that text and rewrite only actual directives.

- Exhaustive matches after an unconditional `return` or `throw` could report missing cases and errors on extracted fields. They now retain coverage and binding types while still rejecting missing cases.

- The guarded runtime entry omitted the error matcher registration helper exposed by the runtime ABI. It now exports the same helper with the same identity.

- The specification omitted the diagnostic for calls and property access after parenthesized or block-bodied `catch` handlers. All closed handlers now name `EK0512` and the repair that parenthesizes the whole expression.

- Plain generators were treated as Streams and rejected by `Effect.gen`; they now keep native iterator behavior, while `effect function*` remains a producer.

- Renaming a shorthand pattern binding could change the property it matched and add `TS2339`; rename now keeps the property key and writes an explicit binding.
- Optional Effect calls could be accepted when absent or rejected after narrowing. `try` now follows TypeScript nullability: possibly absent operands report `EK0502` under `strictNullChecks`, while proven-present calls remain valid.

- Rolldown entry globs could bundle generated `.d.vibex.ts` declarations as empty entrypoints; the plugin now excludes those sidecars and retains the JSX source entries and aliases.

- Published API checks rejected unchanged generic declarations when an import crossed a self-namespace export. Those copies now compare identically while changed exports and dependencies still fail.
- After the migrate flow moved a module-level `let` into a `.platform.ts` sibling, a kept function that assigned it failed `TS2632` ("Cannot assign to ... because it is an import"). The codemod now moves every function that writes the moved binding with it, or keeps the module in TypeScript when such a writer must stay exported.

- Running a parenthesized `effect { ... }` block with `try` was diagnosed as an old hatch; it now runs the block and preserves errors inside it.

- Ordinary classes used as extractors, including `when C():`, could compile without a diagnostic. They now report `EK0704` for every argument count; inheriting a custom matcher does not supply an own matcher.

- Ambient `error` and `schema error` declarations could also report member-restriction errors. They now report `EK1307` first, while preserving independent field-type errors.

- Site builds regenerated the same Markdown and LLM exports for every bundler environment; they now reuse that computation while preserving those exports and refreshing watch builds.

- A child forked inside a `provide` block could be rejected when joined after the block, or interrupted as the block ended. It now stays with the enclosing owner and keeps its provided services after the layer is released.
- Generic `data` helper names used unstable suffixes and could collide with source names; they now use `$Name$Definition` and the first free numbered suffix.
- Async-to-Effect conversion could skip a returned object's `then` getter or its error; conversions now preserve that Promise-adoption read by declining accessors and aliased objects, while keeping fresh data-property literals available.

- The editor's `EK0401` fix using `die` could join the next statement to a return and leave a syntax error. It now preserves the written semicolon and comments.
- `vibelang --fix` kept the type name an `Effect.fn` fix left unread, and so left a new TS6133 or TS6196, whenever another fix in the project was refused: retrying the refusals took the unread name for one the author had left. It now removes the name as it does when nothing is refused.

- Identical namespace exports with private generic constraints could fail an API identity check; declarations proven to be the same module export now compare directly.

- The grammar inventory omitted the binding-preservation helpers used by retired hatch fixes; their migration authority is now recorded.

- A service declaration could replace a written `Context` namespace alias with a new import in its public declaration. Generated service types now retain a visible namespace alias and preserve its import.
- The migration-only readonly upgrade preserves the former defaults of schema fields and service shape properties. Ordinary interface and object-type declarations retain their written modifiers.

- Passing or storing a function returning an Effect at a TypeScript-compatible callback type could report `EK4301`; these values now follow native TypeScript assignability, and calls still return their Effects unrun (VIP-1, detail303).

- Generic `schema` headers fell through to TypeScript errors or created an empty schema; they now report `EK1502`. `vibelang --fix` preserves the old empty schema and following expression for previously accepted headers.

- Direct default `schema` and `data` declarations produced TypeScript parser errors; they now report `EK1501` and `EK1603` with named-export guidance.

- Eligible `Schema.Struct` constants followed by their matching type aliases missed `EK4841`; they now receive the configurable warning and a preserving schema alias quick fix.

- A timing comparison saved inside a trial directory spoiled later comparisons with its own report; the tool now refuses that path before writing.

- Migrating a service default could widen an exported literal type such as `typeof Flags.default` in declarations; type reads now retain their original primitive type for downstream consumers.

- An upgrade could skip the required explicit-effects migration when the new compiler pinned a different `effect` version. The target capability probe now installs matching dependencies separately and reports dependency failures before changing the consumer.

- Service-default examples with local declarations could fail with `EK0903` before checking their fiber-name behavior. They now supply the required explicit keys and retain their original default values.

- `vibelang --fix` left legacy `abstract schema error` roots unchanged. It now writes their native abstract class while preserving the public API and family decoding.

- `vibelang --fix` left old `abstract error` roots unchanged. It now writes the equivalent native abstract class, retaining the public API and runtime matcher.

- Migrating an old error declaration with `vibelang --fix` could remove its runtime matcher. The equivalent class now retains tag matching and extractor behaviour as well as its constructor and public types.

- A comment between `service` and `class` stopped `vibelang --fix` from migrating the old service spelling. It now removes `class` while retaining the comments and service identity.

- The layer-declaration quick fix wrote a retired trailing block for layers with setup statements, so the replacement reported `EK1101` and `vibelang --fix` could refuse it. It now passes an explicit `effect { … }` argument to `Layer.effect`, keeping setup deferred until the layer builds.
- API checks invented ambient exports or hid an ambient type change when one input directory contained the other. Contributions now follow each snapshot’s dependency closure, and nested private-class origins remain distinct where required.

- The editor outline merged separate `module` declarations as TypeScript namespaces and hid a later declaration with the same name; each VibeLang module now keeps its own outline entry and name range, including an invalid duplicate.
- API comparisons of packages installed with multiple pnpm peer contexts could report an ambiguous ambient origin; corresponding peer installations now compare separately.
- API comparisons could reject identical copies of classes that imported Node ambient modules; those imports now use the declarations TypeScript resolves.

- Grammar checks no longer report the private trailing-block migration helpers as unaccounted; they are recorded as recovery under `VIP-11`, while trailing blocks stay rejected.

- The documentation sent readers to the removed `vibelang-forms -legacy` command. It now describes supported forms checks, and the unused legacy inventory is removed.

- Throw expressions rejected unary nesting and allowed some ambiguous operator and comma positions; they now follow the pinned TC39 proposal, including its parentheses and line-break rules (VIP-41).

- A `return` in a concurrent item’s computed name or class heritage could report a `do` implementation limitation or escape its required check. It now reports `EK1904`, including returns in head binding initialization, while nested functions keep their own returns.

- After the migrate flow moved a module's platform code into a `.platform.ts` sibling, a private `const` it moved could fail `TS18047` ("possibly null") where kept code read it inside a closure under a guard. The module now binds the moved value to a local `const` of the same name, so the guard narrows it as before.
- The migrate flow never split a module that an earlier pass returned to TypeScript for reading a host global such as `window`, `process.env` or `setTimeout` (`EK4402`), so the module went back to TypeScript on every pass. A run now lists earlier passes' `settle-causes.json` or `reverted.json` as `"platformCauses"` in its `config.json`, and the codemod moves the declarations that read each named global into the module's `.platform.ts` sibling.
- Plain function expressions after `catch` were returned as values instead of called; they now receive the failure, keep the result as data and allow ordinary typed parameters. Invalid generator handlers retain `EK0509` without artificial callback type errors.

- An overflowing `GO_TEST_SLICE` value could skip every Go test and report `PASS`; the shard launcher now rejects it before discovering or running tests.

- Returning `try` over an unchecked `any` could report an invalid Effect instead of a native iterator error. Tail returns now preserve native delegation, including `TypeError` defects and ordinary iterator completions.

- A plain `catch` handler returning an Effect missed its advisory; `EK0508` now warns and recommends `catch effect`, while the returned Effect remains data.

- A custom extractor returning `true` could silently miss an arm. It now throws `TypeError`, as every successful extractor result must be an iterable object; `false` still means no match.

- Specification table and authority checks rejected the historical explanation that accepted `VIP-40` supersedes denied `VIP-25`. They now verify the accepted successor while continuing to reject positive authority claims based on the denied proposal.
- API checks lost referenced ambient or library types when a declaration also contained a private class. Nominal alignment now preserves leading reference directives, and referenced type changes remain visible.

- Migration verification rejected unchanged programs whose original declaration emit already reported errors; it now compares with the saved original diagnostics and rejects new or unexplained emit failures while retaining the declaration identity checks.
- ESLint rules could mistake an `effect { ... }` program passed to `Effect.catchCause` for a handler that ignored its cause. Program blocks now appear as program values while real handlers retain their parameters and scope checks.
- A plain callback passed from Effect code could be rejected with `EK1005` when it called a captured root runner. Plain callbacks now retain their TypeScript body, just like assigned and returned functions.
- Imports left as `./x.ts` after a module became `.vibe` depended on a compatibility fallback; `vibelang --fix` now repairs those stale imports using the project's tsconfig (including `rootDirs` and `moduleSuffixes`), and the migrate flow selects source or runtime names by the same rules before that fallback is retired.

- A type assertion ending in `!!` followed by `<` was rejected as a malformed generic function type; it now parses as an ordinary comparison and keeps the usual operand checks.

- `eval`, the `Function` constructor, `arguments`, `with`, the `.constructor` of a function value and a string-literal `data:` or `blob:` import specifier compiled silently in `.vibe` files despite the language restriction; each now reports `EK0107`, while `x instanceof Function`, `Function.prototype`, the type `Function` and ordinary property names such as `o.eval` stay valid.

- Runtime parity checks reported missing JavaScript or failed imports for cases whose `rootDir` was a parent directory. They now locate and run the entry where TypeScript emits it.

- `vibelang --fix` refused an `Effect.gen` or `Effect.fn` whose body held a `.pipe` that changes type as `|>`, such as `.pipe(HttpEffect.toWebHandlerWith(context))`, whose stage takes its requirements from the `.pipe` (TS2345), and then wrote that `.pipe` as `|>` inside the generator it left, so the generator never converted. EK1002's fix now retries keeping the body's `.pipe` calls.
- `vibelang --fix` refused an `Effect.fn` whose parameter annotation was the last read of an imported value binding that only types read, such as a namespace in `SessionSchema.ID`, with TS6133, so the module stayed on `EK1002`; the fix now removes that binding too, and keeps a bare import under `verbatimModuleSyntax`.

- API checks rejected valid packages with `rootDir` or composite builds because their generated probe was outside the project. The virtual probe now stays inside the effective project root, while real outside-root source errors still invalidate the comparison.

- Exported `error` and `schema error` matchers could lose their types in downstream TypeScript projects. Their declarations now keep the static matcher and its runtime type dependency, including inside namespaces with local `Symbol` bindings.

- Identical recursive generic type exports could fail an API identity check because each side received a fresh comparison alias; proven equivalent declarations now share that alias.
- An object pattern whose `_tag` is an enum member or a unique symbol, such as `when { _tag: Kind.A }:`, covered no case, so a `match` naming every enum member still reported `EK4701`. Each such pattern now covers its tag case.
- A `match` over tagged members that share a tag, such as `{ _tag: "A"; x: number } | { _tag: "A"; y: number }`, or whose `_tag` is a union of literals, reported `EK4701` even when its arms covered every tag case. Coverage now counts each member's tag cases one at a time, as chapter 4 requires, and still reports the member or tag case an arm leaves.

- A generic plain call such as `expect(awaited(p))` silently received an unrun Effect. In effect code it now reports `EK4802`; `--fix` writes `expect(try awaited(p))`, and explicit Effect type arguments keep the program as data.

- Migration verification reported passing React Compiler coverage cases as missing after their source paths changed from `.ts` to `.vibe`; test titles now follow recorded source renames while retaining case counts and failures.

- `vibelang -p` panicked with `path must be rooted and normalized` on a `.d.ts` file whose directory or own name starts with or contains a dot, such as `/work/.hidden/proj/env.d.ts`, `.env.d.ts` or `..d.ts`, when an `include` pattern selected it; the compiler took the text before the last dot for a module body declaration source (`x.vibe.name.d.ts`) and now checks for a `.vibe` file name within the file name first, so these files are inputs as in tsc.
- Migrate setup pinned a Bun project's staged toolchain in root `resolutions`, which Bun ignores when the root `package.json` has `overrides`, so `bun install` asked the registry for an unpublished `vibelang-runtime` and failed. Setup now adds Bun's pins to an existing `overrides`, keeps `resolutions` otherwise, and removes a pin table it created when the pins are removed.
- `vibelang --fix` refused to remove `try Effect.void` from a `match` arm because its rewrite deleted the required arm expression and introduced `TS1109`. It now keeps a value in the arm, preserving inferred `void` types, comments and locally shadowed names.
- `vibelang --fix` left `Effect.fn(…)(function* (path) { … }, (effect, path) => …)` on `EK1002` when a stage read the function's arguments, or when a comment stood in the generator's parameter list or before a stage. It now passes the effect function's parameters to that stage, `|> ((effect, path) => …)(%, path)`, and keeps those comments in place. A stage that names an argument otherwise, `(effect, _path)`, keeps `EK1002`, because `Effect.fn`'s declaration takes the stage's name. A stage that reads an outer name that a generator parameter would hide, which the rewrite used to rebind silently, now keeps `EK1002` too.
- A line break after `try` caused parse errors for expression operands; member calls and other operands now compose across whitespace and comments.
- The migrate flow accepted a local object named `Effect` as a cold constructor and missed work in `Effect.gen` arguments. Its run-phase check now verifies import bindings, reports unknown constructors for review and blocks work that would move from the call to the Effect run.

- Forms-decision snapshot changes unnecessarily rebuilt the native compiler, mapper and forms generator. Their build keys now ignore those runtime inputs while checks still track them.

- An arm such as `when not Date: value.kind` could retain the original union and report `TS2339`. Negated ordinary-class patterns now narrow their arm like the false branch of `instanceof`.

- Named `effect` function and producer expressions accepted reserved names `fork` and `join`. They now report `EK1702`; `vibelang --fix` preserves the callable name and self-references through a local constant.

- Caller ownership probes had to read the native uid directly; `Experimental.Process.currentUid` now queries it while preserving an unavailable uid, valid uid `0` and the original lookup error.

- The `EK4853` quick fix could write an imported service's original name instead of its alias, introducing an unknown name or silently widening the requirement to an unrelated local `any` or `unknown` type. The editor and `--fix` now keep the bound alias or namespace qualifier and decline inaccessible requirement types.

- `vibelang lint --config anything.json` tried to open an unsupported custom configuration; it now reports `TS5023`, including when an Oxlint configuration is present. Select a compiler project with `-p` or `--project`.

- The VS Code extension README omitted JSX files; it now documents the distinct `vibex` language mode for `.vibex` files and its language server activation.

- Legacy `fork(program, options)` calls inside explicit `effect` code were left unchanged by `--fix`; they now become `try Effect.forkChild(program, options)` with their options preserved.

- Invalid `for concurrent` heads produced unrelated TypeScript parse errors. They now report `EK1906`; invalid `for try` heads report `EK2005`, including with `--noCheck`.

- An empty `provide` at the end of `do` could replace its preceding value with a `Layer`. It now keeps that value while still building and releasing the layer.

- An ordinary class used as an unchecked extractor could silently miss an instance. It now throws `TypeError` after successful `instanceof` recognition, as VIP-7 requires; noninstances still miss.

- Bare comma lists in a `for concurrent` limit were accepted outside the documented grammar; they are now rejected, and `vibelang --fix` adds parentheses without reordering their evaluation.

- A rejected `fork` operand wrapped in parentheses or `satisfies`, such as `fork (Effect.fail("bad") catch () => 7)`, also reported a compiler-generated call error. It now reports `EK1703` alone while preserving independent errors inside the operand.

- Array patterns skipped generators and other non-array iterables; they now match them and reuse pulled values across arms. Failed Effects leave destructuring iterators suspended, as native `Effect.gen` does.

- Identical recursive generic declaration APIs could fail with `TS2589`; exact resolved type identity now proves those comparisons.
- API checks treated identical JSDoc links as different when a private target resolved in only one snapshot. Link targets and labels now compare consistently while real comment changes remain differences.

- Editor consistency checks could report that renaming a TypeScript module block added or removed errors because its virtual filename changed. The checks now compare diagnostics under the original `.vibe` document, retaining every diagnostic (VIP-40).

- A pre-VIP-1 `fork(program, options)` left inside an already marked `effect` function made `--fix-vip-only` refuse the file with `EK1703`. It now writes `try Effect.forkChild(program, options)`, as it already did when adding the `effect` mark itself.
- A source-child helper inserted by migration failed with `EK4402` after its file became VibeLang. The codemod now keeps the helper in a private TypeScript module body, preserving loader arguments and declarations without adding public exports.

- Optional schema fields and tuple elements accepted explicit `undefined` even with `exactOptionalPropertyTypes` enabled. They now use `Schema.optionalKey` under that setting; an explicit `| undefined` keeps the previous acceptance.

- Incomplete matches on finite generic constraints could compile silently; they now report `EK4701`. `vibelang --fix` can preserve the previous no-match `TypeError` with an explicit default arm.

- Native `using` in Effect code omitted its resource warning; it now reports `EK0801` at the declaration and respects `vibe.severities`.
- `BigInt64Array(let n)` and `BigUint64Array(let n)` inferred the array container for `n`, producing incorrect declarations and rejecting bigint operations. They now infer `bigint`, matching the extracted element.

- A bare arrow after `|>` produced unrelated TypeScript parser errors. Plain, `async` and `effect` arrows now report `EK2301`; `vibelang --fix` parenthesizes the arrow, preserving its topic capture.

- Array-pattern bindings on readonly arrays inferred `any`; they now retain the source element type, including type parameters and `undefined`.

- `EK1301`'s quick fix, which rewrites an `error` declaration with a constructor as its Effect TypeScript class, copied the doc comment of the field after `_tag` into `TaggedError("Name" as string …)`'s arguments, so the class head carried a stray comment (Smithers `SmithersError`). The comment now stays only on its field.
- Non-field members in a `schema` body, such as methods and index signatures, reported the general `EK2109` type error. They now report `EK1505`; unsupported field types and schema alias types keep `EK2109`.

- API identity checks rejected two identical copies of a generic function using an `import()` type with literal type arguments. Copies now compare identically, while changed literal arguments and dependencies remain differences.

- Migration verification rejected unchanged published APIs because their declaration text or private file layout differed. It now uses the shared API checker for published packages, stock compiler proofs and earlier sidecars, preserving publication names and reporting unavailable probes separately.

- JavaScript launch scripts could fail strict `checkJs` after setup inserted a source-child helper. Generated JavaScript now keeps the helper’s parameter and tuple types, preserves native declarations, and retains readable spacing.

- A denied trailing block reported `TS1005` beside `EK1101` at the same brace; the compiler now omits that duplicate separator error while retaining independent syntax errors and preserving quick fixes.
- After the migrate flow set VibeLang up, a test that plain `node --test` ran failed with `ERR_UNKNOWN_FILE_EXTENSION ".vibe"` once it reached a migrated module, as in Smithers' `NodeTest` targets. Setup now preloads `vibelang/register` in each `node --test` package script and in each literal Smithers `Runtime.Node({ ... })` of a package that reaches migrated sources.

- Bindings inside `not` patterns no longer produce `EK4702`. `not(let x)` keeps prefix negation, and a callable extractor named `not` remains available as `helpers.not(let x)`.

- A transport waiting for stdin to close had to consume its input; `Experimental.Stdio.awaitInputClosed` now observes closure while leaving bytes and errors to the transport.

- Running an unannotated Vibe helper beside a foreign Effect could leave redundant subclasses in the inferred error channel; its channels now reduce as the equivalent `Effect.fn` program does. For a tagged catch that relied on the former inferred subclass, `--fix` preserves the local program's channel with an explicit return contract.

- Generic `data` declarations now accept line breaks and comments before their type parameters. `--fix` preserves affected `data as` and `data satisfies` assertions with parentheses.

- Documentation said a written `.ts` import could find only a `.ts` file. It now preserves TypeScript's native source and declaration substitutions while rejecting stale VibeLang fallbacks.

- Combining `effect` and `async`, as in `effect async function f() {}`, produced generic syntax errors or no specific diagnostic. Both orders now report `EK0105`; the editor offers removal of either function modifier, or removal of `async` from an Effect block. `vibelang --fix` removes `effect` from functions to preserve their previously emitted `Promise` API, and removes `async` from blocks.

- Release validation rejected the VIP-7 reference tests because they had no runner; `//:release` now checks parallel installation and cleanup after a failed install.

- ESLint corpus checks could miss lost function names or parameters named with contextual words such as `match`; those bindings now require their written identifier nodes, including after the final parameter is removed.
- The migrate flow still stopped before `--fix` when program discovery reported any error other than `EK0301`, such as `EK1702` in a recorded module outside the batch. Discovery now takes the compiler's file list whatever errors source files report, and stops only for configuration errors, crashes and an empty list.
- The migrate flow stopped before `--fix` when program discovery reported a repairable `EK0301` union-slot error. It now discovers the full file scope, repairs the spelling and lets subsequent checks report type errors that parsing had hidden.
- Migration could leave a path held as data naming a renamed module, which failed only when the program ran it; batched codemods now rewrite more static forms, and `verify` refuses the rest by module, file and line.
- Migration could miss a module a build selected by `.ts` and silently left out of `dist`; `verify` now builds from clean output before and after each batch and refuses each file the build no longer writes.

- With `jsx: preserve`, `.vibex` inputs emitted preserved JSX in `.js` files. They now emit `.jsx` files and `.jsx.map` source maps, including files with no JSX elements, as `.tsx` does.

- Looking up the temporary directory was suggested as an allocation; `Experimental.Process.temporaryDirectory` now queries the native path without creating a directory or file.

- Compiling an imported `.vibe` file outside the config directory left its sidecar beside the source despite `vibe.sidecarDir`. Sidecars now follow TypeScript's declaration source root and the compiling project's output directory; project references keep output with the owning project.
- Release notes repeated the upgrade and bug-fix sections, hiding later fixes from readers and documentation tools. Each section now appears once, with the unique fixes and upgrade repairs retained.

- The source mapper crashed with a stack overflow on a regex pattern with an extractor, such as `s is /(\d+)/(let m)`, in a file it projected. It now projects that file.
- `vibelang --fix` rewrote `return value` in a plain `function*` into `{ value; return }`, so a JavaScript caller that read the generator's return got `undefined` and the output reported no error. The EK2128 quick fix now applies only to a function marked `effect`; on a plain generator it leaves the file unchanged. A site `--fix` refuses now keeps its file byte-identical: if any rewrite in the run changed a refused site, that file keeps its original text, and each refused site is reported with its span and reason.

- `vibelang --fix` stopped with exit 3 ("a rewrite changed a refused site") and kept a file's old text when a later rewrite, such as shortening `Option.Option` to `Option`, touched a diagnostic it had declined. It recorded declined diagnostics from the program before the run, so a site a rewrite had repaired or moved read as changed, and its module-export rewrite never checked refused sites. --fix now records declined diagnostics from the final program and drops a rewrite edit that would touch a refused or declined site, reporting the edit as a refused site; the file's other fixes still apply and the run finishes. Exit 3 remains only for a site that changes despite these checks.

- The migrate flow's setup and codemod missed a Vite config named like `vite.config.playground.ts`: it got no `vibelang()` plugin, and a `serverEntry` it named kept the old `.ts` path, so that build failed once the entry was migrated. Both now treat `vite.config.<name>.ts` like `vite.<name>.config.ts`.
- When the migrate flow sent a module back to TypeScript, a consumer converted in the same batch named it with an added extension: t3code Mobile's `./runtime` became `./runtime.ts` in 53 files, which changed the declarations that print those names. Revert now restores the specifier the repository wrote in every consumer.
- The migrate flow sent a module back to TypeScript when a private helper threw, such as t3code's `knownTags` in `packages/contracts/src/baseSchemas.ts`, which checks a schema invariant at load; that kept it and `orchestrationV2.ts` in TypeScript. The codemod now moves each top-level declaration that throws in plain code into a VIP-40 `module throwing { }` body in the `.vibe` file and migrates the rest; the module's declarations are unchanged.
- A Node builtin imported as a value but read only as a type, such as `import { AsyncLocalStorage } from "node:async_hooks"` used in a parameter type, had no quick fix for `EK4402`. `vibelang --fix` now writes `import type`. Any value read or re-export keeps the import and its error.
- `Buffer.byteLength(text)` in a `.vibe` file had no quick fix, so migrating a module that only counted a string's bytes sent it back to TypeScript. `vibelang --fix` now writes `new TextEncoder().encode(text).length`, which returns the same number. A call with another encoding, or a value that is not always a string, keeps `EK4402`, and its note says why.
- A local binding named `fork` or `join` in effect code compiled with no error, and its calls silently became the fiber operation: `const fork = try FiberSet.makeRuntime(); fork(job)` waited for the fiber's cleanup instead of running the callback. Effect code that binds either name now reports `EK1702` (VIP-17), which it did not before, and `vibelang --fix` renames the binding and its calls. The fix also renames a `fork` or `join` that an `Effect.gen` or `Effect.fn` it rewrites reaches. An exported binding keeps its name through `export { fork2 as fork }`, an imported one through `import { join as join2 }`, and an object key stays `{ join: join2 }`.
- Under the `vibelang/bun` preload, a `module` body importing a package, an `imports` map entry or an extensionless relative `.ts` file, such as `import { theme } from "../theme"`, failed with `Cannot find module` from a `vibelang-module:` path. It now resolves as it does in a `.ts` file beside the `.vibe` file.
- The migrate flow's batch commits listed files on lines up to about 200 characters and named every file in the subject, so a repository with a commit-message wrap gate, such as Foldkit's 80-column check, failed on every batch. The flow now wraps commit bodies at 72 columns and shortens a long subject to `…, and N more`; the body still lists every file.
- The migrate flow left a Vitest `coverage.include` such as `src/**/*.ts` as it was, so each migrated `.vibe` module silently left the coverage report and its `.d.vibe.ts` sidecar joined it at 0 of 0 lines, while thresholds still passed. Setup now widens those globs to `{ts,vibe}` and excludes `**/*.d.vibe.ts`.
- The migrate flow's rules taught only `import { Array as Arr }` for `EK4842`, which a repository's lint can reject, as Foldkit's `prefer-effect-module-names` does. They now also teach `Effect.Array.map(xs, f)` with no import of `Array` or `Effect`.
- `vibelang --fix` over a package rewrote every module of it, and on a large package could run past 30 minutes with most fixes unapplied, so a migration of a few modules could change others or never finish. `vibelang --fix --only <files>` now repairs only the listed modules and checks only them, as a partial repair: the compilation after it still reports the whole project.
- Compiler test cases added after the Effect `4.1.1` pin still pinned `4.1.0`, and `interruption-restore-regions` read a service with the retired call form, `try Svc()`, so the repository's own checks failed. Every case now pins the runtime's Effect version and reads the service as `try Svc` (VIP-9).
- A file added to a project whose `include` writes a leading dot, such as `.source-collector-*.vibe`, was invisible to the compile cache, so the Node loader reported that the project excludes it until something else changed. The cache now sees it, and still ignores dotted files a pattern does not name.
- `vibelang --estree` wrote `try` before a tagged template, such as ``try sql`VACUUM INTO ${target}` ``, as the bare template, so ESLint's `no-unused-expressions` reported the statement. It is now the `$try(...)` call `try` writes before any other operand that is not a call.
- The migrate flow's `.vibelang/eslint.config.mjs` ran `getter-return` and `no-dupe-class-members` on `.vibe` files, which Oxlint skips on `.ts` files because TypeScript's checker reports them, so a getter whose `switch` covers every case got a warning its `.ts` original never had. The `.vibe` config now skips the same two.
- `vibelang --estree` declared the temporary a `do` expression assigns as `const`, so ESLint's `no-const-assign` reported `'$do1' is constant` at `do` expressions in `.vibe` files. It is now `let`. An author's pattern binding stays `const`.
- The migrate flow's style gate rejected `EK4804` on a private function whose original only inferred its global `Error` channel, so `packages/node` in Foldkit could not migrate without new annotations. It now accepts the advisory when the original function failed with a `new Error` with the same message; any other global `Error` stays rejected.

- The migrate flow could record a conversion in which a plain function lost an Effect wrapper, such as `Effect.succeed(xs)` becoming `xs` behind an `as` cast or `Effect.fail(e)` becoming `throw e` (Smithers' `Plugins` and `Refusals`), while types, declarations and the tests a batch reran could all pass; `verify` now compares each function of the original with the emitted JavaScript and fails the batch unless the run's `lost-wrappers-allow.json` names that function with a reason.

- Upgrade commits could split the VIP migration notice across the preceding paragraph when the body was wrapped. The notice now has its own paragraph while retaining the command, migrated-file count and body-width limit.

- API comparison could incorrectly prove different exports identical when a project disabled type checking; semantic checking now remains enabled for the comparison and invalid inputs still fail closed.

- Valid declarations could fail API comparison when the project checked unused code, because generated identity helpers were reported as unused; those checks now apply to the original inputs while synthetic probes remain exempt.

- Converting a retired `catch (cause: Cause)` could widen a public literal result such as `1 | 2` to `number`. The CLI and editor now leave that case unchanged unless an explicit return contract keeps its type.

- The editor's `EK4802` repair could run an Effect that the function returned as data, changing its result, type and side effects. It now leaves that return unchanged and explains the manual choices.

- The editor could replace `Layer.mergeAll` with `wire`, switching a dependency from the caller's layer to a sibling layer. It now leaves the composition unchanged and explains that the provider must be chosen explicitly.

- Private `trusted(impl, [])` wrappers had no migration away from the legacy trust form. `vibelang --fix` now rewrites safe direct calls through `Effect.try` and `Effect.orDie`, preserving the exact defect value and public declaration API; function values that escape remain for review.

- A `do` expression whose paths all leave outward could be typed as `any` or `undefined` and fail a `never` annotation; it now has type `never`. For calls or property uses that relied on the old `any`, `vibelang --fix` adds an erased assertion that preserves the outward jump.

- Migration loader-record receipts looked validated when the installed project module or checker was unavailable. They now distinguish completed, unavailable and failed validation while retaining the original write details.

- A `catch` after an unparenthesized `try`, `fork` or `join` could pass checking, including through `as`, `satisfies`, `!` and type assertions. These heads now report `EK0505`; source parentheses keep their explicit grouping.

- Public `vibelang/project` results omitted errors and warnings in native TypeScript files. Sync and async project checks now report diagnostics from every input, with a separate cache from loader compiles.
- `vibelang --fix` left legacy Effect data extension calls such as `Option.some(1).map(f)` unchanged. It now writes namespace calls such as `Option.map(Option.some(1), f)`, preserving evaluation order, comments, public declarations and module initialization order, and explains unsafe rewrites.

- Liveness checks rejected PID `0` even though the native signal-zero query can inspect the current process group. `try (try Experimental.Process.Process).isRunning(0)` now preserves that query; actual signal delivery still requires a positive PID.

- Returning an explicit service key widened its literal type to `string`; inferred function results now retain the key literal, as the native `Context.Service` counterpart does.
- A method's custom `bind` property could reject calls with a `do` argument or give them incorrect declaration types; calls and template tags now keep the original method's signatures.

- The editor's `instanceof` repair could reverse the evaluation order of its operands. It now leaves the test unchanged and asks for an explicit choice of test.

- The editor could replace `Schema.Struct` with `Schema.TaggedStruct`, changing which constructor inputs throw. It now keeps the original constructor and explains the difference.

- Converting an old layer declaration with setup statements could introduce a retired trailing block. The CLI and editor now write the current block argument and keep the layer's setup and methods.

- The editor could execute an Effect that the program deliberately left cold. It now keeps the expression unchanged and explains that execution must be chosen explicitly.

- The editor could change a fiber's lifetime while repairing an obsolete region warning. It now leaves the fork unchanged and asks for an explicit ownership choice.

- An editor type-spelling repair could modify an assertion whose unsafe channel conversion had been refused. It now protects the entire refused assertion while still repairing unrelated types.

- Removing a forbidden throws annotation could delete its JSDoc comment. The CLI and editor now leave the documentation unchanged and ask for a manual annotation edit.

- An editor class-pattern repair could discard captured variables or comments. It now keeps the property extraction and offers a bare class test only for an empty argument list.

- A file restored after a refused repair could get a new modification time despite keeping its original bytes. Rollback now restores the saved original file and metadata, while interrupted runs still keep verified fixes.

- `--fix` could simplify a `try` inside a plain function and hide `EK0501`; it now preserves that refused source span for manual repair.

- The CLI could leave removed `Effect.catchAll` APIs in otherwise repaired code, causing a runtime `TypeError`; it now applies the same Effect 4 renames as the editor.

- Effect 3 API repairs could rename functions whose callbacks or results changed in Effect 4. The editor and CLI now leave those sites unchanged and explain the manual migration.

- An `error` or `schema error` with an `extends` clause could compile when its native parent had a broad tag type. Both now report `EK2117`; `vibelang --fix` preserves valid inheritance as an explicit TypeScript class.

- `vibelang --fix` refused an `Effect.fn` whose parameter annotation was a type name's last read under `noUnusedLocals`, because writing the checked parameter type left the name unused (TS6133, TS6196), so the module stayed on `EK1002`; the fix now also removes that type-only import binding or module-local type alias.

- Generated child-process launchers added runtime type checks, redundant assertions and dense spacing that failed existing lint rules. Setup now uses the toolchain’s `Schema.String` boundary, keeps native argument behavior and safely refreshes owned helpers.

- Published declaration checks rejected even an unchanged namespace re-export when a generic type alias had the same name. They now resolve the namespace members through their module and still report changed names, types and comments.

- Setup needed a second run to finish refreshing a source-child loader helper when one call launched a typed source and another only probed a shell. It now removes the unnecessary wrapper and refreshes the retained helper in one pass.

- The pattern-matching reference example dropped callable objects with an `id` property; its TypeScript counterpart now includes them.

- Migration setup enabled `rewriteRelativeImportExtensions` when it was absent or inherited `false`; setup now preserves the project's native option and its inheritance.

- The match-arm grammar allowed two readings of a direct throw; it now unambiguously throws the full operand.
- `vibelang --fix` refused `EK4401` on a plain TypeScript call that reads a property a guard narrowed, such as `o.p ? f(o.p) : 0` or `if (!o.p) return 0; return f(o.p)`, because `Effect.try`'s function no longer knew what the guard proved (`TS2345`). The guard now joins the call in that function, or a `const` under the guard keeps the read; a call that runs before the read still blocks the move.

- Release validation rejected the stock-reference control suite because it had no test runner; `//:release` now runs checks for `Exit` values, public types, and version pins.

- `--fix-vip-only` reported `0 fixes` on two forms the old compiler accepted and that now fail to compile: a plain function that returns a value where its contract expects an Effect (`const f: () => number!! = () => 1`, `(n: number): number!! => n + 1`, `Effect.suspend(() => n === 0 ? 0 : g(n))`, `TS2322`), and a function passed where no overload matches and one takes the program, `withSpan(() => program, "name")` (`TS2769`). It now marks the first `effect`, with `try` on any program it returns, and writes `withSpan(effect { return try program }, "name")`.
- An `effect` function passed where a call infers its success, as in `Effect.suspend(effect () => sql`...`)`, succeeded with an Effect subtype it returned (a `sql` statement, an `Exit`, a `Config`) and never ran it, with no diagnostic, though the same code with `Effect.Effect` drew `EK4802`. It now draws `EK4802`, and `--fix-vip-only` writes the `try` that keeps it running as it did before VIP-1. A plain function that returns such a subtype where an Effect is expected, as `Effect.suspend(() => make())`, already ran it, and `--fix-vip-only` now leaves it as written instead of marking it `effect`.

- The `is` guide implied that every skipped pattern binding reports `TS2454`. It now documents TypeScript's exemptions for `any`, `unknown`, `void` and types containing `undefined`; conformance cases check both exempt and checked types.

- `await` on an Effect subtype, a `sql` statement or an `Exit`, or on a union with an Effect among its members, left it unrun with no diagnostic. It now reports `EK0103`, as `await` on an `Effect.Effect` does.
- Release notes exposed an internal decision identifier while explaining curried service provision; the explanation now uses only the public API names.

- Declaration comparison could reject a package compared with itself when a wildcard export combined built declarations with an unselected source condition. It now checks the concrete published names without inventing a literal `./*` module.

- A method called through a TypeScript assertion, `satisfies`, or `!` lost its receiver when an argument contained `do`; these calls now keep JavaScript receiver and evaluation order, and preserve the asserted function type.

- A forbidden `static` member in an `error` or `schema error` could report native class-shape errors alongside `EK1302`. It now reports the owning `EK1302`; independent errors in method bodies and payloads remain visible.

- Compiler conformance and editor formatting checks could fail on a fresh checkout because the dprint plugin was missing; their build targets now prepare the compiler package before running.

- Comparing declarations that re-exported generic global types could report missing standard library types; API checks now preserve the global library while checking those aliases.

- Custom compiler-case runners could fail before invoking the compiler; they now receive the same compiler executable that checked the case.

- A declaration comparison could lose an earlier blocking diagnostic while checking later entries and report a crash instead; it now retains that diagnostic and stops the unavailable comparison.

- Editor rename checks falsely reported a failure when TypeScript repaired duplicate declarations; checks now accept those repairs while still catching added collisions and unrelated diagnostic changes.

- Renaming a symbol in a file with an unfinished `module { ... }` declaration could crash the editor. Rename now skips the missing module name and still updates other bindings.

| Before | After and repair |
| --- | --- |
| A plain `error` method or getter with a computed key known to be `"_tag"`, including a branded singleton, template or string mapping | `EK2117` reserves the name. Run `vibelang --fix` to keep a compatible member in an explicit Effect TypeScript class; rename an instance member whose native override is invalid. |
| A typed `_tag` payload field in an `error` or `schema error` | `EK2117` reserves the generated tag name, including when the written type accepts it. Rename the field, or use `vibelang --fix` to retain a compatible contract in an explicit class. Fieldless plain bases with generated subclasses need a manual class migration. |
| An initialized `_tag` field, accessor or static member in an `error` or `schema error` | `EK2117` reserves the name; `--fix` retains previously valid members in explicit Effect classes. |

- ESLint corpus checks reported missing names for valid `is` patterns in loop conditions and updates; checks now distinguish written declarations from generated temporaries.

- `vibelang --fix-vip-only` wrote no `try` for a call passed to a generic parameter with another parameter beside it, such as `expect(awaited(p))` with `expect<T>(actual: T, message?: string)`: the file compiled, and the test received the program instead of its value. It now writes `expect(try awaited(p))`, as the old compiler ran it. A sibling argument that independently fixes the same type parameter to an Effect still keeps the programs held.

- The module specification exempted unannotated foreign calls from the plain-code throw check, and prelude examples relied on that exemption. They now follow VIP-4: unknown throws require a bridge or a native caught call.
- An effect method that suspended before calling `super.method()` could invoke the method's own `call` property, and a `super.tag` template could read its own `bind` property. Both now invoke the inherited method with the source receiver, preserving optional calls and evaluation order (VIP-1).

- Call hierarchy showed a base-constructor call at a derived `error` declaration's name. It now shows written call sites and omits compiler-generated constructor calls.

- The sidecar documentation always based source paths on the config directory, which gave wrong paths when TypeScript inferred another source root. It now follows the declaration layout, with an explicit root in the config-relative example.

- A TypeScript consumer could accept a wrong argument or result type from a function re-exported through a `module` body because its type became `any`. The body declaration beside the source now preserves the function signature, including exported arrow functions.
- The Alchemy union-and-`pipe` inference check incorrectly demanded a `TS2345` error from TypeScript 7.1; it now uses the migration’s TypeScript 5.9.3 baseline and verifies that the provider retains requirement `B`.

- A schema struct repair could delete a custom associated type whose helper was also spelled `Schema.Schema.Type`. The repair now resolves the helper and preserves unrelated aliases and interfaces.

- Promise-producing calls, constructors and tagged templates in effect code could bypass the required bridge, including union results. They now report `EK0404`; `--fix` preserves the Promise as data through a synchronous boundary.

- Loading a `.vibe` module through `vibelang/register`, `vibelang/bun` or a bundler plugin failed with `TS6305: Output file '…/lib/x.d.ts' has not been built from source file '…/src/x.ts'` when its tsconfig `references` a project that was not built yet, as in a fresh clone before `vibelang -b`; the loader's compile now reads a referenced project's types from its sources, as the editor does, and a relative import into that project no longer reports `TS2878`.
- Interruption blocks in plain or `async` code were accepted, or `restore` reported a nesting error. All three forms now report `EK2201` outside effect code. `vibelang --fix` removes the ignored keyword and keeps the ordinary JavaScript block.

- Checking a large declaration dependency graph could exhaust memory before comparing exports; input diagnostics now use fresh checker groups and retain the complete dependency diagnostics.

- A declaration comparison could retain the input checker's generic instantiations while allocating another checker for its probes; preparation now releases that state before probe checking begins.

- Comparing many independent declaration entry points could exhaust the heap even with small type probes; published entry points now use fresh, bounded groups while preserving the complete comparison verdict.

- `try` in an enum member initializer inside an `effect` function compiled to JavaScript that does not parse; it now reports `EK0501`, as a class field initializer does.
- In a `.vibe` file, `x.pipe(Effect.provide(layer))` failed with `TS2345` (`… is not assignable to parameter of type '(_: Effect<…>) => never'`) where the same `.ts` compiled: the type VibeLang gives a curried `Effect.provide(…)` lost its symbol, so `pipe` could not infer its result. Calling it directly, `Effect.provide(layer)(x)`, was not affected.
- The migrate flow left a module under a test directory out of a package's emitted JavaScript even when the package exports it, such as `"./test/TestDatabase": "./src/test/TestDatabase.ts"`, so plain Node importing it from another package failed with `ERR_UNKNOWN_FILE_EXTENSION` on its `.vibe` imports. The flow now emits and routes an exported test-directory module and what it imports relatively; `.test` and `.spec` files stay out.
- A nested Vitest project with its own `plugins` could miss the VibeLang loader even after setup wired the outer configuration. Setup now adds the loader to each inline project whose tests or setup files reach migrated sources, preserving the other project options.

- `EK4814` said decoding does not call a constructor that overrides a Schema class's, and its note said decoding builds instances without calling it. On Effect 4.1.1 decoding does call it, once per value. The message and note now say so.

- Published API checks merged ambient declarations across snapshots or rejected them as non-modules; ambient module exports and global contributions now compare in separate environments.

- Nested `do` expressions hid forbidden loop-head jumps and reported parameter `var` declarations as `EK0204`; they now report `EK0205` and `EK0203` exactly once across nested blocks.

- ESLint and Knip passed on a `.vibe` module without reading it in a repository that runs ESLint itself or installs Knip package by package. Setup now gives such a repository's TypeScript lint blocks and `eslint` script globs to `.vibe` files, and writes `knip.config.ts` with the `vibelang/knip` compiler in each package.
- Formatting JSX in a `.vibex` file failed or skipped the file. The native formatter, `vibelang-format`, `vibelang/prettier` and the dprint plugin now select TSX mode and preserve JSX text, entities, comments and `<T,>` generic arrows (VIP-39).

- A `schema error` class pattern rejected errors with the same `_tag` from another package copy; bare and extracting patterns now match that tag and keep the original subject. Class upgrades made by `vibelang --fix` retain the same matching.

- A local type alias or interface named `KeyFormat` or `Transferable` hid Effect's namespace in expressions such as `KeyFormat.jwk`; the type and value meanings now resolve independently, including in nested scopes.
- Repairing a custom alias named `Effect` could change its success, error or required service types. The `EK4833` CLI and editor repairs now keep aliases whose written arguments do not match the underlying Effect slots.
- Host globals inside `Effect.try`, `tryPromise`, `sync` and `callback` bodies could bypass platform checks. They now report `EK4402` throughout the file; `vibelang --fix` extracts self-contained wrappers into a checked TypeScript adapter.

- Migrating an unrelated module could change an inferred native import type from `import("./view").View` to `import("./view.ts").View`. Native import types now retain TypeScript's ending preferences.

- `try.allSettled` accepted heterogeneous named arrays and tuples and kept fixed lengths for named or spread tuples. Named operands now use the native `.map(Effect.exit)` callback check and array result; explicit literal elements keep their tuple positions, and `--fix` preserves earlier contracts (VIP-18).

- Old configuration reads in `catch` expressions still failed with `TS2349` after `vibelang --fix --fix-vip-only`; migration now removes the retired value call and preserves the catch boundary.

- `catch` could mix with `??`, `||` or `&&` without parentheses and accept a call or member access after a function handler. These forms now report `EK0512`; `vibelang --fix` preserves the earlier grouping and fallback evaluation.

- Logical assignments with a `do` right operand reread global accessors and could return a setter's transformed value. They now read once and return the original value when skipped or the right operand's value when assigned.

- Native home-directory lookups could fail with `HOME` unset when replaced by the environment-based `UserDirectories.home`. `Experimental.Process.homeDirectory` now preserves `os.homedir()` account fallback through the Node and Bun layers.

- Nested computed field keys in a `schema error` inside effect code incorrectly reported `EK0501` and `TS2464`; `try` now evaluates those keys in the enclosing Effect and keeps their failures and requirements. `vibelang --fix` preserves defects from formerly unchecked plain calls when their failures exceed a written contract.
- An `is` binding that redeclared a `const` local or a parameter also reported a misleading assignment or type error. It now reports the native redeclaration error at both declarations; assignments written in the source keep their usual checks.

- Reading a skipped `is` pattern binding from a closure returned `undefined`; it now throws `ReferenceError` until that binding pattern executes, including for `typeof` and source writes.

- Source-child loader wiring introduced a `fileURLToPath` import alias and failed repositories’ native import policies. Setup now uses a namespace import and refreshes its own previously generated helpers while preserving manually observed bindings.

- Rerunning migration setup left older publication helpers unable to pack nested import conditions, so package builds crashed with `value.replace is not a function`. Setup now upgrades those helpers while preserving their existing export paths.

- Node could load a native TypeScript wildcard export from a source folder and fail on its relative `.js` imports after a mixed package migrated. Routing now selects the compiled native component for those entries, preserving source type resolution and unrelated native exports.

- Packages migrated with a staged toolchain could pack runtime or source-child loader dependencies pointing into the migration checkout; setup now uses the artifacts' release versions in production dependencies and preserves staged builds for local development.
- ESLint corpus checks could overlook missing variable nodes when a name was also a contextual word, such as `match`; ordinary variable declarations now require their written identifier nodes.

- Stock TypeScript's experimental mapper treated `.vibex` as non-JSX TypeScript and broke JSX syntax; it now projects these files as TSX, preserves JSX source ranges, and includes JSX options in its cache key.

- An `await using` declaration in an `effect` function, producer or block reported the legacy `EK1003` diagnostic; it now reports the assigned placement error `EK0102` at `await`. Nested `async` functions retain native asynchronous disposal.

- Unknown foreign calls in effect code reported the legacy `EK4401` trust error; they now report `EK0403`, with the existing preserving `--fix` rewrite still available.

- A `.vibex` source and its package or mapped sidecar import could be treated as different modules, rejecting identical private class types; both now select the available source, and `.vibex` sidecars keep the correct extension in either layout.
- Producer methods marked `effect` could be checked or emitted as JavaScript generators; they now return lazy, repeatable streams and preserve `this`, `super` and member modifiers.

- Defaults in `effect` functions ran again on every execution and parameter writes were reset. Parameters now bind once at the call, and repeated runs share their bindings; binding exceptions become defects in the returned Effect (VIP-1).

- An `effect` arrow or named function expression that compared its own callable value incorrectly reported a circular-inference error; value-only self references now infer the same return type as their `Effect.gen` equivalents.
- Pipe grammar no longer rejects a pipe after a closed catch arrow body; it applies to the recovered value.

- An `await` in a TypeScript `namespace` was accepted and emitted invalid JavaScript; namespace bodies now report native `TS1308`, while explicit `async` functions keep their own await permission.
- Migrated packages could publish declaration sidecars and expose them through source export globs. Migration setup now excludes `*.d.vibe.ts` and `*.d.vibex.ts` from packs, and verification rejects sidecars or unexpected changes to the published file list.

- A local declaration named `SchemaAST` could capture the `ParseOptions` qualifier in an inferred decoder declaration, leaving an invalid public type. Inferred library types now keep their library module, as TypeScript does.
- The advanced Schema example accepted function-shaped decoding defaults in the docs but the library requires Effect values; the guide now explains the argument kind and checks the actual example and missing-key behavior directly.

- An anonymous function or class captured by a `do` conditional, method receiver, computed key, `match` subject, pipeline topic or returned completion record could expose a generated name such as `$do_v1`, `$match1`, `topic_1` or `value`; captures now preserve the source name before class static initialization and key conversion.
- The specification no longer holds an example that waits on denied VIP-8, or one written as two statements that parses as one. `spec-lint` now rejects both.
- Error-declaration guidance no longer gives the ambient-context error conflicting priorities; the generic member error is explicitly the fallback.

- An `is` pattern binding in a `for…of` right-hand expression or destructuring default reported `EK4703` and missing-name errors. It now belongs to the loop head or iteration and stays out of the surrounding block.

- Formatting refused a recovered `module { … }` declaration even when the parser reported no syntax error; it now formats the body and surrounding code while keeping the missing-name error `EK4003`.

- Declaration checks could compare an unused `types` export instead of an earlier matching package condition, hiding a real API change. Published entry discovery now follows TypeScript's conditional export order and preserves mirrored `.vibe` sidecar resolution.

- Declaration checks could miss a type change selected by an explicit `resolution-mode` import attribute. They now resolve each import using its own mode throughout the comparison.

- Declaration comparison treated every package `exports` fallback as a published entry point, producing errors for missing or unreachable alternatives. It now follows TypeScript's ordered fallback resolution and compares only selected declarations.

- Changing ambient overload import order could change an exported type while declaration comparison still passed. A changed ambient load order now makes the comparison unavailable, preserving the isolated types instead of merging away the difference.

- Wildcard package exports could make declaration checks compare private files blocked by `null` exclusions, or override an exact subpath with a broad pattern. Discovery now follows the most-specific `exports` key, so only published entry points count.

- Declaration API comparisons could overflow the stack on deeply nested exported objects and accumulate type relations across one large probe; they now walk iteratively and check bounded batches with progress and memory records.

- Comparing valid generic exports annotated with `in` or `out` could fail with `TS1274`, even for a package compared with itself. The generated probe now uses legal function type parameters while checking the original exported types.

- Published-declaration checks could accept a changed global type or doc comment because the two declaration trees merged their ambient declarations. They now prove ambient dependency closures and comments in isolation, and report an unavailable comparison when that proof fails.

- Migration setup moved existing declarations out of source folders but left package `types` pointing at deleted files, so TypeScript consumers could not resolve the package. Setup now refreshes owned declaration targets to the configured sidecar layout.
- Bun build scripts using `Bun.Glob("**/*.ts")` silently omitted migrated modules and could emit declaration sidecars as JavaScript entries. Migration setup now includes `.vibe` and `.vibex` sources and filters their declaration sidecars, including when refreshing an already wired build script.

- `vibelang --fix` could refuse a fix early in a run and not try it again after later fixes made it safe, so a second run changed the project; one run now retries refused fixes until none applies.

- `vibelang --fix-vip-only` refused a whole file when an argument passed by name was itself an effect block, such as `try (effect { return id(load(1)) } |> Effect.orDie(%))`, and reported the retired `try(…)` form (`EK4616`); it now writes `try` inside the block and leaves the block as it stands.
- A TypeScript `module` body had no editor action for moving it to a separate file; **Move module to a .ts file** now creates a sibling file and rewrites its imports and re-exports while preserving the program, without running from `--fix` (VIP-40).

- A TypeScript consumer of a `.vibe` sidecar that re-exported a `module` body's members could not resolve their declaration; body declarations now accompany the source, including with `--noEmit`, so stock `tsc` reads their types and `@throws` JSDoc (VIP-40).

- Setup stopped with `spawn E2BIG` when a large repository’s formatter file list exceeded Linux’s single-argument limit. Setup and record now split both formatter commands into bounded chunks, keep each command’s log and report failure if any chunk fails.

- `npm create vibelang` failed on Node 22, whose npm 10 crashes installing the pinned Vitest (`Cannot read properties of null (reading 'edgesOut')`), as do the install pages' `npm install` commands. The starter and those pages now pin Vitest 5.1.0, which npm 10 installs.

- Go test sharding could execute tests during discovery and again afterward when an argument stopped flag parsing; positional arguments, `-` and `--` now run the original binary once, preserving its arguments and exit status.
- ESLint corpus checks treated deliberately written dollar-prefixed names such as `$assertMatch` as compiler-generated bindings; they now check the reported source identifier and still reject synthesized or unwritten names.

- A non-iterable `for concurrent` operand exposed the generated helper's `TS2345`; it now reports `EK1901`, while valid iterable unions keep their independent diagnostics.

- Assigning a producer's `yield` result reported `TS7057` or inferred `any`; the result now has type `undefined`, while native generators retain their next-input types.

- The migrate flow rejected a test’s allowed module-path rename in `vi.mock` when `vi` came from `vite-plus/test`, blocking desktop migrations. The codemod and verifier now share mock-loader recognition; local, shadowed and unproven bindings and edits to mock payloads remain rejected.

- Form warnings missed direct `try` operands wrapped in parentheses or erased TypeScript expressions and warned about Effects stored or consumed elsewhere. `EK4834`, `EK4835` and the provider forms of `EK4836` now follow only the direct bare-`try` operand, recognize import aliases, and explain when a safe quick fix is unavailable.

- A trailing block separated from its call by JavaScript whitespace such as a nonbreaking space had no automatic repair; `vibelang --fix` now writes the callback argument for every single-line whitespace spelling.

- `Symbol.customMatcher` in a `.vibe` file reported `TS2339`, though chapter 4 and these docs write it; it now names the runtime's key without an import, unless the file declares its own `Symbol`.
- A class that inherited a static `Symbol.customMatcher` from a superclass matched through it; a class now uses only its own matcher, and `class B extends A {}` tests `instanceof`. Error families keep their generated tag matcher.
- An `Option.match` repair could write an unqualified payload type or a shortened record type and then be refused; generated callback annotations now keep qualified names and complete types.

- Plain JavaScript runners such as `Effect.runSyncExit(program)` incorrectly reported `EK4301` when their returned `Exit` was discarded; plain functions, callbacks and module statements now keep TypeScript's call behavior.

- Renaming a parameter in a predicate arrow could lose its declaration from Find References and leave names unchanged; references and rename now retain both the declaration and its uses at every name length.

- `Convert to a pipe` could turn a statement with an object argument into invalid syntax; object and class inputs now keep their expression context at the pipe head.

- Completion near a `service` keyword could crash when editor requests visited tokens in a different order; declaration keywords now use a consistent navigation token.

- Signature help inside an `error` declaration could crash near its fields or closing brace; generated payload types now contain their field spans, including leading comments.

- Renaming a service left its `Shape` type uses behind and added namespace errors; rename now follows those uses, including namespaces and imported aliases.

- Diagnostic tools still listed `EK2116` after its implicit-factory check was removed; that unused registration is now gone.

- The diagnostic inventory could overlook errors from stock TypeScript’s mapper; it now checks those codes against the reference along with native compiler diagnostics.

- The diagnostic guide cited a retired unused-`main` warning; it now describes that migration without presenting the old number as a current code.

- Declarations such as `effect load() {}` and `async load() {}` reported `EK4618` instead of VIP-1's `EK0101`. They now report `EK0101`, and the quick fix and `vibelang --fix` still insert `function`.
- An `effect` function annotated with bare `any` or `unknown`, or an alias or union that resolved to either, bypassed the required Effect return container check. It now reports `EK0106`; `vibelang --fix` can remove the broad annotation and infer the function's Effect contract.

- The editor repaired `await fiber` inside an `async` function with an unrun Effect and offered no repair for `await deferred`. Both quick fixes now keep `async` and wait for the completion value through `runPromise`, preserving operand evaluation and shadowed names. Unions and generic constraints keep their warning when the bridge cannot typecheck.
- `new Request(url)` in a `.vibe` file drew a note advising `globalThis.Request` inside a hatch or a module block, which the compiler then refused with `EK4402`, and `x instanceof Response` drew no note; both now say the global is platform code that lives in a `.ts` file.
- An `effect` prefix on a getter, setter, or class constructor was parsed as unrelated members or an ordinary method; it now reports `EK0104` on the prefix, while ordinary methods with those names keep working. `vibelang --fix` preserves supported parameterless constructors with a cold Effect return; parameter initialization and constructor-specific bindings require manual migration.

- Source loaders could select an unrelated `.tsx` sibling for emitted `.js`; they now follow the output’s source mapping and the project’s `jsx` mode, preserving the selected module’s identity.

- Under the Bun preload, a live `default` export stayed at its initial value and a module without one gained a `default`; emitted-source forwarding now preserves the source’s live bindings and export names.

- Setup could call a local parameter or function instead of the `tsdown` plugin when it shadowed the imported name; it now uses an unshadowed import alias and preserves every existing plugin.

- Schema repairs could reinterpret a value named `string` or another type keyword as a primitive schema; ambiguous aliases and fields now keep their library form.
- `vibelang --fix` left `Result.gen` in a `.vibe` file as `EK1002` with no quick fix and no reason. It now rewrites it to a plain function called in place, which stops at the first failure as `Result.gen` does, or says why it can't.

- Declaration imports could be forced to a different spelling by `vibelang.declarationImportStyle`; they now follow the TypeScript twin for the written import and tsconfig. The old setting is ignored with a deprecation warning, so existing configs still compile.

- Legacy `mutable` fields in an `error` could not be removed without changing its emitted payload type. `vibelang --fix` now writes an explicit compatibility class with the same declarations, constructor and tagged matching.

- Migrated interfaces and object types kept redundant `mutable` markers. `vibelang --fix` now removes those markers, including on index signatures, while preserving comments, writable fields and emitted declarations.

- Bun's release-age setting blocked newly published VibeLang packages in example projects; the examples now exempt their pinned VibeLang packages from that age check.
- `--fix` rewrote `.pipe(Semaphore.withPermits(semaphore, 1))` to `Semaphore.withPermits(%, semaphore, 1)`, which passes the program as the Semaphore, and then refused the whole `Effect.gen` with TS2740; a stage whose `self` is not the piped value now stays curried, as `Semaphore.withPermits(semaphore, 1)(%)`.
- A bare object after `fork` was interpreted as a legacy callback body; it now remains an object operand and receives `EK1703` when it is not an Effect.
- Editor fixes could write invalid annotations around `this` or `super`, a loop binding or a `finally` binding; they now decline edits that cannot preserve the program.
- Hover and rename missed references in match guards, `is` subjects, `and` patterns and error `extends` clauses; the editor now finds those original source references.
- An unfinished `catch` expression could produce document-outline ranges that ended before they started; outline entries now keep valid source ranges.
- Empty setting names or empty diagnostic keys in legacy compiler configuration could be silently ignored; they now report a configuration error.
- `--fix` wrote a `JSON.parse` or `new TextDecoder().decode` in an `Effect.gen` bare in the `effect` block, which turned a defect into a typed failure and changed the module's declared error channel, or failed with TS2375 against a written one; it now keeps the exception a defect through `Effect.orDie(Effect.try(...))`.
- An unfinished module declaration could crash the parser; it now reports syntax errors.
- An unfinished variable initializer or `catch` annotation could crash diagnostics or quick fixes; syntax errors now remain reported and unsafe rewrites are declined.
- `--fix` rewrote `.pipe(observe((o) => o._tag))`, a curried generic stage, to `observe((o) => o._tag)(%)`, where its type arguments fell back to their constraints and the program's type widened, failing with TS2375; such a stage now keeps its `.pipe`.
- `vibelang --fix --fix` reported `TS5023` instead of fixing the project; repeated `--fix` flags now apply the fixes once.
- The migration instructions omitted throwing synchronous helpers; they now explain when to use an expected failure, a defect or a retained TypeScript helper.
- The migrate flow's Effect upgrade left versioned pnpm selectors and patch metadata on the old release; matching selectors, patch filenames and `package.json` version references now move together while unrelated settings stay intact.
- When migration setup broke a Bun test suite, it threw before recording what failed; setup now records an issue with both exit statuses and the before-and-after logs.
- Migration instructions recommended a retired block-parameter form for tracing; they now show a program argument passed to `withSpan`.
- A call to a missing name or missing member could add a misleading warning about calling `any`; it now reports the original TypeScript error without that warning, while genuine `any` calls still warn.
- An interruption after `using` received a resource could arrive before its cleanup was registered; cleanup registration now completes before that interruption can escape.
- The migrate flow sent a module back to TypeScript when its platform code could not move to a sibling `.ts` file: an export that was no function with written types, a schema's value and type of one name, a default export, or a package with wildcard exports. With `"platformModuleBodies": true` in the run's `config.json`, such a module moves that code into a `module platform { }` body (VIP-40) and re-exports it, so the rest of the file converts.
- The Schema page passed `withDecodingDefaultType` a function where Effect 4.1.1 takes an Effect; the example now writes `Schema.withDecodingDefaultType(Effect.succeed(1))`.
- The migrate flow's generated ESLint configuration read only `.oxlintrc.json`, so a repository whose `vp lint` rules live in its Vite configuration linted `.vibe` files with almost no rules, and Oxlint's categories never reached `.vibe` files in any repository. It now reads the Vite configuration's `lint` section and takes the rules Oxlint itself resolves, and each run names the Oxlint rules that do not run on `.vibe` files. t3code goes from 21 rules to 91 of its `.ts` files' 188; the rest are Oxlint's own react, unicorn and oxc rules and typescript rules, which typescript-eslint does not provide under TypeScript 7. Where typescript-eslint cannot load, `no-unused-vars` no longer reports a type signature's parameters, names in a `declare` block, or an `effect` import kept for the declaration file.

- With `effect` not installed, `vibelang --fix` read the `function*` in `Effect.gen(function* () { … })` and `Effect.fn("load")(function* … )` as a producer and rewrote `return x + 1` to `{ x + 1; return }`, losing the value. A `function*` passed to a callee that does not resolve now draws no `EK2128` and no fix until the program resolves.

- A `.vibe` file could call `getComputedStyle` with no diagnostic, though VIP-33 bans it; it is now `EK4402`, which names `computedStyle` on `Experimental.Window`, which gives the live style.

- A `.vibe` file that passed `window` to an API that takes an event target, or read `window.location`, got `EK4402` with no service to use; `Experimental.Window` now gives the page's `Window`, `EK4402` names it, and `ExperimentalBrowserServices.layer` provides it.
- Service access written as a call, `try FileSystem.FileSystem()`, `try Path()`, `try ClassTag()` or `try Reference()`, compiled before explicit effects and now reports `TS2349` or `TS2348`. `--fix-vip-only` rewrote it, but plain `--fix` and the editor did not. A new quick fix, which `vibelang --fix` applies, writes `try FileSystem.FileSystem`, `try Path.Path`, `try ClassTag` or `try Reference`. A function that returns an Effect keeps its call.
- The specification gave the `EK4856` quick fix two triggers for the qualified `Effect.Effect<A, E, R>`: VIP-3 named only an interface heritage element, chapter 7 said "where the syntax requires it". Both now say it writes `A!E!R` where that needs no new parentheses and `Effect.Effect<A, E, R>` everywhere else, including `implements` clauses, unions and arrays of Effects (decided detail 260).
- The JSX specification (VIP-39) said `x ?? throw <E/>` is not VibeLang and told you to write `x ?? do { throw <E/> }`, though throw expressions follow the TC39 proposal (decided detail 284). It now says a throw expression is allowed wherever a throw statement is, with a JSX operand as in `.tsx`, and synchronous code still reports `EK0401`.
- Native lint could ignore an exact Unicode filename in an override or `ignorePatterns`, so rules ran on files that the configuration silenced. Literal glob text now keeps its Unicode spelling; wildcards, character classes and path separators retain their behavior.
- `vibelang --fix` left a `Schema.Struct` constant alone when its own type, `type X = typeof X.Type`, carried its own JSDoc, so the comment on the type could not survive the move to a `schema` declaration; it now writes the declaration and keeps the documented type beside it, which the declaration file prints with its comment as the native pair did (VIP-15, decided detail 256). An undocumented own type is removed as before.
- A `throw` in a plain function drew `EK4804`, `EK4811` or `EK4815`, the advisories about what an Effect function's typed failure fails with, as well as its error; only an Effect function's `throw` reports them now.
- The migrate flow's Smithers flow (`run.ts`) could not run the one-pass path: its plan step took only an agent, and a second execution planned the scope again after the rename and stopped with `scope module missing`; `run.ts --scope <scope.txt>` now plans one whole-scope pass with no agent, and a later execution keeps the recorded plan.
- The migrate flow's setup wrote a `test/tsconfig.json` that extends the package's test project, so typed lint finds the tests, and then its own verify rejected that file as a forbidden test edit, so `record` refused every batch of a package whose tests sit in `test/` beside a `tsconfig.test.json` (Smithers' `@smthrs/canonical`); verify now accepts each bridge setup wrote while its bytes are unchanged.
- The migrate flow's `record` formatted a batch's `.vibe` files with `vibelang-format`, which takes only the quote style and print width from a dprint configuration, so where that configuration loads VibeLang's dprint plugin, `dprint check` failed on them over settings such as `trailingCommas` and `arrowFunction.useParentheses` (Smithers: 258 files); `record` now runs the repository's `dprint fmt` on those files.
- A `do` expression after a spread, as in `[...items, do { … }]` or `f(...items, do { … })`, compiled to JavaScript that did not parse, and an elision before one, `[, do { … }]`, crashed the compiler. A `do` after an object spread, a computed object key, an untagged template substitution, a tag or a property constructor also ran too early: the spread's getters, the key's conversion, the substitution's `toString`, the tag's getter and the constructor's getter ran after the block. Each operand before a `do` now finishes before the block runs, as in JavaScript.
- A `do` expression ending in a declaration, a loop or an `if` without an `else` reported TypeScript's `TS1109`; it now reports `EK0201`, which names the statement (decided detail 247). A `do` ending in `break` or `continue` does not also report `EK0201`; a permitted jump keeps its enclosing target. A `do` ending in a labeled block, a `switch` (an empty case block included) or an empty statement is admitted, as the proposal's predicate admits them, and a `switch` clause ending in a loop, a bare `if` or a declaration is `EK0201`. A `do` ending in an empty interruption block, `do { uninterruptible {} }`, returned the block's marker call and failed to run; it is `undefined`.
- A `do` expression could fail with a value reported as assignable only to `undefined` when a pattern-binding type hook also typed its completion temporary; completion values now follow their branches while named `is` bindings retain their inferred types.
- An early `return` in a `do` expression, including a Foldkit-style `match` arm, was rejected or stopped at an artificial function boundary. It now returns from the enclosing function; nested `break` and `continue` keep their loop targets, and short-circuit operands retain their evaluation order. Method calls keep their receiver without reading a user-defined `.bind` property.
- A `return`, `break`, `continue` or `var` inside a `do { … }` element of `try.all`, `try.race`, `try.any` or `try.allSettled` was `EK0204`, because the compiler wrapped the element in a function. The element now runs where it stands, as every `do` does, so `return` leaves the enclosing function.

- A `.vibe` file could use `HTMLElement` and `CSS` as values with no diagnostic, though VIP-33 bans them; both are now `EK4402`, which names `isHTMLElement` and `escapeSelector` on `Experimental.Document`.
- Old `do` blocks used as Effect arguments stopped compiling when `do` became immediate; `vibelang --fix` now wraps them in explicit effect blocks while preserving their completion values.
- A `do { … }` passed as a call argument rejected `return` and `var`; these now reach the enclosing function, and method getters run before arguments while preserving `this` and the method's type.
- A `do` expression whose value is a conditional, an `if`/`else` or a nested `do` under a written result type, such as a `match` arm's `do { …; condition ? { _tag: 'SelectedEdge', value: 1 } : { _tag: 'IgnoredEdge', reason: 'GuardFailed' } }` in a function returning `Selection`, failed with `TS2322` because `_tag` widened to `string`: the completion value took no contextual type from where the `do` stands. The alternatives that produce the value now take the site's contextual type, as chapter 2 says, and the value keeps its literal types, so `const exact = do { 1 }` has type `1` and `(flag: boolean): 'a' | 'b' => do { flag ? 'a' : 'b' }` compiles.
- VIP-2: a `do` expression was a function called where it stood, so `var`, `return`, and a `break` or `continue` that left it were errors (`EK1019`, `TS1108`), and a `switch` or labeled block could not end it. It is now exactly TC39's do expression, pinned to the proposal's 2021-03-03 snapshot: its block runs in the enclosing function, so `var` hoists there, `await` in an `async` function waits there (it waited for nothing before), and `return`, `break` and `continue` reach the enclosing function or loop, and its value is the block's completion value. Reads before a `do` keep their earlier values, including property getters and object shorthand fields. TC39's early errors are `EK0201` (the block ends in a declaration, a loop or an `if` without `else`), `EK0205` (a jump out of a `do` expression in a loop's head) and `EK0203` (`var` in a `do` expression in a parameter list). Where no statement surrounds it, as in a parameter default, a class member, a `return`, `var`, jump out, `await` or `yield` inside it is `EK0204`.
- Migrating an unrelated module could change how a plugin host resolved its native provided modules; disconnected native exports now keep their source paths while shared runtime components still use one emitted instance.
- Bundling a mixed package's emitted native entry failed to resolve relative text assets such as `snapshot.txt`; migration now points those generated imports at the original assets, preserving bundle behavior and asset bytes.

- In a package containing both `.ts` and `.vibe` modules, an unchanged TypeScript export still sent `bun build` into a `.vibe` import, which it treated as a file asset. Migration now routes native runtime exports through the package's actual emitted files too; the source loaders resolve them back to their originals, preserving one instance.
- After the migrate flow renamed a package's module to `.vibe`, the `bun build` CLI, which loads no plugin, bundled it as a file asset and failed with `No matching export` (opencode's 90 `@opencode/schema` modules); the flow now commits each migrated package's emitted JavaScript under `.vibelang/js/` and points the package's `default` exports at it, while the loaders keep running the source.
- A package whose `default` export names its emitted JavaScript under `.vibelang/js/`, which the `bun build` CLI and plain `node` need, ran that committed JavaScript under `node --import vibelang/register` and the `vibelang/bun` preload too; both loaders now run its `.vibe` source, as one module instance.
- A listed platform global such as `setTimeout` or `fetch` passed with no diagnostic as a shorthand property, `{ setTimeout }`, and got `EK4402` in a type, `typeof setTimeout`, the opposite of an unlisted host global such as `WebAssembly`; both now follow the same rules: the shorthand is `EK4402`, and the type query is TypeScript's.
- A repository an earlier migrate flow set up kept `"moduleSuffixes": ["", ".d.vibe"]` in its tsconfigs, so `bun build` printed `moduleSuffixes is not supported yet` where the TypeScript twin printed nothing (Smithers: 76 tsconfigs); rerunning setup now removes exactly that value and keeps any other suffixes.
- The migrate flow's setup wrote an array compiler option without spaces, such as `"customConditions": ["vibelang","bun"]`, so a repository's dprint or Prettier check failed on every tsconfig it edited (Smithers: about 60 packages, for `moduleSuffixes`); it now writes `["vibelang", "bun"]`, as those formatters do.

- Documentation examples could not import `@effect/vitest` when another dependency supplied a different `@effect` package; snippet projects now link every scoped package from both dependency trees without changing shared installs.
- A `.vibe` script run by `NodeRuntime.runMain` exited 130 for both `SIGINT` and `SIGTERM`, because `runMain` interrupts on each and nothing told the program which arrived, so a script that exits 143 on `SIGTERM` had to keep a raw `process.once` listener in a `.ts` file; `(try Experimental.Process.Process).observeSignals(["SIGINT", "SIGTERM"])` now records the first signal received for a cleanup finalizer to read, and EK4402 for `process.on` and `process.once` names it.
- The formatter refused a file with `try x as T catch h`, `try x satisfies T catch h` or `try f<T> catch h`, or with `x as T catch h` outside parentheses, with an internal error (its TypeScript form did not parse), so `vibelang format` and the editor could not format it; it now formats the file and writes the parentheses the operand needs, `(try x as T) catch h`.
- In the editor, Find References and Go to Definition on the subject of an `is` pattern that binds names, such as `x` in `(x is { id: let id })`, found nothing, because the test the parser writes for the subject started at the `is` keyword; they now find the subject and its other references.
- The migrate flow's codemod wrote each renamed module's bare package export as `{ "types": "./x.d.vibe.ts", "default": "./x.vibe" }` even in a repository that already exports its `.vibe` modules as `"./src/X.vibe"` and checks that form, such as Smithers' export-map contracts; where any of the repository's manifests maps a subpath to a `.vibe` file by a bare path, the codemod now writes the bare path.
- A `vibelang --fix` run stopped by `SIGTERM` or Ctrl-C went on until the check under way ended, an hour on t3code's server, so a driver that waited a few minutes killed it; it now exits at once with the fixes it verified written.
- A migrated module's `.d.ts` named another `.vibe` module `./x.js` even in packages whose published declarations say `./x` or `./x.ts`, such as opencode's and Smithers', and an import the declaration added used double quotes in single-quoted files such as foldkit's; added imports now take the file's quote style. Declaration specifiers follow the TypeScript twin's written imports and tsconfig.
- A `.vibe` file that imported several Effect modules in one statement, `import { HashMap, Option } from 'effect'`, and wrote their types got one declaration import per name, such as `import { HashMap } from "effect"`; its `.d.ts` now keeps the one written import, in its order and quotes, and an added `Effect` joins it.
- A declaration named a migrated module in an inferred type `import("./x.js")` where `tsc` printed `import("./x.ts")`, as foldkit's `keyedQuery.d.ts` did under `module: nodenext` with `rewriteRelativeImportExtensions`, and a `.vibe` file's written `./helper.ts` became `./helper.js` under the default style; inferred import types now take the spelling `tsc` gives the unmigrated file, and every specifier other than `./x.vibe` stays as written under every style.
- On the VIP-1 compiler, `vibelang --fix --fix-vip-only` wrote no `try` for a call that ran without one before VIP-1, so foldkit's `when Option.None: die(new Error("missing"))` kept only the warning `EK4802` and returned its program instead of running it, with `0` fixes. The migration now writes `try` wherever the old compiler ran such a call: a statement, an initializer, a return value, a `match` or `?:` arm, `??`, `||`, `&&`, a `do` result, an `effect` arrow's body, a `catch` handler or fallback, an argument, an element or a property value. It marks `effect` each function the old compiler made an Effect function, a `catch` handler included, removes the `try` before a plain declaration's call whose result is data, and reports each call it can't decide as `try not written: …` instead of guessing. Ordinary `vibelang --fix` is unchanged.

- In a `.vibe` file, `Response.json(...)`, or another static member that the global `Response`, `Headers`, `Event` or `Worker` has and Effect's module of that name lacks, reported only `TS2339` on `typeof import("effect/dist/ai/Response")`, as in a Cloudflare Worker that returns `Response.json(rows)`; the error now says that bare `Response` is Effect's `effect/ai/Response` module and that the global's member is `globalThis.Response.json`, or, for a platform global such as `Worker`, that the code belongs in a `.ts` file.

- The migrate flow's setup put its `**/*.d.vibe.ts` ESLint ignore inside the arguments of an ESLint configuration that exports an array method's result, such as Smithers' `export default config.flatMap((entry) => ...)`, so ESLint could not load the configuration (`TypeError: object is not a function`); the entry now goes first in a list before the result's spread, `[{ ignores: [...] }, ...config.flatMap(...)]`.
- `eslint-plugin-import` found no exports in a `.vibe` module, so `import/namespace` and `import/named` reported every name a `.ts` file imported from one, such as `'batch' not found in imported namespace` in three Smithers packages; the migrate flow's setup now maps `.vibe` to `vibelang/eslint` in the `import/parsers` setting of each ESLint configuration that loads the plugin, and the devtools page documents the setting.
- `vibelang-format` and the dprint plugin parenthesized a `try`, `fork` or `join` operand of `in` or `instanceof`, writing `(try x) instanceof Error` for `try x instanceof Error` (before 0.0.11 main also did it before `is`, which edited 5 assertions in a Smithers test); a prefix keeps the parentheses it was written with, as `await` does.
- The migrate flow's codemod rewrote the imports of TypeScript and VibeLang files only, so a JavaScript script that imports a migrated module's source, such as Smithers' `.mjs` scripts importing `../../../src/Monitor.ts`, kept the `.ts` name and failed `import/no-unresolved`; `.js`, `.mjs`, `.cjs` and `.jsx` files now get the `.vibe` name where they name the source file, and keep `./x.js` and extensionless specifiers.
- The migrate flow's setup refused a toolchain switch when a package's only errors were Effect diagnostics such as `EK3870`, which exit 0: it compared the upgraded check's real exit code with one derived from the diagnostics' categories, 2. Setup now records its compile's own exit code and compares the two (Smithers: the switch to a toolchain with main's flow).
- A migration with an older or unresolved declaration baseline could report unchanged declarations without proving their published API. Verification now reconstructs the original publication metadata from the saved setup commit and compares exported names, strict type identity and normalized JSDoc. Missing evidence or an unavailable probe is reported separately and proves no identity. Equivalent formatting and module-specifier spelling pass. A package without an entry-point field, such as a CLI that publishes only a bundled `bin`, publishes only its root `index` declaration; its other declarations are private.
- A class pattern naming a service, `when Users:` or `when Users(let u):`, compiled and never matched, while `impl instanceof Users` reported `EK3004`; both pattern forms now report `EK3004` too (chapter 005's static rules).
- A `!` with no slot on its line, as in `const b: User!` followed by `NotFound` on the next line or `const e: User! = …`, silently compiled as `User!!`; it now reports the TypeScript error `TS17019`, while `User!!` may end a line and a parenthesized slot may span lines.

- `vibelang-unplugin` failed every build, even one that reached no `.vibe` module, with `Cannot find module 'vibelang/package.json'` when it started from a directory that installs no `vibelang`, such as an esbuild check in a test that Vitest runs from a monorepo's root, and a build without the `vibelang` package crashed the whole process with an unhandled rejection; the plugin now falls back to the `vibelang` package beside it, and a missing package fails only the build, with the install hint.
- The migrate flow's codemod sent every module that imports a Node or Bun builtin as a value back to TypeScript (EK4402), 22 Smithers modules among them; it now moves the platform code into `<Name>.platform.ts` beside the module and keeps each export that used it as a function with the same signature, so the module migrates with unchanged declarations.
- The migration's platform split moved only modules that import a Node builtin, so a module left with `EK4402` on a host global such as `process.kill` after `vibelang --fix` went back to TypeScript; the split now also moves the declarations that read the globals those `EK4402` messages name (`platformGlobalsOf`), and keeps the rest in the `.vibe` module.
- The migrate flow's codemod rewrote a specifier inside a comment, such as a doc comment's `{@link import("./x.ts").X}`, and declaration emit copied the comment, so a module's published declaration changed although the module stayed `.ts`; a specifier in a comment now stays as written.
- A declaration kept the parentheses a `!` type needs around a slot, printing `Effect.Effect<(A | B), E>` for `(A | B)!E`, so it differed from the same type written in TypeScript; those parentheses no longer reach the declaration.
- A `.vibe` module that wrote `effect { }` blocks but never named `Effect`, such as one whose codemod replaced each `Effect.gen` with a block, declared each block's type `import("effect/Effect").Effect<…>`; it now declares `Effect.Effect<…>` and imports `Effect`, as its Effect TypeScript twin does.
- A `.ts` module whose declaration copied a type that a `.vibe` module writes in the `!` form printed the slots the form leaves empty, `Effect.Effect<A, E, never>` for `A!E`, so a TypeScript importer's declaration changed when its dependency migrated, as t3code's `GitVcsDriver.ts` did; it now prints `Effect.Effect<A, E>`, as the `.vibe` module's own declaration does.
- A callback passed to a generic function, such as `run(() => program)` for `run<R>(f: () => Effect<void, never, R>)`, drew `EK9202` ("needs R, but its contract says R = R"): the check read the function's own type parameter as the callback's contract, though TypeScript infers it from the callback; a requirement or failure the call infers no longer escapes.
- A `console.log`, `console.error` or other `console` output call in effect code drew `EK4402` with no quick fix, so every migrated module that logged needed a hand edit; `vibelang --fix` now writes it as Effect's `Console` (`try Console.error(…)`), which prints the same and adds nothing to the function's contract. In plain code the call keeps `EK4402`.
- Under `noUncheckedIndexedAccess`, a binding in a list pattern, such as `when Exit.Success(let value)`, `when [let a, let b]` or `when Array(let n)`, read as `A | undefined`, so correct code failed with `TS2322` or `TS18048`; a binding now has its element type, because the pattern has already tested the length. Under `noPropertyAccessFromIndexSignature`, an object pattern on a `Record`, such as `when { a: let x }`, failed with `TS4111` at a key no source edit could change; it now compiles. Reads you write yourself, such as `s[0]` or `s.a`, keep both options.
- In a program with the DOM library, a declaration named Effect's `FileSystem`, `Headers` and other modules that share a DOM type's name as `FileSystem_1`, so it differed from the same module in TypeScript; it now prints the plain name, and keeps the alias only when the file also writes the DOM type.
- A producer that forked a scoped child, `try Effect.forkScoped(…)` in an `effect function*`, declared a `Stream` that required `Scope`, so consumers had to provide one the Stream already supplies; the inferred Stream requirements now leave `Scope` out, as `Stream.callback` does (decided detail 225).
- `restore` inside a `for concurrent` body or head binding reported `EK2111`, as if no mask enclosed it, or compiled under a mask opened inside the body; it now reports `EK2202`, as does a `restore` that would capture an enclosing `uninterruptible` block across an `effect` function, arrow, method, producer or block (VIP-22, amended 2026-10-30 and 2026-10-31). A `do` expression inside a mask no longer reports `EK2111` for its `restore`.
- A `break` or `continue` that would leave an `effect { }` block reported TypeScript's `TS1107`; it now reports `EK0202` (decided detail 247).
- Pattern bindings in parameter defaults and enum initializers reported a generic unsupported-binding error; they now identify the unsettled lexical scope with `EK0705`.
- Once the migrate flow moved an Oxlint JS plugin's modules to `.vibe`, every lint failed with `ERR_UNKNOWN_FILE_EXTENSION ".vibe"`, since Oxlint loads plugins through Node; setup now preloads `vibelang/register` in each script that runs Oxlint and in the plugin package's test scripts.
- The migrate flow's setup with `--no-wire` skipped wiring entirely, so a package of the run that an earlier setup had not wired, such as t3code's `oxlint-plugin-t3code`, `scripts` and `evals`, kept `tsc` and had no `vibelang-runtime`, and a migrated module there failed to load with `ERR_MODULE_NOT_FOUND`; setup now wires each such package with the specifiers the wired packages already use, and leaves the rest of the target as it was.
- A stock TypeScript consumer could read the types from `tag.ts` instead of an explicitly imported `tag.vibe` when both files shared a basename; compatibility declarations now preserve the source selected by written and inferred imports in either sidecar layout.
- A test or script that lists a folder's `*.ts` files and skips only `*.d.ts`, such as Smithers' `coding-stable-plan.test.ts`, imported the `x.d.vibe.ts` sidecar beside each `.vibe` module as source and failed; the new `vibe.sidecarDir` setting writes every sidecar under one hidden directory, conventionally `.vibe/declarations`, that tsconfig `rootDirs` lets stock `tsc` resolve, and switching it on or off removes the sidecars left in the other place. The migrate flow's setup turns it on where it finds such code, and its plan keeps the `.ts` modules that code lists as `.ts`. The Node and Bun loaders' compile cache treats that directory as output, so writing sidecars there does not force the next process to recompile. The same directory settings and immediate cleanup apply when `--no-wire` adds a new package beside existing wired packages.
- A consumer of another project's relocated declarations could report `TS2307` for native imports, or accept an incorrect type under `skipLibCheck`; relative references now resolve from the declaration's actual location, including native TypeScript files and VibeLang sibling declarations.
- Workspace imports could create two private class identities when one import reached a relocated declaration and another reached its source; both now use the matching workspace source after normal realpath resolution. A logical `node_modules` path retained by `preserveSymlinks` keeps its declaration identity.
- Migration setup could leave tracked adjacent sidecars behind after choosing a directory, so a later compiler run dirtied the tree; setup now removes the superseded paired outputs immediately and leaves unrelated declarations alone.
- Migration setup and package exports could ignore an inherited or custom sidecar directory; roots and export targets now use the same effective path, including `${configDir}` and empty overrides.
- TypeScript ast-grep rules and unquoted script globs could miss automatic sidecar relocation; setup now detects those selectors and records the reason.
- A `for concurrent` head pattern with a `do` that ran an Effect, as in `const { n = do { try poll } }` or a computed key `[do { … }]`, typed the binding as an Effect (TS2365, TS2538) and did not run it; the pattern now binds inside the item, as a `for...of` pattern binds inside its body, so the `do` runs there and the binding has its value. The mapper projects such a head back to its source pattern, not to the item it declares from.
- Under the `vibelang/bun` preload, the first `require` in a package whose `tsconfig.json` extends a package's config, such as `@tsconfig/bun/tsconfig.json`, made the preload's CommonJS hook call itself about 2,600 times and cost about 200 ms, so a short-lived `bun` child started several times slower and a large module graph took seconds (22 s instead of 0.5 s for one opencode test's child); the preload now reads each config once, and its own lookups go straight to Bun.
- Schema aliases could accept ordinary objects carrying only Effect's schema marker; references now require `Schema.Top` and report `EK2109`, with a preserving `const` and `type` expansion for old non-schema aliases.
- A local declaration inside a `for concurrent` body could incorrectly conflict with the loop binding; the body now keeps its own block scope.
- `Date` patterns could disagree with JavaScript after an object’s prototype changed or when matching a date from another realm; they now use the native `instanceof` test.
- Invalid schema aliases inside functions and namespaces could silently decode through `Schema.Unknown` or report unrelated TypeScript errors; they now report `EK2109`, and the preserving keyword fix keeps their previous codec and public type.
- An unmatched `match` formatted its subject while constructing the error, which could run coercion hooks and replace the error. It now throws the host-default `TypeError` with an empty message and does not read the subject.
- The runtime `$extract` constructor overload let a possible primitive result be assigned to `object`; its public types now include the primitive, so TypeScript rejects that assignment.
- An exported `AsyncFiberError` constructor could change its declaration spelling when a nearby matcher changed; inferred `Fiber` parameters now keep the same namespace import, while written types and local names remain intact.
- A producer with a written `Stream.Stream<A, E, R>` return type was rejected with `TS2739` (`Generator<…>` is not a `Stream`), so a producer could only leave its type to inference; its body is now checked as the generator it is, each `yield` against `A`, and callers and the declaration file keep the written `Stream`.
- `try.map x`, a name after `try.` other than `all`, `race`, `any` or `allSettled`, failed with three TypeScript parse errors; it is now `EK1803`, read as `try x` for recovery.
- A fiber on the left of a pipe, `fork a() |> Fiber.join(%)` or `f |> Fiber.join(%)`, was `EK4838` (an owned fiber used where it may not go); the fiber now goes where the pipe's topic goes, as chapter 2 says `fork a() |> f(%)` forks `a()` and pipes the Fiber, so a topic joined or passed to a `Fiber` function stays in its region and one passed to another call or captured by a function is still `EK4838`.
- A `.vibe` file that read `window.matchMedia` got `EK4402` and had to move the read to a `.ts` file, because Effect has no service for media queries; `Experimental.MediaQuery` now reads and follows a query, `EK4402` names it, and `ExperimentalBrowserServices.layer` provides it.
- A `.vibe` file that used `requestAnimationFrame`, `cancelAnimationFrame` or `Element.getAnimations` got `EK4402` and had to move the call to a `.ts` file; `Experimental.Animations` now gives `nextFrame`, `nextFrameUnless`, `frameDeltas` and `settled`, `EK4402` names it, and `ExperimentalBrowserServices.layer` provides it.
- A `.vibe` file that read a browser `File` got `EK4402`, which said to use `FileSystem`, and that service reads paths; `Experimental.FileReader` now reads a `Blob` or a `File` as text, a data URL or bytes, `EK4402` names it, and `ExperimentalBrowserServices.layer` provides it.
- A `.vibe` file that followed an element's size got `EK4402` for `ResizeObserver`; `Experimental.ResizeObserver` now observes an element until its Scope closes, `EK4402` names it, and `ExperimentalBrowserServices.layer` provides it.
- A `.vibe` file that passed `document` to an API that takes an event target got `EK4402` with no service to use; `Experimental.Document` now gives the page's `Document`, `EK4402` names it, and `ExperimentalBrowserServices.layer` provides it.
- A class pattern naming a `data` declaration, a `schema` declaration or a `Context.Reference`, such as `when Delivery:` or `when Address:`, compiled and matched almost anything at run time; it now reports `EK0702` and names the variant pattern or `Schema.is` guard to write instead.
- An extractor pattern that can never match, such as `when NotFound():` on an `error` (which extracts the subject) or `when Option.None(let v):`, compiled silently and its arm never ran; it now reports the lint warning `EK0703` naming the forms that match.
- **Language change:** a `throw` in a plain VibeLang function, method, constructor, accessor, generator, initializer, plain `catch` handler or module top level, and a call there known to throw such as `JSON.parse(s)` outside a `try`/`catch` statement, compiled; the specification now makes them `EK0401` (VIP-4, amended 2026-10-31): make the function `effect`, or move the code to a `.ts` file. `throw` in `effect` and `async` functions is unchanged. `EK0511` and `EK0405` are retired.
- `EK0401` had no quick fix. The editor now offers "Make f an effect function", which adds `effect`, drops a plain return annotation and wraps a known-throwing call in `try Effect.try(() => …)`, and the same with `return try die(e)` for a `throw` statement; a plain `catch` handler becomes `catch effect`. The fix is not offered where making the function `effect` would change a type something else fixes: an overload implementation, or a method that implements an interface member, overrides a base method or fills a contextual type's member.
- A call known to throw, such as `JSON.parse(text)` or a `.ts` function tagged `@throws`, compiled in a plain VibeLang function, constructor or the module's top level, where its exception escaped as JavaScript's. It is now `EK0401`, unless it stands in the `try` block of a `try` statement with a `catch` clause in the same function. Make the function `effect` and run the call with `try Effect.try(() => …)`, or move the code to a `.ts` file. A `.ts` call without a contract is still an ordinary call.
- `vibelang --fix` rewrote the retired `try(…)` hatch `try((text) => JSON.parse(text), text)` as `try Effect.try(() => ((text) => JSON.parse(text))(text))`, whose arrow, called in place, is plain code holding a call known to throw (`EK0401`), so the fix was refused. It now writes the arrow's body as the thunk, `try Effect.try(() => JSON.parse(text))`, binding an input of another name with `let`: `() => { let text = "1"; return JSON.parse(text) }`. A parameter whose input has its own name is still its own binding: where the body assigns it, a function in the body captures it, or it has a written type, the thunk copies the input and rebinds the parameter in an inner block, `() => { const textInput = text; { let text = textInput; text = "2"; return JSON.parse(text) } }`, so a write or a later closure call no longer changes the caller's variable.
- A callback nested in `Effect.try`'s thunk, the `Promise` executor or another literal whose throws belong to the call it is passed to compiled with a call known to throw, such as `return try Effect.try(() => { return (): unknown => JSON.parse("{") })`, so the returned callback threw a native `SyntaxError` after `Effect.try` had finished. Only the literal's own body may hold such calls now; a function nested in it, returned, stored, passed on or called in place, is its own plain code and the call is `EK0401`.
- The quick fixes for `Effect.catchTag` of part of a failure (`EK4835`) and a typed `catch` expression (`EK2112`) wrote a plain handler ending in `default: throw e`, which is `EK0401`, so `vibelang --fix` refused them. A handler that rethrows is now written `catch effect (e) => …`.
- A `throw` in synchronous VibeLang code outside effect code was reported under five different codes, `EK9203`, `EK1001`, `EK2115`, `EK4301` or the `EK0511` warning, and compiled when the same code's own `try` caught it. Synchronous VibeLang code never throws: each such `throw`, in a plain function, method, constructor, accessor, plain generator, field or `static` initializer, parameter default, plain `catch` handler or the module's top level, is now `EK0401` at the `throw`. Make the function `effect`, whose `throw` is `Effect.fail`, or move the code to a `.ts` file. A `throw` in an `async` function still rejects its Promise.
- A `throw` in an ordinary `async` function's parameter default was `EK0401`, though it rejects the function's Promise as a `throw` in its body does; it now compiles. A call known to throw, such as `JSON.parse(text)`, in a callback passed as the `Promise` executor or to a parameter whose function type has `@throws`, was `EK0401`; it now compiles, because the call that receives the callback answers for its throws.
- `vibelang --fix` for `EK4401` kept a function plain with `: infer _` when its foreign call's `@throws` named a class the file can't reach, leaving a plain function that calls code known to throw (`EK0401`). It now makes the function `effect` and runs the call with `try Effect.orDie(Effect.try(…))`, as for the other foreign calls.
- A `@throws` or `@rethrows` tag in a `.vibe` file compiled silently, though a VibeLang function never throws and the compiler read no thrown type from it. Each such tag, on any declaration, signature or type, now reports `EK0406`, and `vibelang --fix` removes it; write an `effect` function's failures in its error type, such as `number!NotFound`.
- A callback passed into a rest parameter whose element type has `@throws`, such as `rest((): unknown => JSON.parse("{"))` for `rest(...fs: Reader[])`, was `EK0401` at the call, though the same callback passed to a fixed `Reader` parameter compiled. The check read the whole rest array's type, which has no call signature. Each argument now takes its effective parameter: the rest element, or the tuple-rest member at its position.
- `vibelang --fix` rewrote a retired `try(…)` hatch with a getter among its inputs, such as `try((ignored, text) => () => text, box.value, text)`, into a thunk that read `text` before the getter ran, or not at all, so the result changed. When an input may run code, the thunk now evaluates every input once, left to right, into a `const` of its own, then binds the parameters, as the call did.
- The migrate flow left a lint script that runs Oxlint in parentheses, `(oxlint --disable-nested-config)`, without its `.vibe` ESLint pass, and did the same to `(oxfmt --check .)` and `(prettier --check .)`, so those tools skipped `.vibe` files; each rerun of setup also added another layer of ESLint passes to a wired script, kept an earlier run's pass with the wrong `-c` configuration, and re-added the `**/*.d.vibe.ts` ESLint ignore once a formatter had requoted it. Each of these scripts now gets its pass, setup rewrites the passes it wrote before, and a rerun changes nothing.
- `vibelang --fix` checked the whole project for each trial when no error traced to the fixes it was trying, so a package with many such fixes spent hours on a round's last few: on a generated project, 240 modules took 245 whole checks where 60 took 65. It now looks for a trial's errors in the files that reported errors earlier in the round, and checks the kept fixes against the whole project once at the end: the same 240 modules take 4 whole checks, and a fix refused this way names the first error of those files.
- `vibelang --fix` checked the whole project once for each fix that added an error to another file, so a package with many such fixes took time that grew with the square of its size: on a generated project, 240 modules took 78 checks and 6.5 s where 60 took 24 and 0.9 s. It now finds the fixes behind the errors of different files together, in a few checks of those files, and prints the checks of each round in its progress line. When the prelude's rewrites added an error together, it also checked the project once for each file it rewrote; it now finds the rewrites that add one as it finds the fixes that do.
- `vibelang --fix` printed nothing until its report, so a 3-hour run on a large package looked like a hang; it now prints its phase, round, fixes applied, pending and refused, and the checks it has made to stderr every five seconds. Stdout is unchanged.
- A `vibelang --fix` run stopped by a timeout, `SIGTERM` or Ctrl-C wrote nothing, so an hour of checked fixes on a large package was lost; it now writes each file as soon as its fixes pass the check, keeps every fix it checked and none it did not, and a second run finishes the work.
- `vibelang --fix` refused a fix that only changed the message of an error the program already reported at the same place, such as a test's existing `TS2345` that named `Effect<brand<…>>` before a schema helper got its plain return type and `brand<…>` after, so the helper stayed an Effect function; an error at the same file, code and span now counts as the same error, and a fix that adds an error is still refused.
- `vibelang --fix` checked the whole project once or more for each fix it refused, and again in each round that offered a refused edit once more: on t3code's `packages/contracts`, 99 refusals over 32 rounds took 386 checks and 30 minutes. It now tells which fixes add errors from where the errors are and which declarations they read, and refuses an edit it refused before to the same text without checking again; that package takes 17 checks and under 2 minutes, with the same fixes and refusals.
- The migrate flow's inventory recorded only relative imports, so a module imported through a tsconfig `paths` alias such as `~/hooks/useSettings` had no dependents, and the plan and the rollback ordered such modules after the files that import them; setup now resolves each package's `paths` aliases as TypeScript does and records those imports too.
- The migrate flow's declaration identity check failed a module whose declaration file differed only in the order of its import statements, as when the codemod's `import { Tool, Toolkit } from "effect/ai"` moved ahead of the others; equivalent import and re-export order now passes for published and private declarations while exported names, strict types and JSDoc remain checked.
- The migrate flow's declaration identity check failed a module whose private `Schema.Struct` constant became a `schema` declaration, because the declaration file then also printed `type State = typeof State.Type`, a private alias nothing names; private aliases now pass when they preserve every exported name, type and doc comment, including in a published declaration file.
- The migrate flow's codemod, which rewrites a renamed module's importers anywhere in the repository, also rewrote specifiers such as `../src/Command.ts` that name a module an earlier migration had already made `.vibe`, so a batch edited files it had nothing to do with; the codemod and `revert` now change only the imports of the modules the batch renames or puts back, and the imports inside them.
- The migrate flow's `record` left a batch's `.vibe` files unformatted whenever jj saw the module as renamed, as Smithers' `src/{Crypto.ts => Crypto.vibe}`, so the repository's format check then failed on them; `record` now formats and refreshes the sidecars of every `.vibe` file the batch wrote, renamed or not.
- The migrate flow's `verify` listed a baseline test as missing when its name printed a date, such as `it.each([[new Date()]])("rejects %s")`, so a package with one could never pass; tests are now matched with any `Date#toString`, `toUTCString` or ISO date in their names set aside.
- The migrate flow's setup wired `vibelang-vite` into the Vitest config the tests load without `register`, so a test that starts `node` on the sources, such as 62 of Smithers' test files, failed once the module graph reached a `.vibe` file; setup now writes `vibelang({ register: true })`, and adds `register: true` to a config that already had the plugin.
- `vibelang-vite`'s `register: true` set only `NODE_OPTIONS`, so under `bun x --bun vitest` a test that started `process.execPath`, then Bun, could not import `.vibe` source; the plugin now also adds `--preload` of `vibelang/bun` to the tests' `BUN_OPTIONS`.
- The migrate flow's setup on a new toolchain emitted the baseline declarations of modules earlier runs had migrated with that toolchain, so a toolchain change to their public API, such as foldkit's `mount/index` losing `readonly` members, became the baseline and every batch passed against it. Setup now compares each such module's declaration with the sidecar the earlier run committed and records a setup issue for each change.
- The migrate flow pointed a renamed module's package `exports` and `types` at `x.vibe`, so stock TypeScript, reading the module through its declaration sidecar, reported `TS2883` where a consumer's inferred type named one of the module's types; a `types` field or condition now names `x.d.vibe.ts`, and a bare entry becomes `{ "types": "./x.d.vibe.ts", "default": "./x.vibe" }`.
- A `.vibe` module in a project with no declaration output failed to compile when its declaration sidecar could not print an export's type, such as foldkit's `AppTabs = Tabs.create<…>()` (`TS2883`), though `tsc` compiles the same TypeScript, which emits no declarations, without an error. Such an error is now reported only where a `.ts` file of the project imports the module, at that import, since that file reads the sidecar; a project that emits declarations still reports it at the export.
- The migrate flow's `verify` passed a batch whose declaration emit failed in a migrated file, such as `TS7056` for a type too long to serialize, when the baseline's emit failed the same way and the two fallbacks were equal; it records emit failures separately from artifact equality. Newly introduced diagnostics fail the batch; inherited diagnostics require the saved original program receipt and do not establish API identity for a missing declaration.
- `await` at a `.vibe` module's top level, such as `export const answer = await Promise.resolve(42)`, was VibeLang's await, so it reported `EK4602` and `EK1001` and emitted a runtime `$await` call. It is ES top-level await of a Promise now, in a declaration, a statement or a block, as the spec says (VIP-26); an Effect operand is `EK0103`, and a CommonJS file reports TypeScript's `TS1309`.
- Migrating a service default could capture a user-defined `ReturnType` and change exported types; the repair now extracts the factory return type without relying on that name.
- A legacy service `default` with no value could be silently accepted and had no usable migration; it now reports `EK0902`, while initialized defaults keep their migration warning and repair.
- Formatting an inline `@internal` or other JSDoc comment beside an error payload could silently change its declaration output; the formatter now refuses changes to comment attachment and leaves the file intact.
- The runtime helper `$produce` required an external `Scope` even though its Stream callback supplies one; its result now removes that requirement and keeps other services.
- Splitting `for concurrent` across lines could cause syntax errors; line breaks and multiline comments now work before either the limit or loop head.
- Exporting a top-level `data` or `schema` named `as` produced a `.d.ts` file TypeScript could not parse; its exported type now uses an unambiguous declaration and keeps the same public name.
- Formatting `async f()` or `effect f()` silently migrated the declaration and removed `EK0101`; formatting now preserves the shorthand, and `vibelang --fix` applies its existing repair.
- Checking explicit files beside a project config failed with `TS5112` unless `--ignoreConfig` was added; compiler and `lint` file arguments now bypass config discovery as specified.
- A local binding named `undefined` could reject `for concurrent` or silently limit its concurrency; an omitted limit now always runs unbounded.
- The TypeScript mapper evaluated a `for concurrent` iterable before its written limit; both renderings now evaluate the limit first, once.
- Fiber operators before exponentiation could compile or report a misleading type error. `fork` and `join` now require parentheses on the left of `**`, like `await`.
- Effect methods with bigint literal names, such as `effect 1n()`, were rejected with syntax errors; those names now work as TypeScript method names do.
- Optional class methods such as `effect read?()` were rejected with syntax errors; optional names now work for ordinary, computed and generic Effect methods, with TypeScript's usual checks.
- A statement such as `effect as (Handler)` or `async satisfies (Handler)` could be mistaken for a removed function shorthand and rejected; `as` and `satisfies` expressions now keep their TypeScript meaning.
- An `effect` method with a computed name, such as `effect [key]()`, was rejected with syntax errors in a class or object literal; computed names now work for instance, static and generic Effect methods.
- The config preview silently dropped invalid settings; `vibelang --showConfig` now reports local and inherited configuration errors and exits unsuccessfully.
- `vibelang --fix` could refuse a plain helper that collected another helper's results, because it wrote their old `Effect` result type. It now infers the corrected return type.
- Expressions such as `join fork task` and `! join child` caused parser errors. Fiber operators now compose as ordinary unary expressions.
- Exporting a `data` declaration named `as` produced an invalid declaration file; the emitted type alias now disambiguates the contextual name and remains usable by TypeScript consumers.
- Generic `data` parameters silently accepted defaults that its constructors do not support. Defaults now report `EK2803`; `vibelang --fix` preserves them in equivalent Effect TypeScript.

| Before | After and repair |
| --- | --- |
| A schema field with a class-only modifier such as `public` or `static` | `TS1070`: run `vibelang --fix` to remove ignored modifiers and preserve the field’s codec and readonly behavior. |
| A producer has a written annotation incompatible with its `Stream` result, such as `number[]` or `never` | `EK2102`: write a compatible contract or omit the annotation. Aliases, `any`, `unknown` and compatible unions follow TypeScript's ordinary return checking; `--fix` can write the inferred `Stream` contract while preserving execution. |
- `--fix` could repeatedly recheck a large project when an importer's errors came from one edited dependency. It now traces referenced declarations and keeps unrelated reporter edits together while retaining the complete safety check.
- The compiler reported `EK1307` for an ambient `error` or `schema error` declaration, but Appendix B did not list the code; it does now.
- Six compiler cases still expected behaviour the language had already changed: plain `main` functions after VIP-1, an unrun `Fiber.join` result, an `error` constructor (`EK1301`), a last match arm without `;`, and `EK1003` for `for await` in a plain function; they now state current behaviour, and that last one is `plain-for-await.fail`, expecting `TS1103`.
- `try` on a value that is not an Effect made the enclosing function `any`, which added a stray `EK3205` at `main`, and `try` on a value typed by a constrained type parameter lost its success and error types; the `try` now reports only `EK0502` and the type parameter keeps the channels of its constraint.

- Migration declaration checks now cover generic span rewrites that accidentally remove a requirement, while accepting equivalent formatting and union order.

- The specification's folded details referred to removed `EK1020` and `EK4843` checks as though they still needed diagnostic registry entries. Both references now explicitly identify historical checks, matching VIP-1 and VIP-26.

| Before | After and repair |
| --- | --- |
| Imports of older generated generic-data helpers such as `OutcomeDefinition` | Run `vibelang --fix` in owned `.vibe` sources. Native TypeScript consumers stay unchanged; update their imported helper name to `$Outcome$Definition`. |
- A legacy service member call in a `catch` head could typecheck but throw a `TypeError` instead of handling its typed failure. Accepted service calls in `catch`, `try` and pipe heads now look up the service before calling its member, and the lookup remains in the inferred requirements.

- Comparing an unchanged declaration package could report a type difference for a `private` getter, setter or method with an elided type, or for a private getter/setter pair. The API-identity checker now preserves their original types and visibility while still detecting added or removed private members.
- The migrate flow's inventory did not see a `Bun.spawn([process.execPath, "build", ...])` in a test as a bundle, so it could migrate a module that bundle reads and the test then failed with `No matching export`. It now records that module as reached by the bundle. `--route-bundled-imports` is a new option that keeps such modules eligible: TypeScript that a test bundles names them through a package import of the committed emitted JavaScript, so an unchanged `Bun.build` or `bun build` works. This changes what a migration keeps as TypeScript where a test spawns `bun build`.
- The migrate flow's inventory did not see a tool's named glob, such as drizzle-kit's `schema: ["./src/**/*.sql.ts", "./src/**/sql.ts"]`, so it could migrate a module the tool selects by name and the tool then missed it. Those modules now stay `.ts`.

- Migrating JSX files could include previously excluded stories or omit explicitly included sources. Setup now preserves `include` and `exclude` membership with `.vibex` counterparts for `.tsx` selectors and `.vibe` counterparts for `.ts` and `.mts`.
- `vibelang --fix` read `input.arguments` in an `Effect.gen` or `Effect.fn` generator as the generator's own `arguments` and refused it; it now fixes it. Two reads it missed changed meaning: `{ arguments }`, and `self` in `Effect.gen(function* self() { … })`, which the fix left naming nothing. It now refuses both.
- `vibelang --fix` refused a `yield*` whose success is itself a program, such as `const stop = yield* listen()` followed by `Effect.addFinalizer(() => stop)`, though `try` runs one layer and the value stays a program. It now writes `const stop = try listen()`.

- A `.ts` function declared `@throws {Error}` could be passed where a callback type such as `() => void` was expected, as an argument, object member, spread member, initializer, array element or return value, with no diagnostic. It now reports `EK0402`; a `@throws` on the function type, a `@rethrows` parameter, `Array` iteration callbacks and the thunk of `Effect.try` and `tryPromise` still admit it.

- A declaration API checker killed by the system or by heap exhaustion left no result; the CLI now returns an explicit invalid receipt with the worker's exit status or signal, including when a worker exits successfully without a result.

- A declaration API comparison that overflowed the stack threw instead of returning a verdict; it now returns an explicit invalid result with its failed stage and memory use, and `--json` exits `2`.

- Comparing an exported API could fail solely because its declaration used an equivalent spelling. API comparisons now use complete declarations, preserve frozen package-alias resolution, and report the changed export with its `tsc` diagnostic.

- A plain function expected to return an Effect typed its body by the Effect's success, so `probe: () => Effect.succeed({ kind: "a" })` widened the literal and failed with TS2375 where the same TypeScript compiled; the body now gets the Effect as its contextual type.

| Before | After and repair |
| --- | --- |
| `when C(let x):` on a class without its own matcher | `EK0704`: `vibelang --fix` writes `when C and { … }:` for the written fields. |
- A class pattern over a value it could never test compiled and failed at run time: `when Point(let x):` on a class without its own matcher reports `EK0704`, and the quick fix and `vibelang --fix` write the bare class test with an object pattern. A callee whose return type fits no pattern, or with no call or construct signature, reports `EK0702`, and `when Function:` reports `EK0107`.
- Literal `__proto__` keys in patterns compiled despite the grammar restriction; they now report `EK0707`, while computed keys and binding shorthand remain valid.
- A finite match containing only a primitive constructor arm could compile as exhaustive; it now reports `EK4701` until literal, binding or `default` arms cover the remaining cases.

- A toolchain upgrade could accept a failed VIP migration after its partial edits made ordinary checks pass. It now stops before the candidate build and rejects failed or interrupted finishing receipts as later baselines.
- A pattern's optional property, `{ a?: 1 }`, and its member forms `this.#field` and `super.name` were syntax errors; they now compile as the pinned proposal says. A literal `__proto__` key and a rest pattern that is not last report `EK0707` instead of compiling or reporting `TS1005`.
- Schema fields without `readonly` incorrectly produced readonly keys, including nested object fields; they now produce writable keys, while explicit `readonly` and direct schema-error payload defaults keep their meaning. To retain older implicit readonly schema keys, run `vibelang -p tsconfig.json --fix --fix-migration-only`. The upgrade writes explicit `readonly` keys or preserves an explicit Effect codec when a source modifier cannot retain its decoded-key flags.

- Programs created or reconfigured through the compiler API lost parsed `vibe` settings, so severity overrides and disabled Effect globals or modules stopped applying; both API paths now retain those settings.

- The `Option.gen` quick fix could close iterators that native Effect leaves suspended on `None`; a delegated yield inside an active `for...of` body now keeps the diagnostic and explains why it needs a manual rewrite.

- `EK4402` told a `.vibe` file to use `NodeHttpServer.layer(createServer, { port })`, whose `createServer` it may not import; `ExperimentalNodeHttpServer.layer({ port })` now supplies it, `EK4402` names it, and the HTTP guide no longer needs a `.ts` companion file.

- An animation frame timestamp earlier than its starting clock produced a negative delta; `Experimental.Animations.frameDeltas` now clamps negative deltas to zero.

- A service-default editor repair could rename the declaration while leaving aliased, parenthesized, union-indexed or instantiated type reads broken; it now retains `EK4855` with a manual-repair explanation and offers no partial edit.
- `new f()` on a function declared in a `.vibe` file reported the retired `EK1020` and hid TypeScript's errors. It now uses TypeScript's constructor checks alone, including assertions and `@ts-ignore`.

- Tree-sitter showed a JSX member tag such as `<catch.Box/>` in a `.vibex` file as a syntax error; member tag names now follow JSX while keywords stay reserved in ordinary code.

- `.vibex` files lacked editor syntax highlighting and filetype associations; VS Code and Cursor now use a TSX-derived grammar with VibeLang forms inside JSX containers, and Neovim and Zed select JSX-aware highlighting.

- The ast-grep library and npm package kept only the original parser, omitting additional registered grammars; builds now include every parser in `tree-sitter.json`, and migration registers the `.vibex` parser when the installed compiler supplies it, with JSX-only rules kept on the JSX parser.

- After migrating a local Oxlint JS plugin, lint reached ESLint and failed with `ERR_UNKNOWN_FILE_EXTENSION ".vibe"` because only Oxlint preloaded the loader; setup now registers `vibelang/register` in each generated ESLint command too, including on repeated setup.

- The specification still listed `EK2007` for a legacy `for...of` or `for await` over a `Stream`, though the compiler keeps those loops native and reports `EK0102` for a `for await` in effect code; the specification and the diagnostic registry no longer list it.
- The editor declined to convert an `async` function returning a fresh object with an explicit noncallable `then` data property, such as `{ then: 7 }`; it now offers that conversion.
- An exhaustive match after an unconditional `return` reported missing cases and rejected a bound variant field; it now retains its coverage and binding types without changing reachability.
- Complete matches over members sharing a tag, or a member with several literal tags, reported `EK4701`; coverage now counts each member and tag case while retaining missing payload and optional-tag checks.
- In `(a catch h) catch k`, when `h` gave an Effect, the outer `catch` kept that Effect as a value instead of running it, so `Effect.fail(0) catch (() => Effect.fail(1)) catch () => 7` succeeded with an unrun Effect; the outer `catch` now runs what the inner one gives and the result is `7`.
- A Vite app whose workspace dependency started a worker failed to parse the worker’s `.vibe` imports. Migration setup now follows local dependency chains and adds `vibelang()` to the app’s `worker.plugins` factory.
- A shared package-release helper using arrow functions to map import conditions crashed on migrated targets with `value.replace is not a function`. Setup now recognizes these mappers and preserves the helper’s JavaScript and declaration paths.
- Migrating a returned `Effect.callback<A, Error>(...).pipe(...)`, such as Foldkit’s WebSocket acquisition with timeout handling, failed the style gate despite keeping its original error channel; the flow now proves channel-preserving pipe stages while still refusing discarded, nested, async, generator and changed-channel results.
- An optional tuple element in the error or requirement slot of an Effect type, such as `number!([string, boolean?])`, parsed wrongly and declared a malformed tuple; it now declares the same tuple as `Effect.Effect<number, [string, boolean?]>`.
- Build entry globs could emit empty chunks from generated `.d.vibe.ts` files beside the source outputs; the Rolldown plugin now excludes those sidecars from single, array and named entries, including `tsdown` builds.
- Knip could hide an unused export when an ordinary comment followed `@public`; the adapter now preserves that comment and Knip applies the same attachment rules as for TypeScript.
- Knip marked later names in a `@public` variable declaration as unused; all bindings in that declaration now keep the marker.

- Plain error getters and methods whose computed name is a branded `"_tag"` could bypass the reserved tag check. They now receive `EK2117`, including literal template and string mapping variants. The class repair preserves compatible branded members and leaves native-resolved instance tag accessors and methods for manual repair instead of introducing TypeScript errors. Fieldless repairs also preserve their constructor declarations.

- Initialized `_tag` fields, accessors and static members in an `error` or `schema error` could compile or report duplicate or unrelated diagnostics; they now report `EK2117`, and `--fix` retains previously valid implementations in explicit Effect classes.
- A typed `_tag` field in an `error` or `schema error` could override the generated tag contract or report unrelated TypeScript errors; it now reports `EK2117` at the field name, and `vibelang --fix` retains compatible contracts and schema-family registration in an explicit class.

- Formatting service and error declarations with comma separators could report overlapping edits; each separator is now projected once, preserving adjacent comments.

- Invalid TypeScript `module` forms reported broad or misleading errors. They now report the specific `EK4001`–`EK4004`, `EK4006` or `EK4008` diagnostic; TypeScript namespace spellings keep `TS1540` alone (VIP-40).
- The editor refused renames and import organization in files with TypeScript `module` bodies. These operations now work across the body boundary and preserve identifier specifiers (VIP-40).
- Published declaration checks rejected harmless formatting, quote, import-order and member-order differences; `scripts/api-identity.mjs` now compares exported names, their types through `tsc`, and their doc comments.
- Writing a separately documented `type X = typeof X.Type` beside `schema X` reported a duplicate type; one exact, nongeneric alias now replaces the generated type in either source order, keeping each declaration's documentation and exports (VIP-15, VIP-27, foldkit-9).

- JSX source files did not activate or reach VibeLang's VS Code language server as `.vibex` documents; the `vibex` language mode now selects the JSX parser and provides component and prop completions, hovers, diagnostics, definitions and paired-tag rename.

- Invalid `for concurrent` limits could produce a TypeScript argument error or pass unchecked; they now report `EK1907` consistently.

- Producers rejected valid `Stream` contracts; written `Stream` aliases now compile with their yield, error and requirement channels checked. Compatible broad annotations follow TypeScript's return checking, and incompatible contracts report `EK2102`.
- ESLint could not parse JSX in `.vibex` files; JSX now uses TypeScript-compatible trees, tokens and scope analysis, React and Solid rules run on the source, and lint setup and Knip include `.vibex` files.
- In the editor, an `is` that binds names and has a parenthesized subject, such as `(x as T) is [let a]` or `([3, r] as const) is [let n, let e]`, made the TypeScript 7 mapper report "invalid or overlapping edits" and pass the whole file through unchanged, so the editor checked VibeLang syntax as TypeScript; the file now maps as it does without the parentheses.
- Migration returned converted services to TypeScript when every member kept the original service requirement. Verification now accepts the `EK4809` design warning and preserves those member contracts; a configured `EK4809` error still fails.

- After VIP-1, `vibelang --fix --fix-vip-only` could not see that a method of a service read as `const fs = FileSystem.FileSystem()` ran where it stood, so it refused the whole file's migration (`EK9202`) and left functions such as foldkit's `readLiveRecordFile` plain, building their reads at the call and skipping their later steps; it now writes `try FileSystem.FileSystem` and runs each such method with `try`.
- A `match` whose last arm lacked its `;` beside a `do` could crash the compiler (`slice bounds out of range`) instead of reporting `EK0701`; a lowered `do` temporary no longer gets a range that ends before it starts.
- A native build or copy could replace a working compiler with a file that could not execute, even though the writer reported success; publication now requires a nonempty regular executable and preserves the previous binary on failure.

- Computed fields in `error` and `schema error` declarations were treated as uninitialized class properties; they now become readonly constructor fields, including symbol keys. Computed `_tag` overrides still report `EK2117`.
- A misspelled snippet-page filter or an empty documentation root could return success for zero pages and replace earlier receipts; both snippet commands now exit `2` before setup or writes when no Markdown page is selected.
- The match examples for schema guards and extractor counts failed in the Effect runner with `Not a valid effect`; their entry points now explicitly return Effects.
- Verifying a migrated package could reject the flow's new `.npmignore` and packing receipt as foreign files when its first emit happened after codemod. Packing ownership now stays in the batch journal through verification, recording and revert; unrelated files still fail the scope check.

- Moving a checkout with a committed loader record changed ordinary string values containing the old checkout path; records now relocate only structured file paths and source-map sources, preserving the emitted program bytes.

- Migration setup rejected an emitting project built by bare `vibelang -b` or `vibelang --build`; it now recognizes their default `tsconfig.json` while still refusing unrelated projects.
- Migration setup rejected projects containing `.d.vibe.ts` sidecars because those files emit no JavaScript; it now excludes declaration inputs and preserves them unchanged.

- A misspelled compiler-case option, such as `--isolatd`, was silently ignored and could erase the original case output; unknown switches now exit with status `2` before running a case or changing its files.
- Browser and signal examples rejected the runtime's Effect `4.1.1` after the upgrade; their package pins now match the runtime.

- A `.vibe` file that read `window.crossOriginIsolated` or `navigator.userAgent` got `EK4402` with no service to use; `Experimental.BrowserInfo` now reads them, `EK4402` names it, and `ExperimentalBrowserServices.layer` provides it.

- The fibers guide suggested Effect-body repairs inside ordinary async functions; it now shows `runPromise` bridges that run in the original Promise context.
- Only the first `catch` outside effect code in a file reported `EK0504` and `EK0509`; every later one went unreported, and `vibelang --fix` had no repair for its value fallback. Every catch is now checked.
- Awaiting a Promise, Effect or ordinary value inside effect code could report a retired await diagnostic; every operand now reports the assigned placement error `EK0102`, while native `async` awaiting keeps its behavior.

- The `EK0509` repair of an object-literal value fallback, `x catch { directory }`, wrote `() => { directory }`, a block that returns nothing, and refused with `TS2322`; it now writes `() => ({ directory })`.
- After VIP-1, `vibelang --fix --fix-vip-only` left a call that ran inside a catch's head cold, as in `decode(fs.readFileString(path)) catch …` (`TS2375`, `EK9202`); it now writes the head as the program it was, `(effect { return decode(try fs.readFileString(path)) }) catch …`.
- A migrated package whose `files` list shipped only `dist` could install with an export pointing at missing `.vibelang/js/` JavaScript and fail with `ERR_MODULE_NOT_FOUND`. The migrate flow now includes the emitted runtime and loader records in its packing policy while preserving private-file exclusions.
- The native resource example in the denied `using` proposal omitted acquisition and disposal from its Effect TypeScript counterpart; it now keeps the native `using` declaration in the outer generator.

- `vibelang --fix-vip-only` refused a function that called a method on a legacy service call and used the result, such as `const digest = (Hasher()).digest(input)` before `digest.slice(…)`: it wrote `(try Hasher)` but no `try` for the method's Effect, so the file's other `try`s were refused too and `EK4802` became an error. It now writes `try (try Hasher).digest(input)`, as the old compiler ran it.
- `vibelang --fix-vip-only` refused `fork(call(n), { startImmediately: true })` in a function it marks `effect`: `fork` is reserved there, so the text read as `fork` over a comma expression, `EK1703`, and every `try` in the file was refused. It now writes `try Effect.forkChild(call(n), { startImmediately: true })`, the Effect form `fork` stands for, which takes the options.
- `vibelang --fix-vip-only` refused a call that ran inside an argument passed by name when that argument also held a plain function, such as `failureOf(toCommandSchema(ref, sync(() => Schema.suspend(() => { throw e }))))`, and made `EK4802` an error. It now writes the effect block, `failureOf(effect { return try toCommandSchema(ref, try sync(…)) })`. It still refuses when the written function's own body holds a `try` or a call that gives an Effect.
- `vibelang --fix-vip-only` refused a file with a literal handler that gives a plain value where the parameter expects a function that returns an Effect, such as `(caught) => caught.message` passed to `Effect.catchTag`: the handler stayed plain, a `TS2769`. It now writes `effect (caught) => caught.message`, so the value is the handler's success, as it was before VIP-1.
- Class-only modifiers on schema fields were silently ignored; they now report `TS1070`, and `vibelang --fix` removes the ignored tokens without changing the codec.

- A guarded `do` body such as `x !== undefined && do { x.length }` could report that `x` was possibly `undefined`; `&&`, `||` and `??` now retain the source guard’s TypeScript narrowing, evaluate the left operand once and still invalidate narrowing after an assignment.
- A `.vibex` file (VIP-39: VibeLang with JSX) failed with `TS6054`; the compiler now reads it as VibeLang parsed as `.tsx`, so JSX and VibeLang forms mix in one file. Imports of `.vibex` modules, editors and bundlers follow in later VIP-39 slices.

- The migrate flow wrote each package's loader record right after emitting and routing that package, so a later package's routing changed a `package.json` an earlier record named, and that record missed on every cold start (opencode's `ai` package, 76 `.vibe` modules, after `schema` was routed). The flow now writes every record after all packages are emitted and routed, then checks each against the final tree with the new `checkLoaderRecord` in `vibelang/project`, and the emit receipt names any record that misses.
- Declaration parity checks could report success and overwrite prior receipts when a selector matched no cases; they now reject empty or unmatched declaration selections before setup.
- Concurrent migration batches could restore another package's files to their old bytes after it reported successful fixes; restoration now stays inside each compiler source graph, and overlapping graphs take turns.
- A `private` or `protected` member named like a member of the error base, such as `private message: string`, in an `error` or `schema error` body reported TypeScript's `TS2415` at the declaration's name beside `EK1304`. It now reports `EK1304` alone.

- Declaration parity checks discarded named local export aliases and could report renamed public exports as identical; they now compare those exports alongside their declarations, including names that coincide with imported bindings.

- Migrating an Effect pipeline could change its public declaration from an expanded intersection to a named alias, as in opencode's reconnect service; the quick fix now keeps the native `.pipe(...)` when uncurrying a stage would change inferred type names.
- After VIP-1, a `catch` passed where an Effect is expected, as in `FiberMap.run(map, key, (effect { … }) catch effect (e) => …)`, ran instead of being passed, and `vibelang --fix --fix-vip-only` left it; the migration now writes it as `effect { return … catch … }`, the program the old compiler passed.

- Adjacent `data` variants and payload fields reported a TypeScript semicolon error. They now report `EK1605` and offer a quick fix to insert `;`.
- An arm that used `not`, or `and` with two tests, counted toward exhaustiveness, so `match (x) { when true and true: 1; when false: 0; }` compiled; such an arm now covers nothing, and the match needs another arm or a `default` (`EK4701`).
- The migrate flow could not load from a staged copy of `.smithers`, as a toolchain build stages it: `source-paths.mjs` imported `minimatch` from `node_modules`. The flow now ships minimatch in `lib/vendor/`.
- The migrate flow's `verify` failed a batch when the flow had just written a loader record (`.vibelang/js/.loader/`), calling that record a foreign file; the flow now treats everything under `.vibelang/js/` as its own output.
- The migration codemod rewrote a migrated module's written `./c.js` or `./e` import of a module that stays TypeScript to `./c.ts` or `./e.ts`, so the package's published `.d.ts` no longer matched the original (18 of foldkit's 225 declarations); it now keeps every written specifier of an unchanged module and rewrites only a renamed module's name to `.vibe` (decided detail 272).
- `vibelang --fix` removed an `effect` import that the module's declaration needed, because the prelude supplies the name, so a published declaration changed: imports moved, and an inferred `Schema.String` became an `import("effect/Schema")` type (Smithers: 9 modules). `--fix` now keeps such an import in its place, under every compiler option, and still removes one the declaration is the same bytes without, such as `import { Option } from "effect"` beside `Option.Option<number>`.
- A `do` in a destructuring assignment default, computed key or target could run before the right side, even when a supplied value skipped the default; assignments now preserve native destructuring order and run defaults only when needed.
- After VIP-1, `vibelang --fix --fix-vip-only` left three pre-VIP-1 forms failing: an arrow such as `(text: string): number!! => parse(text) catch () => 0` (`EK0504`), a `catch` in a plain factory or at the top level (`EK0504`), and a function literal passed as a program, such as `forkIn(scope, () => work())` (`TS2345`). It now marks the arrow `effect`, writes the plain `catch` as `effect { return … catch … }`, and writes the literal as `effect { return try work() }`.
- A `match` with an arm `[]` beside a `do` arm ending in an array, such as `when Option.None: []; when Option.Some(let link): do { …; [href, text] }`, failed with `TS7034` and `TS7005` on a generated `$do` variable, and so did `[]` in a property written before a `do`, as in `({ undoStack: [], grid: match (…) { … } })`; the `[]` is now an empty array literal, typed as it is written in place.
- A branded string wrapped in a template key or a string mapping could bypass the `_tag` check on a `schema error` method or getter and make construction throw; it now reports `EK2117` when the runtime key may be `"_tag"`, and `--fix` keeps the explicit class without cycling back to the rejected declaration.

- Migrating an already routed package could replace a nested `types.default` declaration path with runtime JavaScript, hiding its API types; `types` and `typings` now keep declaration paths through nested conditions and fallback arrays.
- Renaming a source to `.vibe` left a literal Vite build entry pointing at the missing `.ts` file, so a compiler-clean migration could not bundle; the migrate flow now follows library, Rollup, Rolldown and pack entries to the renamed source, records them for `revert` and interrupted-run recovery, and warns about computed paths it cannot rewrite.
- After the migrate flow renamed an entry point such as `scripts/generate.ts` to `.vibe`, package scripts still ran `node --import vibelang/register scripts/generate.ts` and failed with `ERR_MODULE_NOT_FOUND`. The codemod now points each script at the `.vibe` file, and `step revert` points it back.
- A `do` expression in a dynamic `import()` argument could emit invalid JavaScript by capturing `import` as a value; dynamic imports now keep their native syntax and evaluate the specifier and options in source order. Computed `super` references also keep their native syntax. With TypeScript checking disabled, `delete` of a `do` result emits valid JavaScript.
- Migration could widen a shared file-selection regex and change an unchanged assertion’s result; the codemod and `verifyTestDiff` now refuse named regexes with any assertion or other use not proven to select filenames (decided detail `272`, `RD-022`).
- Under Vitest with the Vite plugin, a `.vibe` module's dependency loaded through its package's `module` export, which is often bundler-only ESM, so Node failed with `Cannot find module` or `Directory import … is not supported` (Smithers: `@opentelemetry/api`, 64 tests in 5 packages). The plugin no longer adds `module` to Vitest's conditions; Node loads the dependency through its `default` export, as without the plugin.
- Renaming a module that called a native helper returning an Effect added an `Effect` import and changed its public declaration; an unmarked function now keeps TypeScript's inferred `import("effect/Effect").Effect<…>` spelling.
- An `is` whose pattern both tests and binds a nested part of its subject, such as `reasons is [{ _tag: "Fail", error: Oops and let error }]` or `x is { inner: { key: let key } }`, did not compile (`TS2552: Cannot find name '$match6'`), and its JavaScript assigned an undeclared name, so it threw a `ReferenceError` instead of matching. The compiler now reads that part through one name, and the `is` matches as the same pattern in a `match` does.
- Async conversion could change how a JavaScript `try` statement handles rejection or leave a `using` resource undisposed; the editor now leaves these bodies for an explicit handler and cleanup rewrite.

- The `using` warning cited a denied proposal as its authority; it now cites the accepted VIP-34 amendment while keeping its code and behavior.
- VIP-39 examples with published prerequisites looked like current-language failures; they now name the pending file-kind diagnostic, and stale markers fail when support arrives.
- Deliberately rejected VIP examples named no diagnostic, and a matching code elsewhere could satisfy a check; examples now state their codes and inline checks require the marked source line.
- A documentation snippet timeout could leave compiler or test-runner children holding its output pipes open; on POSIX it now stops the owned process group and reports the timeout even when the parent has already exited.
- The mapper runtime-parity command printed `FAIL` rows but still exited successfully; it now exits with status `1` whenever a selected case fails.
- A mapper runtime-parity case could pass after printing the expected value even when its process then failed or was killed; it now requires a successful exit and retains the exit cause with the actual result.
- A mapper parity compile or runtime command could outlive its deadline when a descendant held its output pipes, and a parent that exited first could be reported as successful. On POSIX, both parity columns now stop their owned process group at the deadline and report the timeout after draining its output.

- Runtime parity could report a passing result after stock TypeScript rejected a source file, because the failed compile still emitted JavaScript. It now stops before executing that output and reports the compiler's exit status and first diagnostic.

- Runtime parity could not run entry files whose names contained `#`, `?`, percent escapes or a quote; generated imports now preserve the literal emitted filename.

- Runtime parity overwrote an emitted dependency named `run.mjs` with its test runner, causing missing-export errors in valid programs; the runner now lives in a separate directory and preserves compiler output.

- The mapper runtime-parity command succeeded after a misspelled selector ran no cases; an empty selection now exits with status `2` and names the requested selectors.

- Mapper parity reported clean documentation measurements when `--jobs 0` skipped every compiler project; invalid worker counts now exit with status `2` before changing outputs or prior receipts.

| Before | After and repair |
| --- | --- |
| `for try` over an object exposing only the Stream type marker | Supply a complete `Stream.Stream<A, E, R>` implementation. A marker alone now reports `EK2004`; no automatic conversion can supply the missing Stream behavior. |
- `for try` rejected `any`, `never` and constrained Stream operands, while accepting objects with only a Stream type marker; it now checks assignability to `Stream.Stream<any, any, any>` and preserves constrained element types.

- An `is` pattern binding whose name began with `$`, such as `let $id`, could report a missing internal name; source binding names now remain distinct from compiler-generated temporaries, including `const` bindings and escaped identifiers.
- A `var` binding in a match pattern could compile without an error, and an `is` binding could crash the compiler; both now report `EK0107`, with a quick fix and `vibelang --fix` repair to `let`.
- Hovers and offered type edits could print ambiguous `Effect` contracts for union or intersection channels; they now retain the parentheses those channels require.

- An unparenthesized union, intersection or conditional type beside `!` was silently accepted; it now reports `EK0301`, including with `--noCheck`, and `vibelang --fix` inserts parentheses while preserving the existing channels.
- Converting an `async` function could return a boxed object where native async returned its adopted value, even with a primitive return type; conversion now adopts the completed return after body and iterator cleanup, preserving the value and evaluation order.

- A function ending in `return try value` could reject unchecked iterables and skip iterator getters, including a getter on an `Effect`; tail `try` now keeps native delegation, defect identity and evaluation order.
- A `restore` in a computed object or class method name, or a class's `extends` expression, incorrectly reported `EK2202`; it now uses the enclosing activation's mask.

- The specification listed `EK0204`, a compiler limitation, among the language rules; it now lists it under transitional compiler diagnostics, and the spec linter prevents compiler gaps from entering the normative table.

- Converting an old `async` shorthand named `functionality` could leave an invalid declaration. The editor now inserts `function` for every shorthand name.

- Converting an `async function*` could produce `EK2128` for a return value or change a yielded `Promise` into data. The conversion refactors now apply to ordinary `async` functions.

- Pattern expressions such as `effect is (Number)` and `async is (String)` could report a missing `function` and unrelated signature errors; they now parse as pattern expressions in statements.

- Applying `--fix` or the editor's `EK4843` repair to an exported `const main` or `let main` could hoist it and change a read before initialization from `ReferenceError` to a function. The obsolete entry warning and repair are retired under VIP-26; lexical declarations retain their temporal dead zone and runners remain explicit.

- Spellings of `effect` with Unicode escapes were accepted as function modifiers and blocks; they now report `TS1260`, matching `async`, and the editor quick fix or `vibelang --fix` writes the literal keyword. Ordinary escaped identifiers remain valid.

- Release checks failed with `ERR_UNKNOWN_FILE_EXTENSION ".vibe"` when a registered Node parent launched typed source through `execFile` or `execFileSync`; migration setup now gives those children their own loader preload, preserving arguments, process options and callbacks.

- The module-body mapping specification required `.ts` even for JSX bodies; it now requires `.tsx` for bodies in `.vibex`, preserving the source language variant required by the extraction rule.

- The Welcome page's TypeScript comparison printed nothing when copied and run; it now runs its Effect and prints the same greeting as the VibeLang example.

- Vue and Svelte setup guides replaced their component type checkers and claimed VibeLang imports could not be checked; they now run the native compiler first, then retain component checks through declaration sidecars.

- The migrate flow's codemod left a test that lists a directory and filters it with an extension regex, such as t3code's React Compiler coverage and dependency-graph tests (`/\.tsx?$/.test(file)`), selecting only `.ts` files, so each migrated module silently dropped out of the check (318 t3code web and mobile modules stayed TypeScript); it now widens that one regex to `/(?<!\.d\.vibe)\.(?:tsx?|vibe)$/`, which selects `.vibe` modules and not their `x.d.vibe.ts` sidecars, when the selected files are the same by base name, and `verify` accepts only that widening.
- The migrate flow's platform split took a type for a value of the same name, so in t3code Desktop's `MacSettingsWindow.ts` (`const Shape = Schema.String` with `type Shape = typeof Shape.Type`) the sibling imported `Shape` as a type and used it as a value (`TS2693`, `TS2345`); the split now takes the value and, since the module's declaration would change, keeps the module's platform code with a named cause.- With `stripInternal`, an `@internal` schema lost both its constant and type alias from declarations; it now drops only the constant, matching the equivalent Effect TypeScript pair.
- `vibelang --fix --fix-vip-only` left a function unmarked when the old compiler made it an Effect function only because a program captured it, as in `Effect.runSync(job)` or `Effect.all([job])`, so the migrated file failed with `TS2345` after the upgrade to VIP-1. The migration now marks such a function `effect`.
- Under `bun --preload vibelang/bun`, `require()` of a TypeScript module that reaches a `.vibe` module through an extensionless or `paths` alias import threw `require() async module ... is unsupported`, as when opencode's plugin loader required a barrel whose schema modules became `.vibe`: the preload rewrote those imports with `Bun.build`, so the module loaded asynchronously. The preload now rewrites them synchronously in the module's source, and `require()` loads the module wherever it loads the module's `.ts` twin. It now also finds a dynamic import with a non-ASCII specifier, such as `import("./leaf-雪")`, and follows `Bun.resolveSync(path, directory)` from that directory, not its parent. A migrated package's emitted `.vibelang/js` file re-exports its native source by an absolute path; the preload now loads that source itself, so a plugin that rewrites the files it sees by absolute path, such as OpenTUI's runtime plugin in opencode's TUI, no longer makes `require()` of the package async.

- Converting an `Effect.fn` generator could change its declaration parameter spelling, such as `readonly string[]` becoming `ReadonlyArray<string>`; the repair now preserves inferred parameter types, generic arrays and optional callback return types.
- A closure created in a `do` expression in a `for…in` or `for…of` head could read an outer variable; it now keeps the head's uninitialized `let` or `const` binding, separately from each iteration's binding.
- Formatting a `do` expression could fail when dprint inserted an ASI semicolon before its value; the formatter now accepts the empty statement and preserves the block's value.
- The migrate flow's codemod gave a migrated module's `paths` alias to a module that stays TypeScript a `.ts` extension, `~/state/filesystem` becoming `~/state/filesystem.ts`, which the compiler rejects (`TS2877`) under `rewriteRelativeImportExtensions`, so 23 of t3code's 160 web modules went back to TypeScript; the alias now keeps its authored spelling.- With `stripInternal`, an `@internal` schema lost both its constant and type alias from declarations; it now drops only the constant, matching the equivalent Effect TypeScript pair.
- The migrate flow could turn value-only TypeScript helpers, including schema factories, into Effect-returning functions on a legacy compiler; it now preserves their plain declarations before the fix gate and probes the compiler so it never writes legacy annotations after VIP-1.- With `stripInternal`, an `@internal` schema lost both its constant and type alias from declarations; it now drops only the constant, matching the equivalent Effect TypeScript pair.
- A `.vibe` module whose inferred type names a dependency’s internal type, such as `Tabs.create()` from `@foldkit/ui`, failed with `TS2883` when a `.ts` file imported it, even in a project that emits no declarations. Such a project publishes nothing, so its sidecar now names the exact type through its path into `node_modules` and the module compiles; projects that emit declarations still report `TS2883`.
- A migrate flow codemod whose compiler was killed said only `exit 128`, and nothing listed which earlier batch's `.vibe` modules it had put back; the error and the compiler log now name the signal (a timeout still reads `timed out, exit 124`), and `codemod.json` lists the restored modules in `fix.restored`.
- Inferred Effect default properties rejected declarations that already matched their native TypeScript counterpart; they now require raw declaration identity for every previously reported form.
- Signed-zero patterns could call a local `Object.is`, producing incorrect matches or type errors; they now distinguish `-0` and `+0` independently of local `Object` bindings.
- The array literal of `try.all`, `try.race`, `try.any` or `try.allSettled` deferred an element whose argument runs an Effect, such as `try.all [a(try b()), a(1)]`, in `Effect.suspend`, so the literal was not built in element order; every element call now gives its Effect while the literal is built, natively and in element order, with a spread iterated once, as `Effect.all([a(...), ...xs, b()])` builds it (chapter 2, decided detail 252).
- Formatting could remove parentheses inside computed error payload and type-member keys, changing native diagnostics or refusing a return type; those key expressions now keep their written grouping and comments.
- A malformed response could crash the LSP benchmark and leave its compiler server running; it now reports the request and protocol stage, then terminates and reaps the server.
- Documentation hover generation could hang after its language server closed its response stream or sent malformed data; pending requests now fail with their method and protocol stage, allowing server and temporary-project cleanup to finish.
- A plain `catch` handler whose result is a Promise or thenable, such as `x catch (e) => queryDb(e)`, compiled without a diagnostic, so the fallback was a Promise nothing ran; it is now error `EK0507`, and its note points to an effect handler that runs it: `x catch effect (e) => try Effect.promise(() => queryDb(e))`.

- The mapper hover check could leave its language server running after a successful check, a rejected request or a malformed reply. It now shares the mapper test transport and waits for its owned server to exit, escalating termination if necessary.
- With `import { Effect } from "effect"` in a `.vibe` file, `Effect.Array.head([1])` compiled as if `Effect` were the implicit binding; a written `Effect` binding now keeps its ordinary TypeScript meaning, so that read reports `TS2339`, while the implicit `Effect.Array` and `typeof Effect.Array` still resolve (VIP-14).
- Editor projection could erase `effect` from a pure class method or a named function with an aliased return type; both now keep their Effect bodies, including imported aliases.
- A schema field initializer was silently discarded; it now reports `TS1247`, and `vibelang --fix` removes the ignored expression while keeping its codec, modifiers and comments.
- A `match` over `void` incorrectly required a fallback, while a finite generic constraint could miss an arm without an error; `EK4701` now follows the constraint's finite cases and leaves open subjects unchecked.
- The `EK4855` repair renamed a service `static readonly default` to `defaultValue` and rewrote its value reads, but left type reads such as `typeof Flags.default` and `(typeof Flags)["default"]`, so the repaired file failed with `TS2339`; the declaration now carries one `EK4855` whose fix rewrites every read in the file, type reads as `ReturnType<typeof Flags.defaultValue>`, and a read in another file keeps its own warning and fix.
- A `break` or `continue` in a loop head's `do` could bypass `EK0205` by naming an outer label in a chain on the same loop; every label in that chain now gets the early error, while jumps to a different enclosing loop remain exempt.
- In a project that emits declarations, `vibelang --fix` rewrote `Effect.fn("name")(function* … )` or `Effect.gen` and then removed the now unused `import * as Effect from "effect/Effect"`, so the declaration file imported `{ Effect } from "effect"` instead and the migrate flow's declaration identity gate refused the file. `--fix` now keeps an effect import that the file's declaration file writes, as its prelude rewrites already did.
- A local `break` from `finally` in a `do` expression could retain the `try` or `catch` value. It now carries the finalizer's completion value, including `undefined` for an empty abrupt completion; a normal finalizer preserves the protected value.
- Producers could leak a `Scope` requirement from unions, aliases or structural subtypes; their inferred `Stream` now excludes `Scope` from the complete requirement type, including generics.
- Large `--fix` rounds could stop without saving progress. The fixer now saves verified checkpoints and bounds refusal isolation, so an interrupted run keeps its verified changes.
- The migrate flow's platform split left a module's file-wide directives, such as t3code Desktop's `// @effect-diagnostics nodeBuiltinImport:off`, on the `.vibe` module only, so the `<Name>.platform.ts` sibling that now held the `node:child_process` import reported `EK3877` and the module went back to TypeScript; the sibling now starts with the same directives.
- Loading VibeLang with `effect@4.1.1` failed its version check; the runtime, compiler and starters now require `4.1.1`, and the six `effect/jose` namespaces are available without imports.
- With `stripInternal`, an `@internal` schema lost both its constant and type alias from declarations; it now drops only the constant, matching the equivalent Effect TypeScript pair.
- An `effect` body that ran an Effect failing with `Error | ApiError` and threw an `Error` subclass declared its error channel as `Error`, so a `catch` arm on `ApiError`'s tag failed with `TS2339`; it now declares `Error | ApiError`, as `Effect.gen` infers.
- VIP-25 said inline TypeScript modules were pointless because plain `.vibe` functions have TypeScript's meaning, which Will's 2026-10-31 ruling that plain VibeLang code cannot `throw` made false; a dated amendment now says so, and the denial stands.
- VIP-39 said `App.vibe` beside `App.vibex` always collide with `TS5055`/`TS5056`, though under `"jsx": "preserve"` with declarations off they write `App.js` and `App.jsx`; it now says the pair collides only where both write the same output path, as `App.ts` beside `App.tsx` does.
- VIP-8's Effect TypeScript counterpart dropped the source's `using f = openFile(p)`, so it neither opened nor disposed the file; it now keeps the declaration in the outer generator, as TypeScript's `using` does.
- VIP-33's opening example provided `NodeServices.layer` at a module's top level with no import, a program the spec rejects (`EK1201`, `EK0501`, `TS2304`), and VIP-26's used `NodeRuntime` with no import; both now import the platform package, and VIP-33 provides the layer inside `effect function main()`, as chapter 5 does.
- VIP-1's written-return-type example used the bare type `Effect<User, NotFound, Users>`, which is not a VibeLang form; it now writes `User!NotFound!Users`, as chapter 1 does.
- VIP-5's opening example still used the removed value handler `fetchUser(id) catch guest`, which no longer parses; it now writes `catch () => guest`.
- The specification's `EK1101` trigger, "a `{` on the same line after a name, a property access or a call", read as covering `effect { … }`, `match (x) { … }` and declaration heads, and Appendix C gave the trailing-block denial two repairs where `EK1101` has three; the trigger now excludes every `{` a production reads and Appendix C lists the same three repairs.
- A denied trailing block still became an implicit callback during parsing; ordinary compilation now leaves the call and block to TypeScript, while `EK1101`, `vibelang --fix` and editor quick fixes keep their existing messages and rewrites.

- The specification gave two different spellings for the `effect` import a declaration file adds, `import type { Effect, Stream }` and `import { Effect }`; it now uses the value import throughout, as the compiler and the Effect TypeScript twin's declaration write it.
- The specification omitted `.vibex` declaration imports; it now follows the `.tsx` twin, including `./x.vibex` becoming `./x.tsx`, independently of `jsx` and the retired `declarationImportStyle` setting.
- The specification left sidecar import spelling unclear; it now distinguishes package declarations, which follow the TypeScript twin, from source-binding `x.d.vibe.ts` sidecars, which keep `./b.vibe` bound to its source.
- The specification described unapproved configuration aliases and keys; chapter 7 and VIP-30 now agree that `declarationImportStyle` is retired with a warning at both legacy paths, and `//:spec-lint` rejects an active option no accepted VIP names.
- The specification said a relative `./x.ts` import reaches `x.vibe`, a resolution rule no proposal approved; chapter 7 no longer states it, the compiler still resolves such imports, and a new specification linter (`//:spec-lint`) rejects resolution claims VIP-39's table does not list.
- A `do` block ending with `var` compiled even though the pinned proposal rejects it; it now reports `EK0201`, including through empty statements and blocks. A later value expression still allows `var` to hoist.
- A read of `this` before a later `do` could move past `super()`, hiding a derived-constructor error; the read now stays in source order, preserving TypeScript’s diagnostic and native `ReferenceError`.
- Anonymous functions and classes captured around `do` could acquire private compiler names, and lifted object properties lost their source names; value-only positions now stay unnamed and property initializers keep their names before class static initialization.

- The migrate flow's declaration gate compared each batch with declarations vibelang emitted from the unchanged sources, so where vibelang emitted a module's declaration wrongly or not at all (alchemy's `Pipes/builders.d.ts`, `TS5088`), a batch that migrated that module passed as identical; setup now also emits the declarations with the repository's own `tsc`, `tsgo` or `tsrs`, and verify fails a batch that migrates a module whose native declaration differs from them.
- The migrate flow could record a conversion that marked a plain function `effect`, so the call returned a program instead of its value (alchemy's `effectClass` broke every `class X extends effectClass(…)`) while types and declarations stayed unchanged; `verify` now fails a batch whose `effect` function was plain in the original and returned a value or did work at the call.
- After switching to another VibeLang compiler with the same TypeScript version, an incremental or `--build` check reused the previous compiler's cached result, so it could exit 0 where a fresh check reports errors (foldkit: `EK4402` on `import.meta.hot`). Build info now records the compiler's build, and a different build checks the project again.
- Repeated `readonly` modifiers in schema fields were silently accepted; they now report `TS1030`, and `--fix` removes the duplicate without changing the codec.
- Helper re-export declaration properties required a manually configured compiler path; they now use the built checkout compiler by default and retain an explicit `VIBELANG_BINARY` override.
- Incremental diagnostic properties required a manually configured compiler path; they now use the built checkout compiler by default and retain an explicit `VIBELANG_BINARY` override.
- Incremental artifact identity properties required a manually configured compiler path; they now use the built checkout compiler by default and retain an explicit `VIBELANG_BINARY` override.
- Formatting service members or class-form `error` fields separated by commas could fail with an internal parse error; the formatter now accepts their separators and keeps nested type commas and comments intact.
- Checking an incomplete service in the editor, or with `noUnusedLocals` enabled, could panic; unsupported call and construct signatures now report `EK0902` while unused private implementation members are still checked.
- A resize observer could remain allocated when the browser rejected its first target; `Experimental.ResizeObserver` now disconnects it when the scope closes, including after setup fails.
- Waiting for a pending browser commit or animation frame required a plain host callback; `try (try Experimental.Animations.Animations).nextFrameUnless(register)` now checks and registers atomically inside a cold Effect, with cancellation on interruption (decided detail 261).
- Browser file reads could report an unexpected result exactly like a host error; `Experimental.FileReader` now identifies unexpected results with `InvalidData`, preserving the origin even when the cause and message coincide.
- A valid severity override could still fail compilation because an overridden base entry was invalid; only effective severity entries now report `EK3006`, and valid overrides allow emission again.
- With a repeated configuration key, an invalid-value error could underline the earlier valid value; it now points at the last value that the config uses.
- ESLint reported `no-constant-binary-expression` on a valid `is` pattern with bindings, such as `outcome is Exit.Failure(let cause)`; generated binding steps no longer look like constant expressions, and constants written in source still get the rule.
- Overlapping native builds could fail while writing the dprint plugin because they shared one temporary zip file; each build now prepares its own archive before publishing it.
- Tuple rest schemas rejected qualified or renamed library arrays and accepted local type shadows; they now resolve library bindings consistently, retain rename references, and offer a preserving `--fix` for old shadowed spellings.
- Readonly-record schemas rejected qualified or renamed library types and could accept shadowing types; both names now follow their library bindings, and `--fix` preserves previously accepted codecs.
- Renaming a type binding could leave its generic schema uses unchanged, selecting a different decoder; Rename and Find References now include those uses in their original type scope.
- Organizing imports deleted type-only schema bindings, producing or hiding `EK2109`; organize-imports and remove-unused actions now keep the necessary bindings and remove aliases unused in that scope.
- Renamed or qualified `Record` schema types were rejected with `EK2109`; they now use the resolved library record decoder and preserve writable decoded keys.
- Schema array types rejected renamed or qualified library types, and an imported `Array` could silently use the wrong mutability; they now select the codec from the resolved library binding and retain it when expanding a schema through a quick fix.
- A failed source setup could delete the previous local starter while copying or rewriting its replacement; setup now prepares the replacement first and restores the previous starter if publishing it fails.
- Nested objects and index signatures inside a `data` payload were made readonly implicitly; they now keep their written TypeScript mutability.
- A direct `schema error` payload reference could silently make a readonly key writable or a required key optional; incompatible decoded-key flags now report `EK2109`, and `vibelang --fix` preserves the existing codecs in an explicit Effect TypeScript class.
- A `yield` inside a producer's `for concurrent` body was rejected or omitted from its element type; item bodies now emit from and contribute their types to the enclosing producer.
- ESLint reported `no-unexpected-multiline` at a closing brace after some `is` patterns, such as `value is if (true)`; subject-capturing patterns now keep their own source form in ESTree, so generated matcher invocations produce no call warnings and written calls still report normally.
- Commas between payload fields in `error` and `schema error` bodies reported `EK1013`; they now separate readonly constructor fields, including optional fields and trailing commas.
- Tagged error patterns from nested Effect modules rejected independently branded errors; all thirty-three retained error patterns now use their module guards, including singleton extraction and failed arity mismatches.
- Reading a producer's `yield` result exposed a queue-offer boolean; a completed offer now gives `undefined`, as the language specifies.
- `vibelang --fix` refused old VibeLang's `x catch throw e`, as in Smithers' `FileRouter.vibe` `catch throw readFailure()`: the `EK0509` repair wrote `x catch effect () => try throw e`, which does not parse. It now writes `x catch effect () => throw e`, which fails with `e`, typed, as the old fallback did.

- Two members on the same line without a separator in `error`, `schema error` or `service` bodies produced unrelated TypeScript syntax errors; they now report `EK1306` or `EK0908` at the next member, with a quick fix that inserts `;` before its comments.
- Formatting JSDoc such as `@internal` on an empty statement could attach it to the following declaration or refuse the file; formatting now keeps the statement and its comment together.

- Formatting an `error` or `schema error` with empty `;` members could fail or move JSDoc to the next member; formatting now preserves the comment attachment and removes only empty members with no attached JSDoc.

- Migration setup could leave a native type exported through a TypeScript namespace barrel as an error type in project-aware linters; setup now enables source declaration redirects in owned configs and records those edits.
- A package built with `tsdown` could fail to parse migrated sources because setup omitted its plugin; setup now wires every static config and local config factory, and installs the plugin in the owning package.
- A migration batch could commit an earlier batch's module or an unrelated test that a fix rewrote. Verification and recording now reject files outside the batch and its recorded codemod edits.
- Migrating a package with wildcard exports could add a new public `.platform` module, as Alchemy's AWS platform splits did; the flow now refuses that split before writing files, and the declaration gate rejects new published `.d.ts` files.
- A `service` method with no return type reported `EK9205` even with `noImplicitAny` off, and `read(): any` was rejected; an omitted member type now follows TypeScript as in an interface (`TS7010` for a method and `TS7008` for a property under `noImplicitAny`, `any` otherwise), and VibeLang adds no diagnostic of its own (VIP-9 amended).

- Programmatic Rolldown builds and exported plugin sets could not bundle migrated modules, including Alchemy's lazy bundles and framework adapters; setup now wires the native plugin into supported calls and typed plugin factories, preserves test-pinned plugin positions, and installs runtime dependencies for published code.
- A held union of Effects could be rejected even though every alternative was an Effect; `try` now accepts it and preserves every success, error and requirement type.
- A catch-handler quick fix could remove `async` or `*` and leave invalid `await`, `yield` or result types; it now declines those repairs and explains the required explicit rewrite.
- The install site named an unpublished compiler version and native Windows packages; it now uses npm’s published version and platforms, with WSL guidance until Windows packages are published.
- Migration could leave `.ts` build entries pointing at renamed files when a configuration was outside `src`; batched codemods now wire owned configurations and retain that wiring on resume and revert.
- Unparenthesized execution expressions before `**` reported a native TypeScript diagnostic; they now report `EK0510` with an editor action and a preserving `vibelang --fix` repair to add parentheses.
- The migrate flow could borrow a callback's `Error` channel from an `async` function or generator, even though that function returns a `Promise` or iterator containing the Effect; only a plain function returning the Effect directly now supplies that proof.
- A plain function's `for…of` combined a body error with an error from the iterator's `return`, changing the caught value; it now keeps the original thrown value by identity, as TypeScript does. A close error still replaces a normal `break` or `return`.
- Expanding selection in `schema` and `data` declarations, `match` and typed `catch` expressions could return a range larger than its parent; selection ranges now stay nested around source syntax.
- A migrated workspace could check the same projects repeatedly while missing a `.vibe` file outside its original build graph; migration setup now combines the authored roots and every uncovered source owner into one build, and rejects an unowned source file.
- Repository Node loaders could receive raw `.vibe` modules before VibeLang compiled them; migration setup now registers VibeLang after the repository's ESM loader hooks so native compilation runs first.
- Migration setup silently missed plugin extension regexes that skipped `.vibe` modules; it now warns with the filter’s file and line before those modules lose their transforms.
- A migration's generated `.platform.ts` sibling and rewritten TypeScript imports could fail the repository's format check before record ran; the codemod now formats its authored files with the target's formatter and records its files, exit status and log; returning a module to TypeScript restores its import formatting too.
- The migration could select modules that an unchanged test bundles without native support, then fail that test after renaming them; inventory and both plan modes now retain the reachable source graph with its test and entry as evidence, and rename checks reject stale plans. Bundles already supplied a native adapter or emitted JavaScript remain eligible.
- Reverting a migrated module skipped saved imports in consumers that were already `.vibe`, replacing an alias such as `@/a.js` with a different name that could cause `TS2877`; revert now restores those consumers' original imports while retaining source names in newly migrated consumers.
- A Node or Bun child started by a package's source code could not import migrated modules, especially with another working directory; migration setup now adds absolute native preloads to typed source children and keeps built JavaScript invocations unchanged.
- Migration setup rewrote shell probes and built-program launches that could not name typed source, activating unrelated changed-file lint failures. It now leaves finite non-source arguments untouched and removes its own earlier unnecessary wiring while preserving launchers that may need a source loader.
- `vibelang --fix` left an `Effect.fn` generator with an `Effect.fn.Return<A>` return type, one that reads `import.meta`, and one at a plain member such as `Context.Reference`'s `defaultValue`. It now converts each.
- `vibelang --fix` left `try (x |> Effect.provideService(%, Key, value))`. It now writes a `provide` block.
- `vibelang --fix` left `onSome: Effect.succeed` as EK4301. It now writes `(value) => Effect.succeed(value)` at a plain member, and `try withSpan(p, "name")` where it wrote an arrow the gate refused.
- Native loops over values that also implement `Stream` were rejected or rewritten to consume the `Stream`; they now keep native TypeScript diagnostics and the written JavaScript iteration protocol.
- Migration could break a plugin host that derives virtual module names from a resolved package entry and source-file extension; scope planning now keeps the observed packages native and records the source-enumeration cause, preserving the unchanged host.
- The migrate flow rejected a native acquisition's unchanged `!Error` contract when its original function returned `Effect.callback<A, Error>`, as in foldkit's WebSocket example; it now recognizes that explicit returned channel when the callback becomes a platform service, while nested callbacks and changed contracts remain rejected.
- Switching between two pre-VIP-1 toolchains ran the earlier compiler's `--fix-vip-only` and changed pure `.map` callbacks into Effect functions; the migrate flow now probes both compilers and runs that migration only from pre-flip to post-flip, recording why it skips a switch or a failed probe in `vipFixes`.
- Node and Bun imports could fail when `TMPDIR` named an absent application directory; compilation and the default cache now use an existing parent without creating that application directory.
- A direct `Option.match` call reported `EK4839` as a choice made with Effect's `Match` functions, and the diagnostic tables omitted it; the message now names `Option`'s own `match` API, and the tables include direct calls and explain when their fix is refused.
- A declaration sidecar left imports unresolved when a relative filename contained quotes or Unicode escapes; sidecar imports now resolve the decoded filename and keep valid escaping and the declaration's quote style.
- An explicit `./model.vibe` import or re-export could make stock TypeScript read an unrelated `model.ts` or `model.d.ts` sibling and report `TS2322`; declaration sidecars now keep the explicit `.vibe` target, while native imports keep their native target.
- A closure created in a plain `for...of` loop's iterable expression could read an outer variable when the loop declared the same name in a destructured `let` or `const` head; it now captures the loop's uninitialized head binding and throws `ReferenceError`, as in TypeScript.
- Retired `await.all`, `await.race`, `await.any` and `await.allSettled` spellings in async code produced an unrelated parse error; they now report `EK1802` with async-context guidance and no effect-only automatic rewrite.
- Documentation generation formatted the same declaration signatures again for re-exported aliases; each checker now reuses their formatted text while producing the same inventory.
- `vibelang --fix` deleted comments from legacy diagnostic maps, including empty maps and entries superseded by modern settings; it now keeps every comment in direct and extended configs, with the same settings and a stable second run.
- A `continue` to an earlier label in a chained `for...of`, such as `outer: inner: for (...)`, compiled to JavaScript that Node rejected; every label now stays on the loop, so labeled `continue` and `break` keep their TypeScript behavior.
- Migration setup could rewrite an `oxlint` package name in release dependency data. It now redirects executable lint commands while preserving package data.
- Renaming a repeated `is` binding could also change reads of an outer parameter or local after a failed pattern; the quick fix and `vibelang --fix` now preserve those fallback reads.
- Schema declarations rejected named, optional and rest tuples, including rest arrays written as `readonly T[]`, with `EK2109`; they now preserve their written positions using Effect's tuple schemas, optional positions accept explicit `undefined`, and invalid element order keeps TypeScript's diagnostics.
- The migrate flow's `setup --no-wire` crashed with `RangeError: Maximum call stack size exceeded` when a run combined an already wired package with a new one; setup now wires the new package using the ordinary package-wiring rules, preserves existing wiring, and changes nothing on the next run.
- The migrate flow planned a file that the repository's own code finds by its name, such as `alchemy.run.ts`, so `alchemy dev` found no stack after the rename; such a file now stays `.ts`, and the plan says which file names it.
- The specification's grammar gave `a catch () => b |> % + 1` two parses with different results: the pipe inside the arrow handler's body, or the pipe applied to the whole `catch`. It now has one, the handler's body, as the compiler already reads it; write `(a catch () => b) |> % + 1` to pipe the recovered value.
- A pipe followed by a conditional, `x |> f(%) ? 1 : 2`, compiled as `x |> (f(%) ? 1 : 2)` without a word, although the pinned pipe proposal rejects a conditional at either end of a pipe; it is now `EK2301` at the `?`, which says to write `(x |> f(%)) ? 1 : 2` or `x |> (f(%) ? 1 : 2)`, and `vibelang --fix` writes `x |> (f(%) ? 1 : 2)`, the meaning it had.
- `vibelang --fix` could keep a repair that turned one existing error into two when one kept its message and the other kept its span; each existing error now accounts for at most one error after the repair, while changed messages and spans moved by edits still match.
- The pattern-binding chapter cited unpublished decision numbers for binding homes and redeclarations. It now links a public VIP-7 amendment stating those same rules.
- Native `await` warned about empty tuples, containers and objects with only a `Fiber` or `Deferred` marker; the warning now requires the corresponding interface, so these ordinary values compile even when the advisories are promoted to errors.
- Parenthesized arrow handlers after `catch` could be returned as function values or lose their parameter types; they now receive the failure and run as handlers.
- A typed catch clause whose binding destructures, such as `catch ({ id }: NotFound)`, crashed the compiler and the editor with `Unhandled case in Node.Text`; it now reports `EK2112`, suggesting `catch (e)`, and its quick fix leaves the pattern alone.
- Bundling a package that mixed `.ts` and `.vibe` modules could include two copies of a shared service or schema, so a built CLI failed at startup although its tests passed. The bundler plugins now select the package's `vibelang-source` exports and preserve the bundler's existing conditions, keeping one source graph.
- Under `module: Preserve`, a declaration printed inferred prelude types as `import("effect/Layer").Layer` even when the source used `Layer`; it now imports the written module names as the equivalent TypeScript does, including when the package leaves its module type implicit.
- A `.vibe` module that imported a native `.tsx` sibling under `jsx: preserve` named a missing `.js` file in its emitted JavaScript; imports and re-exports now name the sibling’s actual `.jsx` output.
- Interrupted migration fix passes could leave changes in earlier modules. They now restore sources outside the selected batch before reporting failure.
- JSX attribute diagnostic `EK0402` lacked its VIP-39 cross-reference; the catalog now attributes the rule to both VIP-4 and VIP-39.
- Formatting a file containing Unicode line separators in the editor could add indentation that disappeared on the next format; `U+2028` and `U+2029` now give stable indentation in one pass.
- Formatting `effect` or `do` blocks with comments before `{` could fail; their header comments and the line breaks needed to parse the block now survive formatting.
- The CLI guide described added declaration imports as following only the first import's quotes; it now includes an earlier export specifier and the double-quote default when neither exists.
- A `.vibe` or `.ts` file that kept its `./target.ts` import after `target.ts` became `target.vibe` failed with `TS2876` under `rewriteRelativeImportExtensions`, and rewriting the import to `./target.vibe` changed the published declaration; the written `./target.ts` now compiles, emits `./target.js`, and stays `./target.ts` in the declaration.
- Migration scope planning could change a native bundle input path when an unrelated module migrated; packages with protected bundle input paths now stay as TypeScript with a named cause.
- A `data` declaration's declaration file differed from what TypeScript declares for its Effect TypeScript counterpart, so a migrated tagged union failed declaration identity: it declared the constant first, as `Data.TaggedEnum.Constructor<Delivery>`, and every field `readonly`. It now declares the type first, each field as written, and the constant with the type TypeScript infers, `Data.TaggedEnum.Constructor<{ readonly _tag: "Waiting" } | …>`, then a generic one's `WithGenerics` interface before its constant. **The `.d.ts` text of every exported `data` declaration changes**; the types are the same. Write `readonly` on a field whose TypeScript was `readonly` or wrapped in `Readonly<{ … }>`, which the migrate flow's identity gate reads as `{ readonly … }`.
- In a project that emits declarations, `vibelang --fix` rewrote a private schema type used by an exported interface, changing `Schema.Schema.Type<typeof Meta>` to `typeof Meta.Type` in its declaration file; `EK4832` now preserves that spelling for private aliases and interfaces too.
- Awaiting a `Fiber` or `Deferred` in effect code showed extra configurable warnings; it now reports only `EK0102`, with a working `join` or `Deferred.await` repair.
- The schema mapping table did not distinguish a local type named `Record`, `Array`, `ReadonlyArray` or `Readonly` from a library built-in; it now requires the resolved library type binding and specifies `EK2109` for a shadowing type without a decoder.
- The schema declaration rules left unclear which emitted declaration owns its documentation; JSDoc and visibility tags now explicitly belong to the schema constant, and the generated type alias stays bare.
- Seven setup guides described adjacent `.d.vibe.ts` declarations as a future feature; they now link the current sidecar workflow, including emission under `--noEmit` and TypeScript's `allowArbitraryExtensions`.
- The matching guide said every other `is` binding reported `EK4703`; it now keeps the precise unsupported-home list and the per-iteration `while` scope rule.
- Package verification could crash when a migrated private import became a condition object; setup now unwraps migration targets before the existing publication path mapping.
- Aliased imports of migrated modules failed with `TS2877` when extension rewriting was enabled; migration now uses a relative source name for the same module and preserves the configured option and original alias for revert.
- `vibelang --fix` left `yield* Effect.gen(…)` half converted: it rewrote the inner generator, then refused the outer one with EK4616, because it wrote `try (effect { … })`. It now writes `try effect { … }`.
- The tooling emit-name rule promised only `.js` declaration imports even for packages selecting another style; it now separates runtime JavaScript from the approved declaration spelling.
- The resolver reference left linked packages and `preserveSymlinks` ambiguous; it now classifies TypeScript's final path and includes aliases, JSX sources and mapped sidecars.
- The tooling reference treated explicitly listed sidecars like discovered outputs; it now specifies `TS5055` input protection and the independent compatibility write under `noEmit`.
- The migration inventory omitted the retired global `Effect<A, E, R>` alias; it now documents `EK4856`, its identity-safe repair and coordinated removal.
- The codemod reference did not bound writable files; it now limits fixes to owned program sources and eligible configs, with only the proved fresh platform-companion exception.
- The match reference claimed strict binding types under every compiler option and used unchecked extraction reads; it now follows project options and expresses proven presence without erasing actual `undefined` payloads.
- The module guide implied explicit `Effect` imports gained `Array` and other collision modules; it now explains the implicit qualifier and explicit aliased-import form.
- The service reference could be read as requiring a separate Effect or return-type diagnostic; it now states TypeScript's ordinary implicit-`any` checks and the option-off behavior.
- The migration reference could turn a successfully returned error into failure or start a returned Effect; it now distinguishes legacy wrapper removal from an intentional run and never guesses an `asEffect()` conversion.
- The diagnostic reference described `EK9204` only on old `try` statements; it now also explains valid infallible `catch` expressions and rejects interim codes in modern severity settings.
- The function specification left recursion's stack behavior unstated; it now distinguishes JavaScript's plain-recursion limit from stack-safe Effect recursion.
- The specification left cyclic declaration output ambiguous; it now defines the retained `/*elided*/ any` output and keeps ordinary recursive-inference errors.
- Compiler cases returning large Effect values could fail because their runner exited before printing the complete result; it now flushes the result and failure details before exiting.
- Awaiting a Fiber or Deferred in effect code reported an error using the configurable warning codes `EK4609` and `EK4610`; it now reports the fixed placement error `EK0102` separately, so advisory severity settings keep their meaning without allowing `await` in effect code.
- `vibelang agents check` could report `no errors` and succeed when its compiler failed or was terminated; checks and hooks now fail with the compiler's status, signal or spawn error and standard error output, including failures caused by errors outside the selected files.
- Formatting a labeled arrow statement failed with `formatting changed the program`; labels now keep their arrow body under semicolon-free formatting, and written empty labels stay intact.
- Formatting a returned function type removed written parentheses and changed published `.d.ts` files; the formatter now keeps those parentheses and their enclosed comments, including nested and generic function types.
- An `is` that binds names in a `for (init; test; update)` head reported `EK4703`; the bindings now live in the head as chapter 004 states (decided detail 240): a binding from `init` is copied into each iteration like a `let` declared there, and a binding from `test` or `update` is a cell of each iteration, which a read in `update` cannot see initialized (`TS2454`). A `var` or `using` initializer still keeps `EK4703`.
- An `is` that binds names in a `match` arm or in a class field initializer reported `EK4703`; the bindings now live in the arm, which is its own scope, or in the initializer's own scope, as chapter 004 states.
- Code with two `is` patterns binding one name in one block compiled when each `if` head was its own scope; it now reports `TS2451` (or `TS2300` beside a parameter), and the diagnostic offers to rename the later binding and its uses, and `vibelang --fix` applies the rename (chapter 004, decided detail 245).
- An `is` binding in an `if` head was scoped to that `if` alone, so `if (!(x is { id: let id })) return; use(id)` reported `EK4703` and `||` or nested conditions could not bind; the bindings now live in the block that holds the `if` (chapter 004, decided detail 245), an unbraced body is its own block, a `for concurrent` limit may bind, and two patterns binding one name in one block report TypeScript's `TS2451`. A binding written `const` keeps const immutability: an assignment to it is TypeScript's `TS2588`.
- An `is` that binds names in a variable statement, an expression statement, a `return`, a `throw` or a concise arrow body reported `EK4703`; its bindings now live in the block that holds the statement, or in the arrow body (chapter 004). Unsupported homes retain `EK4703`; formal-parameter and enum initialization use `EK0705`.
- The migration's ESLint bridge rejected `declare const` symbol brands used only through `typeof`, which Oxlint accepted; the mapped `no-unused-vars` rule now counts those reads and retains configured options and unused-declaration reports.
- Conversion examples changed exported Effect values into functions, breaking callers that passed them directly to runners; all five affected examples now keep lazy Effect-valued `const` exports.
- Conversion examples dropped explicit service keys, so existing providers could no longer satisfy migrated programs; examples and migration prompts now preserve the original runtime identities.
- Migration instructions still avoided service-key lookup and native time/randomness calls after their blockers were fixed; they now teach the supported forms and keep the injected-service testing recommendation.
- The known-limitations page incorrectly said stock TypeScript could not resolve `.vibe` imports; it now explains the implemented declaration-sidecar route with `allowArbitraryExtensions`.
- The platform crypto example passed raw bytes as algorithm-bearing keys and omitted its encryption inputs; it now uses native Effect key types and declares every input.
- A restarted whole-scope migration repeated completed work and could record a misleading green result; it now banks packages, retains timeout and root-cause receipts, follows resolved path strings, regenerates through repository hooks, emits declarations with `--singleThreaded`, and checks nonempty test results against main and the previous commit in one job.
- The migrate flow could refuse a small scope because an unrelated source imported more than `240` modules; bounded fix shards now contain only selected sources and their dependencies, and full-project checks still cover the other files.
- Whole-repository migrations needed local drivers and could report success after a failed rollback; the migrate flow now plans one scope batch, fixes bounded dependency-ordered shards, and reverts by cause until every project is clean against its baseline.
- A resource accepted by a union's data member could still report `EK4301` when an inferred type argument ruled out its generic callable member; member matching now uses the completed call's inference, including arrays and later callback arguments.
- After the migrate flow renamed a module to `.vibe`, an importer that named it through a tsconfig `paths` alias, `@/composer/schema`, kept that spelling, which the project’s `bun check` script invoking stock TypeScript cannot resolve (`TS2307`); the codemod now writes `@/composer/schema.vibe` there too, as for a relative import, and `revert` puts it back.
- Migration verification could call declarations identical after their compiler failed; it now rejects every nonzero declaration emit and retains option-level errors.
- A `.ts` declaration that named a type it reached through a package's `.vibe` module wrote a relative path into the package, `../../lib/src/x.js`, or failed with `TS2883`, once the bare specifier resolved to the `.vibe` source: the declaration emitter matched the module only against an export's emitted JavaScript. It now names the module by the export that selects it, `import("lib/x")`, when that export lists the source under `vibelang-source` or its `x.d.vibe.ts` sidecar under any condition, in exact and pattern entries (opencode's core: 1,478 `TS2883` in 110 files).
- Packing a migrated package could leave its installed exports pointing at `src/*.vibe` or `.vibelang/js` even though the package shipped only `dist`. Setup now adapts publication helpers that map TypeScript source exports to built paths, preserving their existing `dist/*.js` and `dist/*.d.ts` exports for migrated entries.
- Migrations could accept changed APIs in private workspace packages; `--include-private-declarations` now checks their declarations and emit errors too.
- Native builds and copies could report success while leaving the executable path as a directory and putting the binary inside it; they now report the directory collision and preserve its contents.
- Passing an Effect function to a `Function` destination could bypass `EK4301` after generic union matching; callable destinations now keep the synchronous-callback check.
- A migration left a repository’s lint configuration naming `x.ts` after the module became `x.vibe`, so a rule the repository had turned off for that file came back. Setup, the codemod and `revert` now keep literal Oxlint and ESLint paths pointing at each module, and setup repairs paths that earlier runs left behind.
- Migration codemods could stall on brace-heavy literals or broaden a test selector; source-name wiring now scans source inventories with cached, bounded matchers and proves the final selected filenames and counts unchanged.
- `vibelang --fix` moved a TypeScript call out of `Effect.sync(() => label())` into an `effect` block, where EK4401 refused it and the whole file stayed unconverted. The thunk now stays, because it is the boundary that makes the call's exceptions defects.
- The shipped skill taught `fork.in(scope)`, `fork.scoped` and `fork.detached`, which the release compiler could not parse; its examples now use `try Effect.forkIn`, `try Effect.forkScoped` and `try Effect.forkDetach` instead.

- `vibelang --fix` rewrote an `error` with a `static` member or setter (`EK1302`) into a `Data.TaggedError` class that no longer matched a value of the same tag from another copy of the package, so a `match` arm such as `when E` silently fell through. The class now extends the runtime `TaggedError` shim and keeps cross-copy matching.

- A `private`, `protected` or `public` `_tag` property, or `_tag!`, in an `error` or `schema error` body reported TypeScript's `TS2415`, `TS2564` or `TS2612` about the generated class next to `EK2117`. It now reports `EK2117` alone.

- A `schema error` method or getter whose computed key had a broad type, such as `string`, compiled even when the key was `"_tag"`; constructing the error then threw `TypeError: Cannot set property _tag`. Such a key is now `EK2117` unless its type excludes `"_tag"` (a literal, a symbol, a number or a template such as `` `x-${string}` ``), and `vibelang --fix` keeps an existing member in an explicit Effect TypeScript class.

- `vibelang --fix` could remove an explicit `<{}>` payload from a fieldless `Data.TaggedError` class, changing its published declaration. Projects that emit declarations now keep the class and receive an explanation instead.
- Reverting a migration importer before its dependency could replace an original `.js` import with `.ts`; either revert order now restores the original specifier.
- Switching migration toolchains could absorb newly failing tests or compiler errors into a passing baseline; the flow now rejects the switch and retains its before-and-after evidence.
- The migrate flow rejected harmless formatting of existing `.vibe` tests; it now accepts it only when both the parsed AST and token stream preserve the test, and lists these files under `formatter-only` in the PR proof.
- The migrate flow rejected a package test’s expected dependency list after setup added `vibelang-runtime`; it now allows exactly that addition when the pinned package manifests prove the dependency was gained, and disclose each assertion edit separately.
- The migrate flow rejected test path strings that only followed a source-file rename; it now proves the path resolves to the migrated file, including static path builders, while keeping modules as TypeScript when tests assert on their source text.

- The migrate flow's declaration snapshots failed with `TS5051` for valid projects using `inlineSources`; declaration-only emission now disables all source and declaration map options together, including inherited settings.
- `--fix` could leave statement-position `Option.match` calls unchanged after a parser refusal; it now writes a valid block and preserves callback order.
- Migrating a Match return-type hint could insert an `as` assertion that the repository's lint rejected; the quick fix now preserves checked type annotations, including destructured bindings.
- Migration staging could put a local tarball in optional package contracts; only direct runtime and development dependencies now receive the staged tarball.
- `try (try e)` ran one Effect: the parser read the outer `try` away, so `try (try Env)`, for a service whose value is a program, gave the inner program unrun, and its fields were TS2339. Each `try` now runs one Effect, since `try e` is `yield* e`. This changes existing code: `try (try load())` where `load()` gives no program used to compile and run `load()` once, and is now EK0502.
- Interrupted migration codemods could lose their rename, import or platform-split bookkeeping; the flow now journals every mechanical write before it starts and safely resumes or restores the original source.
- The spec chapters never mentioned the accepted `.vibex` file kind (VIP-39), nor that `./x.js` resolves to `x.vibe` after `x.ts` and `x.tsx`. Chapter 7 now has a `.vibex` section with the resolution table, and the intro, chapter 1 and Appendix A name `.vibex`.
- VIP-39 didn't say whether a JSX attribute or tag is checked against VIP-4's thrown-type rule for function types. It now says an attribute is an object member, so a foreign handler with `@throws {Error}` is `EK0402` against an untagged `onClick`, and a tag's check against `JSX.ElementType` is not such a site.
- The spec's `EK0510` row named only `try`, `fork` and `join`, so `try.all [a] ** 2` and `fork.scoped e ** 2` had no code. Chapter 2 and Appendix B now name all ten execution heads.
- VIP-39 didn't say what runs first when a `do` that `return`s sits in a JSX attribute after other attributes. It now says the tag and everything before the `do` are evaluated first, once, in source order, as for any other operand.
- VIP-39 promised that renaming a `.vibe` file to `.vibex` changes nothing unless it has `<` in expression position, but a project without a `jsx` setting reports `TS6142` at every import of a `.vibex` file, and `preserve` writes `x.jsx`. The promise is now about parsing, and names both settings.
- VIP-39 said only `<` in expression position reads differently in `.vibex`, but TypeScript's JSX scanner also reads `</` as a closing-tag token, so `a </b/.source.length` and `when </b/:` don't parse there. A new clash row says to write a space: `a < /b/`.
- VIP-39 grouped `react-native` with the JSX modes TypeScript transforms, though `react-native` keeps the element in its output. It now groups `react-native` with `preserve`: the framework's compiler decides when a `try` inside the element runs.
- The migrate flow's setup left a build script that only runs `tsc` through Bun's shell, such as opencode's codemode `` $`bun tsc -p tsconfig.build.json` ``, on stock `tsc`, so the published `dist/index.js` imported `./codemode.vibe` and failed to load once installed; setup now runs `vibelang` there too, which writes `dist/codemode.js`, and adds `vibelang` to the package's `devDependencies`.

- A service declared inside a generic function or class could write member contracts in terms of the outer type parameter (`value: T`, `take(v: T)`, `load(): T!!`, or through an alias or a member-local constraint) and compiled, so every specialization shared one key; it now reports `EK3005` naming the member and the captured parameter, while member-local generics, unused generic arguments and concrete services in generic scopes still compile (decided detail `183`).
- Adding a host interface augmentation in a `.ts` file disabled platform diagnostics for constructors such as `XMLHttpRequest`; those references now keep `EK4402`, while local and imported bindings still shadow globals.
- Parenthesized provider expressions could be split into several providers or mistaken for service bindings; `provide (a, b)` now uses the comma expression's value, and parenthesized assignments keep their ordinary meaning.
- A provider list split beside a comma could compile silently; both comma-adjacent breaks now report `EK1202`, with a safe fix when comments permit joining the lines.
- Reading `Effect`, `Layer`, `Schema` or `Scope`, or writing an Effect type contract, reported missing names without `vibelang-runtime`; code that only needs native Effect namespaces now resolves with `effect` alone.
- A `provide` head whose last provider was parenthesized, as in `provide (LA), (LB) { … }`, failed with `TS1005: '=>' expected`, because the body's `{` read as an arrow function missing its arrow; a parenthesized provider followed by `{` now opens the provide body, as the grammar's `Provider` (a ConditionalExpression) allows.
- A missing `vibelang-runtime` was reported twice when a `.ts` import and generated `.vibe` helpers referenced it; mixed projects now report the missing package once and keep independent TypeScript errors.
- A project that resolved an `effect` other than the pinned 4.1.1 compiled, and its first Effect-typed use then failed with unrelated type errors; the compiler now reports one `EK3201` naming the resolved version, the VibeLang release and the pin.
- `sh scripts/build-vibelang.sh` built only `packages/compiler/native/vibelang`, while the compiler case harness runs `typescript/built/local/tsc`, so cases run after a rebuild tested an earlier compiler and passed or failed for the wrong code. The script now installs the same binary at `typescript/built/local/tsc`, and the harness warns when that binary is older than a compiler source.

- A service with no body, a `declare service` or a service in a `declare namespace`, and two service members on one line with no separator reported TypeScript syntax errors or nothing; they now report `EK0906`, `EK0907` and `EK0908`, and `EK0908`'s quick fix inserts `;`. The separator repair preserves the following member's comments and `@throws` JSDoc.
- Malformed service keys used the old diagnostic or accepted template literals; they now report `EK0901` and require `static readonly key` with a quoted string literal.
- Bodyless service members accepted class-only syntax or raised unrelated TypeScript errors; they now report `EK0902`, with a quick fix that keeps comments and the written contract.
- TypeScript consumers could not name an exported service's `S.Shape`; declarations now include that namespace alias and a shared private member type, preserving recursive, default and nested service shapes (VIP-9, VIP-27; detail 181).
- A service copied into a `const` or object property bypassed its `new`, `extends` and `instanceof` diagnostics; typed aliases now retain the service's restrictions, as direct references do (VIP-9).

- Listing a `.vibe` source and its declaration sidecar explicitly in `files` silently overwrote the sidecar; the compiler now reports `TS5055`, exits `1`, and preserves its bytes, including in `vibe.sidecarDir`.
- `vibelang --fix` refused to annotate the first of two `Config` helpers that a plain function calls, so neither helper was fixed: the function's one `EK9203` moved with the edit and named the second call, which the gate read as a new error; a span after or before a fix's edits in the file it edits is now compared where it lay before them.

- Vite could invalidate a module immediately after serving it when the compiler wrote a generated `.d.vibe.ts` declaration; those output events now leave the served module and its importers cached, while real source edits still trigger hot updates.
- Recording a migrated module could reject portable Monaco model URIs such as `file:///src/ui/message.ts`; the path guard now rejects only URIs under known machine roots.
- Migration reports omitted deliberately retained type-only Effect modules; reports now list them and keep the full ownership and test inventory beside the automatic candidate count.
- Typed lint could lose native-module types for tests outside the main TypeScript project; migration setup now connects those tests to their existing complete test project without editing tests.
- Switching migration toolchains could replace a published package's VibeLang peer range with a local tarball; peer ranges and optional metadata now stay intact while installed dependencies update.
- Migration rejected private adapter declarations when a package exported a hand-written `.d.ts` outside its build output; the flow now snapshots and resolves those shipped roots, admitting private additions while rejecting changed public bytes or resolution.
- Migration rejected native `throw new Error(...)` even when a function preserved its original global `Error` failure channel; the style gate now keeps `EK4804` as an advisory for that written contract, while rejecting TypeScript-style Effect forms.
- The migrate flow's planner refused a Vite config, `packages/website/vite.config.ts`, even after setup had wired the package's Vite scripts with the native config loader, so the config stayed TypeScript; a config wired that way is now a candidate, the codemod points the scripts at `vite.config.vibe` with `--config`, and revert restores them.
- Migration plans rejected `.mts` sources; ESM packages can now migrate them to `.vibe` and revert them with their original imports and entry points. Unsafe CommonJS boundaries are reported before files move, also when an interrupted codemod resumes from its saved state.
- Migration reports could call an unchanged failing test baseline a pass; reports and commit summaries now retain the actual failing status and test names.
- Migration could record missing build outputs as pre-existing test failures and later test stale distributions; upgrade, setup and verification now run declared build prerequisites, retain their source and dependency evidence, and refuse an unprepared failing baseline.
- The Foldkit guide showed only the small example app inline; it now also compares four excerpts from Foldkit's own migrated source with their originals.
- `a catch () => b |> % + 1`, `x |> % catch () => y |> % + 1` and `1 |> effect () => % |> [%]` each had two parses in the spec. A pipe after an open arrow handler now belongs to the handler, and an `EffectArrow` is an arrow for the pipe-body restriction.
- Six VibeLang syntax rules had no code in Appendix B. They are now `EK0109`, `EK0202`, `EK0512`, `EK1505` and `EK1606`; the compiler moves to them with its pending cases.
- The spec said `S.Shape` is undeclared for a local service, against VIP-9. A local service now names `S.Shape` inside its own members, and uses `Context.Service.Shape<typeof S>` elsewhere.
- An `is` binding in a `for concurrent` limit or a catch parameter had no home in the spec. A limit binding belongs to the home around the loop, and a catch-parameter binding is `EK0705`.
- Two `is` tests that bind one name in one block had two readings. The spec now makes them a redeclaration, `TS2451`, with a `vibelang --fix` rename; the compiler still accepts them until that work lands.
- The spec put an `is` binding in an unbraced loop body in the enclosing block, which would initialize one cell once per iteration. An unbraced statement body is now its own home, so braces never change a result.
- `EK2202` named only a `for concurrent` body, so `restore` in a head default slipped past the written rule. The rule now names head binding initialization too; the compiler does not report the code yet.
- `--fix-migration-only` and `--fix-vip-only` appeared in the tooling chapter with no accepted VIP. VIP-34 now records both.
- The spec listed four Effect subpath namespaces that share a web platform name. It now lists `KeyFormat` and `Transferable` too; both keep their DOM meaning in a bare type position.
- The spec gave `when Option.Some:` two readings in an exhaustiveness check. It now says a bare fixed pattern covers its case, which is what the compiler does.
- The developer tools guide did not show how Foldkit's real migration covers `.vibe`; it now lists its lint, format, dead-code, type, docs, build and test integrations with pinned configuration links and coverage limits.
- Migration setup left root `tsrs` and `tsgo` typechecks on their old compiler, so converted files could be skipped or require an extra check of unrelated projects; it now runs `vibelang` with the original project arguments, including separate test projects.
- `EK4401` reported a call of a TypeScript function that returns an `Effect`, a `Stream` or a `Layer` wherever no `try` ran it, such as an operand of `Effect.all`, a `provide` list or an array. Such a function can't throw (VIP-4), so its call is allowed wherever it stands. A return that is only partly one, such as `Effect<number> | undefined`, stays tracked.
- `vibelang --fix` left `EK4401` on a plain call of a `.ts` module or package whose exceptions nothing lists, so a migration kept the module in TypeScript. In effect code it now writes `try Effect.orDie(Effect.try({ try: () => f(x), catch: (error) => error }))`, so an exception stays the defect it was in Effect TypeScript and the declaration doesn't change; in a function with no Effect operation it writes `: infer _`, which keeps the function plain. Neither form trusts the code, and `EK4806` no longer warns about that `catch`, since nothing reads what it returns.
- Unchanged tests that bundle package sources through Rolldown or Vite's bundled config loader could not load migrated `.vibe` dependencies. Migration setup now supports `--emitted-project` to generate exact private import conditions for JavaScript produced by the package's existing build, while preserving test commands, consumer exports and published declaration bytes.
- A `.vibe` module that imported or declared a name the prelude gives an Effect module, such as sst's `Resource`, and read it in an Effect function compiled, then failed at load with `Identifier 'Resource' has already been declared`: the emit also imported `effect/Resource` under that name. A local declaration or import now shadows the module there too.
- A build script that ran `` $`bunx tsc --emitDeclarationOnly` `` before its `Bun.build` wrote no declaration for a module the migrate flow had made `.vibe`, so opencode's http-recorder build failed `ENOENT … dist/index.d.ts`; setup now runs `vibelang` there, as it already did in package.json scripts.
- The migrate flow's setup left an electron-vite config's `main`, `preload` and `renderer` builds, and a Vite app's worker build (`new Worker(new URL(...))`), without `vibelang()`, so those builds failed on a `.vibe` module (`PARSE_ERROR`); setup now adds the plugin to each of them.
- The migrate flow's codemod renamed a tracked module under a `.gitignore`d directory, so the batch's commit deleted the `.ts` and recorded no `.vibe`, and a revert left the `.vibe` behind; the codemod now refuses that batch before it changes anything.
- The diagnostic reference could make an emitted `EK3008` look unknown; it now explains that this static service-key error corresponds to the specification's `EK0901` until compiler renumbering.

- Running `vibelang lint` could create or overwrite declaration sidecars and incremental build information; lint now checks the project without writing output files.
- After the migrate flow's setup, an ast-grep rule for TypeScript also scanned each `.vibe` module's `x.d.vibe.ts` sidecar, so a finding in a `.vibe` module was reported twice; setup now adds `**/*.d.vibe.ts` to the `ignores` of each TypeScript rule it extends to `.vibe`.
- Under the `vibelang/bun` preload, every resolution Bun made, a bare `effect/package.json` included, ran a JavaScript callback, so opencode's TUI plugin test took 34 s instead of 1 s; the preload now handles only resolutions of a path.
- In a Bun build, importing `./x.js` from a `.vibe` module could make the VibeLang plugin claim an `x.ts` or `x.tsx` when another directory contained `x.vibe`; the hook now claims only the VibeLang modules it serves and leaves TypeScript resolution to Bun.
- With `noUncheckedIndexedAccess`, `Option.Some`, `Exit.Success` and `Result.Failure` pattern bindings could gain `undefined` and reject valid code; fixed extractors now preserve their payload types, including through import aliases.
- Moving a repository the migrate flow had partly migrated onto a newer toolchain left its `.vibe` modules for the new compiler alone, which cannot recover a VIP migration only the earlier compiler knows (VIP-1's unmarked Effect helpers); `upgrade-effect` now runs the installed compiler's `vibelang --fix --fix-vip-only` first and commits its edits with the switch.
- The examples, the app template, the Vite plugin's README and the style guide wrote trailing blocks such as `it.effect("loads") { … }`, which VIP-11 denied; they now pass the block as an argument, `it.effect("loads", effect () => { … })` and `Layer.effect(Users, effect { … })`.
- VIP-11 denied trailing blocks, yet `Layer.effect(Users) { … }` and `it.effect("loads") { … }` still compiled silently as calls with an arrow argument; code that compiled before now has a compile error, `EK1101`, at each trailing block, and `vibelang --fix` writes the block as the call's last argument with the same runtime behavior.
- An `effect` function that ran two Effects whose errors are aliases of one union, such as AWS `TagResourceError` and `UntagResourceError`, declared every member of the union, while the `Effect.fn` it replaces declares the first alias; its declaration now reads E and R as TypeScript reads them from an `Effect.gen` body, so it keeps the alias.
- A constructor in an `error` body compiled silently, and one in a `schema error` body got only the `EK4814` warning; both now report `EK1301` alone, and the quick fix keeps the constructor in an Effect TypeScript class.
- An `error` or `schema error` body accepted an initialized property, a `private`, `protected`, `public` or `declare` property, a private name, an `accessor` property or an index signature, silently or with TypeScript's errors; each now reports `EK1304` alone, and the quick fix keeps the member in an Effect TypeScript class.
- `vibelang --fix --fix-vip-only` left an `effect` arrow whose body is a call without `try`, as in `effect (k) => withSpan(program, "load")`, although the call runs today; once a function's `effect` mark alone decides, that arrow returns the call's Effect unrun. The codemod now writes `effect (k) => try withSpan(program, "load")`, as it already did for `return f()` in a block body.
- `vibelang --fix` left `x |> Effect.withSpan(%, name)`, `x |> Effect.provide(%, L)` under `try`, and `try Effect.void` as written. It now writes the prelude's `withSpan`, a `provide` block, and nothing for `Effect.void`.
- `vibelang --fix` left `x |> Effect.catch(%, h)`, `Effect.orElseSucceed`, `Effect.mapError`, `Effect.sync` and `Effect.suspend` as calls, and offered a broken rewrite for the first. It now writes a catch expression where the pipeline runs and an `effect` block for a thunk, and writes `x catch () => v`, not the retired `x catch v`.
- `vibelang --fix` turned the branches of `(c) => c ? Effect.void : Effect.fail(e)` into a value and a `throw`, which changed the function's declared union of Effects. It now leaves such a function as written.
- `vibelang --fix --fix-vip-only` left a program such as `Effect.void` in an arm of a returned `?:` as a value (`cond ? Effect.void : Effect.fail(e)` under an `Effect` return type), which failed with `TS2322` "`Effect<void, never, never>` is not assignable to `void`"; each such arm now gets `try`, as a whole returned program does.
- `vibelang lint -c <oxlint config>` walked build output that Oxlint skips, such as foldkit's `packages/create-foldkit-app/dist/templates`, and failed with "does not include it; not linted"; it now skips what Oxlint skips for the same invocation: files ignored by `.gitignore` files up to the repository root and `.git/info/exclude`, the `--ignore-path` file (`.eslintignore` by default) and `--ignore-pattern` globs, with `--no-ignore` turning off the last two.
- A `.vibe` import with a plugin's query, such as `./x.vibe?highlighted` that a website plugin loads as rendered HTML, was recompiled by `vibelang-vite` as the module and the build failed with `MISSING_EXPORT` for `default`; the plugin now compiles only the module itself and ids with Vite's own queries (`?import`, `?v=`, `?t=`, `?worker_file`), and leaves a resource another plugin loads alone, as it already did for `?raw` and `?url`.
- A workspace package that exports a `.vibe` module's declaration sidecar as its types, and imports the module from its own `.ts` files as `./x.vibe`, gave a `vibelang` consumer two copies of the module, so its classes failed with TS2345 ("separate declarations of a private property"); the export now resolves to the source when the source is beside it outside `node_modules`.
- After a `chmod` of the compiler, or any change to its timestamps that kept its bytes, every Vite or loader run recompiled each project (`compiler changed`). The cache now compares the compiler's contents when its timestamps differ, and recompiles only for a changed compiler.
- `vibelang --fix` removed the retired `declarationSidecars` setting but left an empty `"vibelang": {  }` object behind, which a repository's formatter then rewrote; a settings object that held only that setting now goes with it, and one with a comment keeps the comment.
- Migration left a plain `Option.match(value, { onNone, onSome })` in native sources and `--fix` offered nothing, so Foldkit's nine pure choices were rewritten by hand; `--fix` now writes a native `match` over `Option.Some`, reading the subject and the handler object once in their original order.
- `--fix` refused an Option pipe whose stage argument is a callback factory, such as `pipe(value, Option.map(EffectArray.append(1)))`, because the factory's evaluation could move; it now caches the subject and every argument in pipe order inside a `do` block and then applies the native methods.
- `--fix` left a Match chain whose default handler destructures its parameter, `Match.orElse(({ _tag }) => _tag)`, with EK4839; it now writes a catch-all `let` arm whose `do` block destructures the bound value, so defaults and getter reads run only when the default arm does.
- `--fix` left `Match.when(String.startsWith("Core"), …)` and `Match.whenOr` groups mixing literals with prefix predicates with EK4839, saying the prefix call has no match pattern; it now writes a guarded arm, `when let value and if (value.startsWith("Core"))`, joining a group's alternatives in one guard.
- `--fix` left a Match chain whose first stage is a hoisted `const withChoice = Match.withReturnType<T>()` with EK4839 ("withChoice has no match form"); a stable hoisted hint now converts like the inline one, keeping its type context and its read before the subject.
- Pure `Option.gen` bodies could remain rejected after migration. `vibelang --fix` now converts supported eager generators to plain bodies with ordered reads, a `None` early exit, and fresh `Some` results.
- A `.vibe` module whose inferred export type printed longer than TypeScript's serializer limit failed with `TS7056`, though its `.ts` original gave consumers that read the source the full type; t3code's large schema modules stayed TypeScript. A `.vibe` module's declarations, its sidecar, now print such a type in full. A `.ts` file keeps TypeScript's limit.
- A function returning `{ status: 2 }` or `{}` could declare `readonly status?: never` or `status?: never` depending on which unrelated function the checker reached first, so a package's declarations changed between runs with no source change. The added property now follows the function's own literal. TypeScript 5.9 has the same bug.
- The migrate flow's setup rewrote only `tsc` in the migrated packages' scripts, so a root or TypeScript-only package that built with `tsrs -b` or `tsgo -b` rebuilt migrated projects with a stock compiler and published JavaScript that imports `./x.vibe`; setup now runs `vibelang` for `tsc`, `tsgo` and `tsrs` in the root's scripts and in every package that reaches a migrated one.
- The `rewrite-*` acceptance cases, which compile a program, rewrite it with `vibelang --fix` and compile it again, could be killed as a whole after 60 s on a loaded host; a custom runner now declares its own deadline (`// run-seconds: N`), and these declare the sum of their six 30 s stages, so a slow stage is named instead.
- A default-exported `service` could produce a generic TypeScript syntax error; it now reports `EK0905` and shows how to write the named declaration and indirect default export.
- Default-exporting an `error` or `schema error` used to report an unrelated semicolon error; it now reports `EK1305` and explains `export { Name as default }`.
- Formatting valid `for` heads with `is` patterns could fail with an internal parse error; they now format at narrow and normal widths while keeping `is` attached to its subject.
- Formatting native `Option` control flow could reject parenthesized `return (match …)` expressions and binding `is` branches; these forms now format while preserving their parsed structure.
- A dprint `operatorPosition` of `sameLine` or `maintain` could wrap an `is` pattern onto the next line at a narrow width and fail with `')' expected`; the pattern now stays on the line of `is`.
- With the DOM lib loaded, a contract such as `Effect<string, never, FileSystem>` around `try FileSystem()` failed with `EK9202` "needs FileSystem, but its contract says R = FileSystem" and suggested `FileSystem | FileSystem`; the error now names Effect's type `FileSystem.FileSystem`, explains that the bare type is the DOM's (VIP-14), and `vibelang --fix` writes `FileSystem.FileSystem` in the contract.
- Schemas and schema errors with a `__proto__` field could lose the field or throw while being declared; the field now validates, constructs and encodes as an own data property. Native `Schema.Struct` prototype setters keep their JavaScript meaning during `vibelang --fix`.
- Ambient `error` and `schema error` declarations compiled without constructing a runtime value and could be suggested as replacements for native ambient classes; they now report `EK1307`, and native ambient classes retain their erased form.
- In Vite, a `.vibe` module's `tsconfig` path alias such as `import { value } from "~/value"` resolved to nothing, though the same import from a `.ts` module resolved under `resolve.tsconfigPaths`; `vibelang-vite` now resolves it to the file the nearest `tsconfig.json`'s `paths` give, as `vibelang` does.
- A typed or generic `effect` arrow with a bare parameter reported unrelated TypeScript syntax errors. It now reports `EK0109` and offers a fix that inserts the required parentheses.
- `export default effect { … }` exported the program but declared `declare function _default(): A`, so a TypeScript consumer's `Effect.runSync(program)` was `TS2345`. The declaration is now `declare const _default: Effect<A, E, R>`, as for `export default Effect.gen(function* () { … })`.
- `export default effect (n: number) => { … }` declared `declare function _default(n: number): A`, the body's value, not the Effect it returns. It now declares `: Effect<A, E, R>`, as `export default (n: number) => Effect.gen(function* () { … })` does.
- A generic arrow after `catch` could produce syntax errors instead of a handler; generic, constrained and defaulted arrow heads now parse as ordinary arrow handlers do.
- A `fork` or `join` operand starting with a type assertion, literal, unary operator or newline could be read as an identifier expression or comparison; Effect code now recognizes those operand heads using `await`'s precedence and reservation.
- A generic arrow on the line after a bodyless `error` or `schema error` could be consumed as the declaration's type parameters and report `EK1303`; it now starts a separate arrow statement.
- A plain function that starts a root Effect, such as `const build = (): number => Effect.runSync(program)` or an SSG `renderPage` that calls `runPromise`, reported `EK1005` as if a fiber ran it. A function that `effect` does not mark is plain JavaScript (VIP-1), so a runner may start a root fiber there; an `effect` function, and a plain callback it passes on, still report `EK1005`.
- Calling an Effect value, such as `body()` for an Effect parameter, type-checked as the Effect but ran it, so `Effect.provideService(flag ? body() : other, Tag, 1)` compiled and then died with `Not a valid effect`. An Effect is now not callable, as in TypeScript (`TS2349`), and `try body` runs it (VIP-5).
- An unmarked function became an Effect function when its body ran an Effect or threw, or when its return type was an Effect, so `export function f() { return 7 }` could return an Effect and a local function named `provide` or `succeed` was read as a program; now only `effect` makes an Effect function (VIP-1), `try` outside effect code is `EK0501`, and an `effect` function's written return type must be an Effect type (`EK0106`).
- Classes extending a value named `effect` were rejected with syntax errors; `class Derived extends effect { }` now compiles as it does in TypeScript.
- VIP migration could remove `try` from calls returning tagged errors and turn their failures into success values; it now preserves execution of those Effects, while non-Effect Yieldables retain their `asEffect()` repair.
- Formatting a `data`, `schema` or field-only `error` declaration whose opening brace was on the next line could require a second pass to settle its indentation; one pass now produces stable indentation.
- After that fix, VIP migration kept `try` on calls to unannotated plain functions such as `function double(n) { return n * 2 }`, which left an `EK0502` error; it drops that `try` again and keeps it only where the callee's written return type is an Effect.
- VIP migration treated a plain function without a return type that returns an `error` instance or an object with `asEffect()` as an Effect: it kept `try` on its call, rewrote the call to `try f().asEffect()`, which returned a different value, or refused to migrate the file. It now removes that `try`, and the call gives the returned value, as it did before.
- `try` could reject generic Effect subtype operands or report a standalone `Config` call as discarded; values and calls now run consistently, retaining their success, error and requirement types.
- Oxlint scripts that select TypeScript files by extension skipped converted `.vibe` files and their `warn` rules; migration setup now includes them through ESLint with the same configured rule names, severities, source lines and warning policy, while keeping upstream `oxlint`.
- A migrated `oxlint src` command stopped before ESLint when the directory contained only `.vibe` files; setup now permits an empty native pass so those files still receive lint checks.
- Oxlint suppression comments stopped working when the migrate flow checked a converted file through ESLint; the generated parser now honors the same disable/enable scopes and rule aliases while preserving source lines.
- The migrate flow planned a tool's config that uses Effect, such as `graphql.config.ts`, for `.vibe`, and the tool, which finds its config by name, then failed with `config file not found`. A `*.config.ts` file now stays `.ts`, and a plan that names one is refused.
- Migration setup could lint native files excluded by the original Oxlint policy; its ESLint bridge now preserves `ignorePatterns`, source-extension globs and ordered negations.
- With a `paths` alias such as `"@/*": ["./lib/*", "./src/*"]`, an import of `@/x.vibe` compiled against `lib/x.d.ts` but the loaders ran `src/x.vibe`; the loaders now resolve it as the compiler does, so both use `lib/x.d.ts`.
- Migration could lose literal braces from renamed paths and skip formatting the real file; rename summaries now preserve those braces and retain both the original and destination paths.
- The migrate flow's declaration emit deleted every `.d.ts` file it wrote outside its output directory, so setup and verify deleted a tracked declaration file beside a source outside a project's `rootDir`; the emit now removes only the files it created and puts back the ones that existed.
- `vibelang --fix` left a program a module holds at its top level, `export const ping = send("PING")`, as EK1001. It now writes `effect { return try send("PING") }`, a program of the same type.
- `try make()` where `make()` returns an Effect with structure of its own, such as Effect's sql `Statement<A>`, a `Config` or a branded Effect, was `EK0502` ("not an Effect"), or for a `.ts` function compiled to a plain call that left the value unrun, while `const s = make(); try s` ran it. The call now runs where `try` stands, gives its success value, and its failures join the function's.
- `EK4805` told an exported class that extends `Error` to become an `error` declaration, whose constructor takes one object, so following it broke callers of `new X(message, options)`, and the migrate flow refused the file. For an exported class it now says there is no quick fix, and the migrate flow keeps the class.
- The migrate flow kept `vibelang --fix` rewrites of an earlier batch's `.vibe` module in another package, such as a `schema error` conversion of `../lib/error.vibe` while fixing `apps/server`, and reported no fix. It now puts back every `.vibe` file outside the batch, wherever it is in the repository.
- Rerunning the migrate flow's setup on a repository an earlier release set up left the `declarationSidecars` setting it had written, so every compile of those packages failed with `TS5023`; setup now removes it from each tsconfig it wires.
- The migrate flow's style gate refused a `Schema.TaggedError` class it must keep (its `EK4837` has no quick fix) because the class keeps its constructor, which `EK4814` warns about. It now accepts that `EK4814` on such a class.
- The migrate flow's verify refused a batch whose published declaration changed only `./runtime` to `./runtime.js`, which the migrated module's importer declares; it now excuses a relative specifier whose two spellings resolve to the same declaration file and lists each such pair in `verify.json`.
- The migrate flow's setup stopped with `the config's plugins is not an array literal` on a Vite config whose `plugins` array carries `as any`, and stopped on any test config it could not wire; it now looks through `as`, `satisfies`, `!` and parentheses, and names a config it cannot wire in its warnings and goes on.
- The `Layer.mergeAll` dependency warning recommended unsupported `wire`; it now points to `Layer.provide` and `Layer.provideMerge`.
- Cross-platform compiler builds could fail without naming the affected platform or its exit status; each target now keeps a completion record and silent failures are identified.
- Chapter 2 did not say where a `Cause` with both a failure and a defect comes from after dropping the wrong `try.any` example; it now names `Effect.failCause` in TypeScript code.
- Chapter 1 showed an `effect` function binding its parameters before `Effect.gen`, as if a destructuring failure threw at the call; it now says the call returns an Effect that dies with the error, as an `async` call returns a rejected Promise.
- The specification omitted the code for `try a ** b`, which ECMAScript-style parsing rejects as it rejects `await a ** b`; chapter 2 and Appendix B now name it `EK0510`, with the fix `(try a) ** b`.
- `vibelang --fix` left `Effect.fn` programs, and `Effect.gen` used as a value, for you to rewrite by hand, and wrote the rest in a direct style that an effect function would not keep (EK1002). It now writes each as an `effect` function or an `effect { … }` block with `try`, keeping `Effect.fn`'s name as a span.
- `vibelang --fix` left `f(x).pipe(Effect.map(g))`, which is EK4502 in a `.vibe` file. It now writes a `.pipe` of an Effect with `|>`, such as `f(x) |> Effect.map(%, g)`.
- The specification did not say that one `vibelang --fix` run reaches a fixed point, or how a missing `vibelang-runtime` is reported; chapter 7 now states both: a second run changes nothing, and a missing runtime is one `TS2307` error naming the package.
- The specification gave no warning for an explicit `throw` in a plain `catch` handler, which turns the failure into a defect; it now names lint warning `EK0511` with the quick fix `catch effect`, and the compiler registers the code (reporting it is tracked by a pending acceptance case).
- Migration rejected an `.mts` module after conversion because its identical declaration moved from `.d.mts` to `.d.ts`; verification now pairs those files while preserving published declaration bytes and rejecting collisions or changed public reachability.
- Migration rejected new private platform-adapter declarations; it now admits unreachable additions as `addedPrivate` while checking published export names, strict types and normalized JSDoc.
- Vite could fail with an unexpected token in a native dependency before evaluating its config; migration setup now preloads `vibelang/register` and selects `--configLoader native` for affected Vite scripts, with the supported config-loading path documented.
- Converting an `async` function in the editor could leave `try` in an unmarked function or skip an arrow's awaited expression. The refactors now write `effect`, handle expression bodies, and preserve comments around the modifier.
- Mixing `Key = value` with `Layer` providers could keep an earlier service implementation; `provide` now uses native `Layer` ordering, scopes and finalization, so the later provider wins.
  `vibelang --fix` retains native `Effect.provideService` calls because replacing them with a block changes scope and memo-map observations.
- Installing `vibelang` alone did not declare the Effect version it supports; the compiler now requires the same exact `effect` peer as the runtime, and release packaging rejects a missing, optional, ranged or mismatched pin.
- Source collectors could silently omit migrated files because their extension allowlists named only TypeScript; migration setup now warns with the file and line when `.ts` appears without `.vibe`.
- Release notes repeated fixes and mixed internal audit records with user-facing changes; the publication list now covers introductory bullets and every unpublished bug list while retaining each product fix once.
- A `Bun.build` with `vibelang-unplugin/bun` could produce a program that failed at startup with a `ReferenceError` inside a CommonJS dependency such as `ws` (Bun 1.4.4), because the plugin's resolve hook matched every relative `.js` import; it now matches a `.js` import only where a `.vibe` module of that name exists.
- Under `bun --preload vibelang/bun` on Bun 1.3.13, `createRequire(import.meta.url).resolve("srvx/node")` resolved from the working directory and failed with `Cannot find module 'srvx/node' from ''`; on a Bun that drops `createRequire`'s origin the preload now leaves the CommonJS hook alone, so `createRequire` resolves from its URL, and a CommonJS `require` of a `.vibe` module names its extension.
- Formatting a `.vibe` file whose `if` block held one statement that dprint guards with a leading `;`, such as `(try x) catch h`, failed with `formatting changed the program: KindExpressionStatement became KindBlock`; it formats now.
- Knip reported an export marked `/** @public */` in a `.vibe` file as unused when no other module imported it, because `vibelang/knip` dropped the comment; each export's stub now keeps the JSDoc written before it, so Knip reads its tags as for TypeScript.
- `vibelang/knip` stubbed each export without its signature, so Knip reported an export as unused when only another export's signature read it, such as `sample` in `export function read(input: typeof sample)`, where the TypeScript passed; the stub now keeps the types a signature reads, outside its body.
- A documented field of a `service` declared `readonly` as a property of its own before the field (`readonly: any` and a mutable field), so consumers of the service shape failed with TS2741; the comment now precedes the whole `readonly` field.
- The migrate flow's setup and Effect upgrade edited the manifests and tsconfigs of packages inside a Git submodule that the workspace named, so the lockfile recorded edits no commit of the parent could hold and a fresh `pnpm install --frozen-lockfile` at the submodule's gitlink failed; setup now leaves every submodule as it is, with a warning for a package the run names inside one.
- Migration rejected private examples and websites when their declarations changed; `verify` now reports `"not published"` for packages marked `"private": true`, while keeping tests, compiler and style checks.
- Passing an Effect-returning resource class where a union's generic data member takes it, as `register<W>(cls: Like<W> | Platform)` or `collection<T extends Like<any> | Platform<any>>(all: T[])`, was EK4301 and could cascade into EK3101; such a value is data there now.
- A JSDoc `{@link Envelope.id}` beside a local `Envelope` made the emitted JavaScript import `Envelope` from `effect/cluster` too, and the module failed to load with `Identifier 'Envelope' has already been declared`; names in comments no longer import Effect modules.
- An inferred return type that meets its own anonymous type again, such as a builder whose method returns `makeBuilder(…)`, failed with `TS5088: The inferred type of 'from' references a type with a cyclic structure` and declared nothing; it now declares the type met again as `/*elided*/ any`, as TypeScript 5.9 and 7.0.2 do.
- A generic call that infers a requirement from an implementation built inside a callback, such as alchemy's `AuthProvider` registering `Effect.gen(function* () { const configure = (name) => (name ? first : second).pipe(Effect.mapError(f)); return { configure } })`, inferred `never` and failed with TS2345; it infers the requirement again, as TypeScript 5.9 and 7.0.2 do.
- A missing `vibelang-runtime` could go unnoticed or expose internal helper-name errors; compilation now reports one `TS2307` naming the dependency and keeps unrelated source errors.
- A migration could need a second `vibelang --fix` run after an import cleanup exposed another fix; one invocation now repeats its passes, and reports any fixes left at its limit.
- Checking documentation examples with a symlinked `TMPDIR` could stop with `Compiler failed` instead of reporting an example's type error; diagnostics now stay attached to their examples and later pages are checked.
- Prettier and `formatSource` could silently keep unformatted `.vibe` input whose path was ignored, including `node_modules`; they now format the supplied buffer and report syntax errors.
- The error-declaration chapter never named `EK1306`, the code for two `error` or `schema error` members on one line with no separator; it now states it beside the separator rule and in its static rules.
- `vibelang lint` with `effecttsgo/unnecessaryArrowBlock` on reported every `effect { return x }` block as an unnecessary arrow block (EK4823), and its quick fix wrote `effect x`, which does not parse; an effect block's braces are its syntax, so only real arrows and effect arrows are reported now.
- Migrating a module could leave extensionless TypeScript imports unresolved; the migration now names the `.vibe` source and accepts its emitted declaration spelling only when both names resolve to the same module.
- The `async` function refactor could keep an object as data instead of adopting its result, even after `return await` or through a `void` return type; it now declines uncertain returns and keeps existing value-discarding returns eligible.
- The migrate flow's codemod and `revert` rewrote imports of a migrated module only inside the run's `--source` directories, so a test under `test/` kept `import … from "../src/Crypto.ts"` after `Crypto.ts` became `Crypto.vibe` and failed to load; they now rewrite every source file the repository tracks.
- `vibelang --fix` rewrote a retired `try(fn, onError, …inputs)` hatch whose error handler was a name, such as `onError`, by passing the handler to `fn` as its first input and dropping the catch, so the fix was refused with a type error; and `--fix-vip-only` marked the hatch's own function `effect`. The second argument now becomes `catch` whatever its form, `undefined` there leaves `catch` out, and the hatch's function stays plain, as Smithers' `agent/fs` needed.
- The migrate flow's setup added `npm:vibelang/dprint-plugin.json`, which has no checksum, to `dprint.json` files that pin every plugin by checksum, and left dprint and ESLint reading the `x.d.vibe.ts` sidecars as source, so Smithers' plugin-pinning test, `dprint check` and its lint failed on the first batch; setup now keeps a pinned configuration's plugins and runs `vibelang-format` in its dprint scripts instead, and adds `**/*.d.vibe.ts` to each `dprint.json`'s `excludes` and each ESLint flat configuration's ignores.
- The migrate flow's setup wired the `.vibe` formatter into a repository's format check but left the `.vibe` files it already had unformatted, so Smithers' `agent/fs` package, with 18 such files from VibeLang 0.0.8, failed `dprint check` before any batch; setup now formats them with `vibelang-format` in its commit.
- A plain function's `try`/`catch` let an exception the compiler does not track pass through, with only `EK9204`, so `try { return new URL(x).hostname } catch { return null }` threw where the TypeScript returned null; the statement is now JavaScript's and catches every exception that reaches it, and where the `try` block has no tracked failure `catch (e)` binds `e` as `unknown`.
- `vibelang --fix` changed `return value` to `{ value; return }` in the generator of `Effect.fn("name")(function* … , pipeline)` when a pipeline argument followed it, as if the generator were a Stream producer (`EK2128`), so the migrated function lost its result; it is now `EK1002` like the generator of `Effect.fn` alone, and `--fix` leaves it.
- Appendix B linked the migration warnings `EK4853`, `EK4854` and `EK4855` to Functions and Services sections that never mention them, and `EK1306` to an error-declaration section that never mentions it. The rows now link the sections that define them.
- Some unary or multiline top-level `await` expressions compiled into output incompatible with the selected target or CommonJS host; they now report `TS1378` or `TS1309`.
- A retained Effect error's extractor, such as `when Cause.TimeoutError(let t):`, did not cover its case, so a `match` that handled every member still reported `EK4701`; its one-binding extractor now covers the case, as the bare pattern does.
- In a `.vibe` file a member of an interface or an object type was readonly to the checker, so `options.minimum = 0` was `TS2540`, while its declaration printed the member writable; such a member is now writable unless written `readonly`, as in TypeScript, and the checker and the declaration agree. The fields of `data`, `schema` and `error` bodies keep their readonly default, and `mutable` is still accepted. The migrate flow's codemod no longer writes `mutable`.
- `when NotFound:` and `when NotFound(let e):` narrowed the subject, and typed `e`, as the `NotFound` class alone, although the generated matcher also accepts a plain object or another package's copy with the tag `"NotFound"`; a `match` over such a member then reported `EK4701` after the arm. They now narrow as `Effect.catchTag` does, to the subject's members with that tag, and keep the class only when the subject has none, so a later arm for another class with the same tag sees `never`: that arm never runs.
- With paired `moduleSuffixes` such as `["", ".d.vibe"]`, VibeLang read a stale declaration sidecar instead of its `.vibe` source and reported incorrect types; it now reads the source and keeps ordinary `.ts` and `.tsx` priority.
- ESLint with `vibelang/eslint` reported `no-unused-vars` on a codec that only a `schema` field names, as in `const Names = Schema.Tuple([Schema.String, Schema.String])` and `schema Locale { names: Names }`; the ESLint tree now writes such a field's type as `typeof Names`, the value the schema reads, in `schema` and `schema error` bodies and `schema X = Type`.
- Import-free `.vibe` files could share globals or report false duplicate declarations with `moduleDetection: "legacy"` or `"auto"`; each source file now keeps its own module scope and emitted module markers.
- The migrate flow's `upgrade-effect` reinstalled with pnpm only, leaving a `bun.lock` kept beside `pnpm-lock.yaml` on the old Effect and VibeLang, and wrote a new override such as `@effect/sql-pg` to `pnpm-workspace.yaml` alone, single-quoted, although Smithers mirrors it in `package.json` with double quotes; each install now also rewrites the other lockfiles, and a new override goes to every overrides table in the quoting beside it.
- An Effect whose success is a function, written where an Effect is expected, was run and its function called as a thunk: `Effect.acquireRelease(Effect.sync(() => detach), (release) => Effect.sync(release))` acquired `void` and reported `TS2345`. Such an argument is now passed as the Effect, and the function is its result.
- The migrate flow's `.vibe` ESLint pass used the root `.oxlintrc.json` for every lint script, over the whole tree, so a script such as foldkit's `oxlint --config .oxlintrc.app.json examples packages/website/src` linted `.vibe` files with other rules and in other directories. Each `oxlint` invocation now gets its own pass, with an ESLint configuration generated from the configuration it names with `-c` or `--config` (`.vibelang/eslint.app.config.mjs`) and the paths it lints.
- The specification's tooling requirements did not say that a repository's Oxlint JS-plugin rules run on `.vibe` files, a decided requirement the migrate flow already meets; chapter 7 now states it.
- The specification wrote a spread element of a `try.allSettled` literal as `...xs.map(Effect.exit)`, which fails on a `Set` and reads an array by index instead of through its iterator; it now spreads natively and wraps each value the spread yields, as the compiler already does.
- That corrected `try.allSettled` counterpart, `...[...xs].map(Effect.exit)`, still spread a second, generated array, so a changed `Array.prototype[Symbol.iterator]` saw an extra call and could reorder the Exits; the specification now builds the literal once, natively, and wraps that array by index, as the compiler already does.
- The specification said `EK4834`, `EK4835` and `EK4836` warn on an "explicitly run" `Effect.succeed`, `Effect.fail`, `Effect.catch`, `Effect.provide` and their siblings without saying what that means, so `fork Effect.catch(e, h)`, the quick fix `EK0505` itself suggests, could be read as warned with no repair; the three rows now warn only on the direct operand of bare `try`, and name `fork`, `join`, `try.all` and its siblings, API arguments and `catch` heads as sites that do not warn.
- The Effect TypeScript reference beside chapter 7's direct-`try` advisory example aggregated `Effect.succeed(2)` where the VibeLang `demo` aggregates `e`, and returned joined results instead of its fibers, so it succeeded while the example fails with `"e"`; it is now that example's counterpart, and a test runs both on the same inputs and compares their Exits.
- Calling a producer whose parameter binding throws, such as `effect function* s({ id }: User)` called with `undefined` from TypeScript, threw a `TypeError` at the call; the call now returns a Stream that dies with the thrown value, as chapter 3 says, and binding still happens once, at the call.
- An Effect type ending in `!!` that touched the next token failed or changed meaning: `const d: number!!= load()` and `effect (x: number): number!!=> x` were syntax errors, and `e as number!!== e` compiled as `e !== e`. The `!` that completes `A!!` is now always its own token, so these read as `A!! = v`, `A!! => e` and `A!! == v`, as the specification says.
- VIP-2's first example of a cold `effect` block called `console.log("hi")`, which VIP-33 bans in VibeLang code (`EK4402`) inside an `effect` block too; it now runs `try log("hi")`, Effect's logger, once per run.
- TypeScript tools could not resolve a `.vibe` import unless its project opted into declaration sidecars; every compile now writes `x.d.vibe.ts`, and `vibelang --fix` removes the obsolete `declarationSidecars` setting from the project and its local inherited configs.
- The Node and Bun loaders compiled a project again when its declaration sidecars appeared; generated sidecars beside their sources now preserve the cached compile, while standalone declarations and source changes still invalidate it.
- With the `@effect/language-service` plugin's `ignoreEffectErrorsInTscExitCode` or `ignoreEffectWarningsInTscExitCode` set, an Effect lint diagnostic such as `EK3801 floatingEffect` still made `vibelang` exit 2 and blocked emit under `noEmitOnError`, because the options recognized only Effect's own diagnostic codes, not the `EK38xx` codes VibeLang prints; they now cover every imported rule again, as in 0.0.8.
- The migrate flow missed directory imports such as `./runtime/` and could rewrite one as `./runtime/.vibe`; it now keeps the selected index module and writes `./runtime/index.vibe`.
- The migrate flow could miss errors and repair notes in compiler output with Windows line endings, or mistake a normal error exit for a compiler crash; it now reads those diagnostics and notes correctly.
- The tooling specification linked to private numbered decisions for configuration, diagnostics, and lint rules; it now links to the accepted public VIP amendments.
- The specification gave no home for an `is` binding in an `enum` member initializer, and the match guide said only `for-of` heads copy bindings per iteration; such a binding is now `EK0705`, as in a parameter default, and the guide states the `for (;;)` copies too.
- After an edit, hovering a call passed by name as an argument, such as `greeting()` in `Effect.timeout(greeting(), "1 second")`, said `Runs here`, although the compiled code passes it to `Effect.timeout` as a program; the hover now says it is passed by name and runs when that program runs.
- `vibelang --fix` built and checked the project twice for each round of fixes that passed, so a file with nested fixes, which take a round per level, took twice as long as it needed: 20 nested `Effect.Effect<…>` types took about 10 seconds on a busy machine. Each passing round is now checked once, and that file takes about 5 seconds.
- In a project with no `declaration` setting, an export whose inferred type was too long to serialize (`TS7056`) got only a warning, and its declaration sidecar held `any` in place of the type, so a stock `tsc` consumer lost its types without an error; it is an error again, as it is where the project emits declarations.
- Installation guides list the native packages published for the selected release, with WSL guidance until native Windows packages are published. Linux x64 is the platform used for the npm and Bun starter rehearsal.
- The editor action "Convert to a VibeLang function with an error per await" on an `async function` declaration without `export` produced overlapping edits, which editors reject; the inserted error declaration now comes before the edit that removes `async`.
- `vibelang-format` failed with `internal error: the TypeScript form does not parse` on a valid return type that is a union of parenthesized contracts, such as `(ok: boolean): (void!never!never) | (never!Missing!never) => …`, and printed the whole file's TypeScript form; it now formats the file, and such an error shows only the line that does not parse.
- Under Bun, `vibelang/bun` loaded a `.vibe` module only through a relative import, so an import through a tsconfig `paths` alias, such as `@/x` with `"@/*": ["./src/*"]`, failed with `Cannot find module '@/x'` once `x.ts` became `x.vibe`; the preload now resolves the alias to the `.vibe` module TypeScript resolves it to.
- An `error` declaration with no fields, such as `error Timeout`, declared `extends Timeout_base<{}>`, where `class Timeout extends Data.TaggedError("Timeout") {}` declares `extends Timeout_base`, so `--fix` changed the declarations of every fieldless `Data.TaggedError` class it rewrote. It now declares `extends Timeout_base`, as the TypeScript does.
- The specification’s appendices cited eleven rules by their numbers in a private decision log. They now cite the VIP amendments that record them (VIP-3, VIP-4, VIP-5, VIP-7, VIP-12, VIP-34 and VIP-38).
- Generic `error` declarations previously compiled; both error forms now report `EK1303`, and `vibelang --fix` preserves plain generic errors as Effect TypeScript classes instead of suggesting an unsupported declaration.
- Error declarations previously accepted setters; both error forms now report `EK1302`, and `vibelang --fix` preserves the setter in an Effect TypeScript class.
- Error declarations previously accepted user-written `static` members; both error forms now report `EK1302`, and `--fix` preserves them in an Effect TypeScript class. The class migration preserves reference directives and documentation when it adds an import.
- `error` and `schema error` declarations accepted `implements` clauses; they now report `EK1304`, and `--fix` removes the clause without changing runtime behavior.
- The migrate flow's declaration identity check failed a module whose declaration lost only redundant type parentheses, such as `() => (<A>(value: A) => A)` after `vibelang-format`; it now ignores redundant parentheses and still fails a change of precedence, such as `(A | B)[]` to `A | B[]`.
- The migrate flow's `upgrade-effect` moved `vibelang` to the new release but kept the `patchedDependencies` entry for its old version, which pnpm refuses as unused (`ERR_PNPM_UNUSED_PATCH`), and left `vibelang-unplugin` on the old release, so Smithers' upgrade could not install; it now drops a patch the new release already contains, moves one that still applies, stops with the patch's name on one that does neither, and moves `vibelang-unplugin` with the other packages.
- The migrate flow's `verify` rejected a `Schema.TaggedError` class that `EK4837` says has no quick fix, such as one with an annotations argument like `{ httpApiStatus: 400 }`, although no schema error declaration can keep it, so such a file could never pass; `verify` now accepts it, and the warning stays.
- In a project without the `@effect/language-service` plugin, any `vibe.severities` entry turned on every Effect lint, so setting only the VibeLang warning `"EK4842": "off"` reported `EK3801` and hundreds of other lint diagnostics in existing `.ts` files; only an entry for an imported `EK38xx` code turns them on now.
- The migrate flow left Oxlint linting the declaration sidecars, `x.d.vibe.ts`, which it reads as TypeScript, so a repository's lint failed on generated text; setup now adds `**/*.d.vibe.ts` to the Oxlint configuration's `ignorePatterns`.
- The release publisher ignored an explicit `--otp` password and prompted again; it now forwards that password to npm, accepts it with `--dry-run` in either order, and rejects unknown options before doing any work.
- The configuration specification incorrectly based every inherited path on the declaring config. It now distinguishes ordinary relative paths from `${configDir}`, which uses the selected project config’s directory, matching TypeScript.
- A predicate pattern whose parameter had a type, such as `when isText:` with `isText(s: string | number): s is string`, narrowed the subject to the function's type, so `s.toUpperCase()` in the arm and `s.toFixed()` in `default` did not compile, and a call-only extractor with a typed parameter bound `any`. The arm and `default` now narrow as `if (isText(s))` does, and the bindings take the extractor's element types.

- `vibelang --fix` deleted `import * as Schema from "effect/Schema"` when a `Schema.TaggedError` class was its only use, and rewrote a class whose module has another name, so the declaration file changed; in a project that emits declarations it now keeps the import and leaves such a class.
- `e catch h` did not run `e` when `e` was an Effect value, a yieldable error or an `effect` block, so `effect { … } catch () => "Untitled"` gave back an unrun Effect, with only a false `EK9204` warning; the catch now runs it, as the language reference says.
- The specification gave no diagnostic code for two members of a `service`, `error`, `schema` or `data` body written on one line with no separator, and the compiler printed TypeScript class or interface messages for it; the specification now assigns `EK0908`, `EK1306`, `EK1504` and `EK1605`, each with a quick fix that inserts `;`.
- The specification told the formatter to wrap long `provide` lists in `Layer.mergeAll(…)`, a semantic rewrite it never performs. It now says a long list stays on one line.
- Ordinary formatter styling could be rejected for changing emitted token spellings; preservation checks now compare parsed meaning and declarations while retaining diagnostic, directive and source-map checks.
- The specification’s Functions chapter cited thirteen rules by their numbers in a private decision log. It now cites the VIP amendments that record them (VIP-1, VIP-3, VIP-4, VIP-5, VIP-27, VIP-28 and VIP-33).
- The specification’s introduction cited three rules by their numbers in a private decision log, which a reader of the repository cannot look up. It now cites the VIP-7 and VIP-38 amendments that record them.
- The specification’s grammar used `Name` and `ReturnType` in its `effect` function productions without defining them, so it did not say whether `fork` or `join` could name an `effect` function expression. It now makes `const f = effect function join() { }` `EK1702`, as an `async` function expression named `await` is a syntax error, and keeps a declaration such as `export effect function fork() { }` in plain code valid.
- `when Array(let n):` bound the whole array, a typed-array extractor bound the whole value, `when pair(let a, let b):` threw at run time when `pair` was a plain function, and a class whose matcher declared its hint as `{ matchType: "extractor" }` typed its bindings as the class instance. `Array` and typed arrays now list their elements, as the proposal says, a plain function is called with the value and `{ matchType: "extractor" }` and returns `false` or the values, and the matcher's declared return type types the bindings.
- The headless editor check waited for request timeouts after its language server crashed, and could write to a closed pipe; it now reports the affected request and exit cause immediately and cleans up pending requests.
- Formatting comma-separated `error` and `schema error` fields beside methods or getters failed with an internal error. These bodies now format while preserving their separators, comments and diagnostics.
- `vibelang-format` and the `vibelang/prettier` plugin wrote double quotes and wrapped at 120 columns whatever the repository's formatter settings said, so in a repository such as foldkit (Oxfmt, `singleQuote`, `printWidth: 80`) `.vibe` files differed in style from its `.ts` files. They now take the quote style and print width from the repository's Oxfmt, Prettier or dprint configuration, or from Prettier's options.
- Under Bun, the loader and bundler plugins failed with `ENOTDIR` on a relative import of a file that is not a script, such as `./prompt.txt`, which broke `Bun.build` in a project that imports text; they now leave that import to Bun.
- Running the migrate flow setup again kept an existing `.vibelang/eslint.config.mjs` where the lint script already ran it, so a project kept the rules of the older config; setup now writes the config again.
- The migrate flow skipped a named Vite config such as `vite.node.config.ts`, with no warning, so a build that loads one failed on the first `.vibe` module; setup now adds `vibelang-vite` to it, or warns where it cannot.
- After the migrate flow moved a module to `.vibe`, a test that mocks it with an extensionless path, `mock.module("../src/mini", …)`, silently ran the real module; the codemod now rewrites that path to `../src/mini.vibe`.
- The migrate flow's `verify` rejected a `Context.Service` class that `EK4831` says has no quick fix, such as one with a named shape or static members, although no service declaration can keep its declaration, so such a file could never pass; `verify` now accepts it, and the warning stays.
- The specification described `async match` without connecting it to Appendix A. Explicit primary-expression productions now connect match bodies and the independent async context, including its line-break and jump restrictions.
- `vibelang --fix` crashed with a nil pointer dereference when `EK9203` was reported at a return annotation that is itself a function type, such as `(): () => Effect.Effect<number, never, never> => { … }`. It now looks for the helper behind the annotated functions first Effect call and writes that helpers return type, or leaves the annotation alone when there is none.
- In the editor, expanding the selection from `resume` inside a `handle` clause produced a range that started at `resume` and stopped before the call's `)`, nested inside `resume` itself; the selection now grows from `resume` to the whole `resume(…)` call.
- The interruption-block placement rule counted `restore` twice. It now names the three forms governed by `EK2201` explicitly.
- The Promise comparison omitted existing operand and syntax restrictions and left its catch result unawaited. It now lists those differences and shows the handled result being awaited.
- The migrate flow stopped with "vibelang emitted no declarations" on a package whose tsconfig is solution-style, `"files": []` with `references`; it now checks, fixes and declares each referenced project.
- In a project that emits declarations, `--fix` deleted an `import type` or `{ type X }` import of an Effect module that an export names, so the declaration imported it as a value where TypeScript keeps the modifier; `--fix` now keeps such an import.
- The `match` documentation could reject an already covered shared tag by using TypeScript's whole-object narrowing as its test; it now counts each member's recognized tag cases, including plain objects matched by an error tag. The optional `_tag` example now identifies the absent case that remains uncovered.
- The public schema-error decision called every encoded value JSON; it now distinguishes codec encoding from serialization and shows how a string codec makes bigint transport possible.
- The region-body example wrapped one bound provider in an array despite the single-provider rule. Its counterpart now passes that layer directly.
- Constructor docs promised that typed payloads could not throw. They now distinguish the static `never` contract from native getter, `intercepted object` and property-copy failures, which remain defects in effect code.
- The spec's generic-contract example bridged its call with the one-argument `Effect.try`, which fails with `UnknownError`, while its TypeScript counterpart failed with the thrown value. Both now use the `try`/`catch` form, and the constrained generic call has its VibeLang source.
- An invalid child severity could restore a base config's error setting; it now reports the config error and uses the diagnostic's normal fallback while keeping other valid settings.
- The severity reference left invalid-entry recovery unclear; it now explains independent recovery after inheritance and that invalid child entries do not restore overwritten base settings.
- The specification did not say where an `is` binding in a `for` head, a concise arrow body or a field initializer lives, and its examples compiled a read of a skipped binding; it now gives each home, and a read where the binding may not have run is TypeScript's `TS2454` or `TS2448`.
- The specification implied every schema error could cross JSON unchanged. It now explains that transport compatibility follows the chosen encoded representation, with a bigint-to-string codec for JSON and no hidden conversion.
- Incomplete `service`, `schema` and `data` declarations, and a `service` in an ambient context (`declare service`, or one inside `declare namespace`, `declare module` or `declare global`), had no diagnostic codes in the specification; it now names their existing rejections `EK0906`, `EK1503`, `EK1604` and `EK0907`, and keeps valid empty bodies, schema aliases and bodyless errors.
- The specification’s grammar accepted a pipe as the unparenthesized test of a conditional, `x |> f(%) ? 1 : 2`, which the pinned pipe proposal rejects. It is now a syntax error; write `(x |> f(%)) ? 1 : 2` or `x |> (f(%) ? 1 : 2)`.
- Three `.vibe` examples in the specification’s Functions chapter wrote `Effect.Effect<…>` types, which the default `EK4833` lint warning flags. They now use the `A!E!R` shorthand that warning suggests, such as `User!NotFound!Users`.
- The specification gave `abstract effect` and `declare effect` two diagnostics, did not recognize `effect` on interface and type literal members where `EK0108` applies, and left the type of an unannotated `effect` overload signature unstated. It now reports `EK0108` there, keeps TypeScript's `TS1222` for a starred signature, and gives an unannotated signature `any` with `TS7010`, as for `async`. An optional `R` named `as` at a line end now follows TypeScript's semicolon insertion.
- In the specification’s Functions chapter, a paragraph about `async` declaration contracts separated the rule that an effectful plain function can’t throw from that rule’s example. The paragraph now sits with the callable-contract witnesses it qualifies, and the example follows its rule.
- The specification’s rule for marking a detail **Undecided (pending VIP)** still counted unpublished rulings and decided details as deciding sources. It now names only accepted VIPs, their public amendments and the TypeScript or pinned TC39 counterpart, as the specification’s opening does.
- Duplicate data variants reported a legacy error only on the repeated name; they now report TypeScript’s `TS2300` on both source names, matching duplicate fields.

- The diagnostic appendix omitted historical code changes and left a retired code unmarked; it now lists the changed meanings and keeps the old bodyless-declaration code retired.
- Safe-looking built-in calls had unclear throw contracts, and padding counts were treated like `repeat` counts. The spec now uses each selected signature’s full contract, follows JavaScript’s padding rules, and wraps affected examples and their callers.
- Schema `Record` types could lose required or readonly keys through a referenced value schema; conflicting or uncertain decoded key flags now report `EK2109`, and `vibelang --fix` retains explicit Effect codecs with the same declarations and decoding.
- Empty type argument lists on schema references, such as `Address<>`, were silently ignored; they now report `EK2109`, and `vibelang --fix` removes them while preserving comments and decoded values.
- The specification gave no diagnostic code for a `return`, `break` or `continue` that leaves an `async match`; it is now `EK0706`, and a nested function keeps its own `return`.
- Repeated computed payload fields were described as unconditional duplicate-name errors; they now retain TypeScript’s member merging and compatibility checks.
- Computed keys were described as sharing one admission rule; schema keys now follow their runtime object-literal checks and evaluation, while data payload keys retain TypeScript type-member checks and erasure.
- Legacy configuration guidance omitted supported severity settings and their precedence; it now explains both legacy paths, inheritance, modern overrides and migration warnings without changing current lint repairs.
- A labeled `continue` from a `for concurrent` item to an enclosing loop reported a TypeScript function-boundary error; it now reports `EK1905` and explains how to end the item.
- Producer documentation kept callback-owned `Scope` as an external requirement; it now shows only the other services that consumers must provide, while preserving checks on written annotations and emitted values.
- A signed zero pattern, `when -0:` or `when +0:`, matched both zeros and counted as covering `0`; it now matches only that zero, as `Object.is` does, and a `match` without `default` whose only zero arm is signed reports `EK4701`.
- An explicitly `readonly` schema field could acquire a writable decoded key through a referenced codec; conflicting or uncertain readonly flags now report `EK2109`, with preserving `--fix` expansion to explicit codecs.
- Editor completion was empty inside the iterable expression of a `for concurrent` loop; it now offers in-scope names there while preserving completion behavior in function parameter lists.
- A call signature in a service body, such as `(value: string): string`, failed with a cascade of syntax errors; it now reports one `EK0902`, and the rest of the service still checks.

- A `match` arm without its `;`, or with `,`, compiled when a new line or `}` followed it, and `match (b) { }` reported a missing case or nothing; a missing separator is now `EK0701`, with a quick fix and `vibelang --fix`, and `match (b) { }`, a second or early `default`, a missing `:` and an interpolated template pattern are `EK0707`.
- A `catch` handler whose only parameter was named `async`, `of`, `from` or `get`, as in `task catch of => of.length`, failed with `TS1005`; contextual keywords now work as handler parameters, as they do in any TypeScript arrow.
- Editor parsing rejected `for try` `Stream` loops; the tree-sitter grammar now recognizes the loop and its `continue` and `break` statements.
- In a project that emits declarations, `vibelang --fix` removed an import such as `import * as DateTime from "effect/DateTime"` that the declaration file still printed, through a local type an export names (`type NonNull<V> = V extends DateTime.Utc ? …`), a conditional type or a written `keyof DateTime.Utc`, so the declaration imported `{ DateTime } from "effect"`; `--fix` now keeps every import the file's declaration keeps.
- The ESLint configuration the migrate flow generates for `.vibe` files left out the rules of the repository's Oxlint JS plugins, so foldkit's 17 `foldkit/*` rules never ran on its `.vibe` files. It now loads each plugin in `.oxlintrc.json`'s `jsPlugins` under the name Oxlint gives it and runs its rules and overrides on `.vibe` files.
- EK4301 rejected an Effect-returning value passed to a union such as `ResourceClassLike<R> | Platform` even when the value fit only the member with no call signature, as alchemy's `Provider.effect(Resource, …)` does; such a member now takes the value as data.
- The migrate flow formatted a batch's `.vibe` files after the last compile, so each batch committed a stale `.d.vibe.ts` and the next batch's commit carried the difference; `record` now compiles again when formatting changed a file.
- The migrate flow's `step revert` restored a file from the batch's parent commit, so it could not return a module an earlier batch had migrated, as foldkit's round 3 needed for 26 modules a later lint crash blocked; it now restores such a module from before the batch that migrated it and undoes that batch's import edits.
- The specification left parameter suspension outside its diagnostic rules and tied invalid Effect-body yields to an outer producer; the same source boundaries now cover formal initialization and every nonproducer Effect body.
- Several recent fixes were listed under the previous published release; their notes now appear with the release that includes them.
- The platform guide put `Intl` in the web allowlist and suggested a nonexistent `Path.fromFileUrl` shortcut; it now identifies `Intl` as an ECMAScript global and shows access through the `Path.Path` service.
- The pattern documentation omitted an `is` comparison and its binding scope; it now shows the Boolean test, explains block visibility and TDZ, and distinguishes skipped initialization from a later failed guard.
- The declaration reference omitted diagnostic codes for direct default `schema` and `data` exports and for schema type parameters; it now assigns `EK1501`, `EK1603` and `EK1502` and shows named exports and generic factories as repairs.
- The accepted schema example still gave writable source fields readonly TypeScript types; its counterpart now uses `Schema.mutableKey`, and the public schema VIPs record the conservative checks for conflicting referenced-schema modifiers.
- The public service decision omitted the recursive `Shape` binding and outer-generic capture rule; it now records the private recursive alias, its type-only projection and the generic-service rejection for a shape that would specialize one key through erased outer type arguments.
- The schema-error reference could admit a reserved `_tag` key hidden by a generic, enum or brand; it now requires proof over the runtime key domain and preserves the generated discriminant without a runtime guard.
- The public pattern decision omitted the binding-cell lifetime rules; it now records shared `or` cells, fresh loop-condition cells and the initial `do` body's TDZ, with checked closure witnesses.
- The reserved data helper-name diagnostic appeared outside its rules table; it now renders as a table row.
- The Effect operand examples omitted `Exit` and `Config`. They now show both and make clear that structural assignability, rather than a list of type names, decides admission.
- The `async match` reference attributed its body grammar to an unvendored `async do` draft; it now states the accepted grammar contexts explicitly and shows that nested source functions keep their own `return` context.
- The `for try` ownership rule could imply that plain child forks ended with an item; it now names the current consuming fiber as owner, so those children can survive successful loop completion.
- Iterator guidance promised cleanup for every JavaScript error; it now follows native closing decisions and distinguishes abandoned `Effect` execution from JavaScript unwinding, including defaults after exhaustion.
- The pattern reference left parameter-default binding scopes undefined; it now assigns `EK0705` to an `is` binding needing that unsettled parameter home and shows explicit block-local repairs.
- A required schema tuple position could disappear when its schema reference carried optional-key flags; it now reports `EK2109`, and `vibelang --fix` preserves existing decoding with explicit Effect codecs.
- A writable interface or object-type property became `readonly` in emitted declarations, preventing TypeScript consumers from assigning to it; declarations now keep the source's property and index-signature modifiers, including optional and nested members.
- The specification's table of where `try` may run, like `await`, had no row for decorator expressions. A decorator expression such as `@(try d)` now runs in its enclosing context, as a computed class key does, matching TypeScript, which admits `@(await d)` in an `async` function and reports `TS1308` in a plain one.
- Severity settings for TypeScript-form lint warnings reported `EK3006` and were ignored; every warning listed in Appendix B now accepts `vibe.severities` overrides.
- `EK4837` told you to replace a `Schema.TaggedError` class with `error`, which drops its Schema, and had no fix; it now names `schema error`, also reports a class with accessors, and `vibelang --fix` writes the declaration.
- The migrate flow refused to commit a file whose comment mentioned `file://`, reading it as an absolute path of the machine; it now needs a path after the slashes.
- A contract written in parentheses in a union, `(string!never!never) | number`, kept its parentheses in the declaration, `(Effect.Effect<string, never, never>) | number`, unlike the TypeScript's; the declaration now drops them.
- A migrate run that switched to a new toolchain committed `upgrade Effect to <version>` although Effect did not change; that commit now says `switch to the toolchain of VibeLang <commit>`.
- Under `noImplicitOverride`, a service's `static readonly key` and `static readonly defaultValue` reported `TS4114`, though the spec and `--fix` write them that way; they now take no `override`.
- `service S extends Base { }` and `service S implements I { }` failed with a parse error, `TS1005: '{' expected`; they now report `EK0904`, which says a service's identity is its key and to compose shapes with types.
- The specification's list of where `try` differs from `await` compared `for try` only with an assignment head, though `for await` also accepts `var`, `using` and `await using` heads. The row now says `for try` rejects every head other than a `const` or `let` declaration (`EK2005`).
- A migrated package whose script runs a program under Bun, such as `bun alchemy-test`, failed with `Export named ... not found` on each `.vibe` module, because setup wrote only the `[test]` preload, which `bun test` alone reads; setup now also writes the top-level `preload` in that package's `bunfig.toml`.
- A `Bun.build` script in a project the migrate flow moved failed to bundle any `.vibe` module, because setup wired only `vibelang/bun`, a runtime plugin that bundles do not use; setup now adds `vibelang()` from `vibelang-unplugin/bun` to each such script and warns about a build it can't edit.
- The migrate flow renamed a module that a package exports, by name or by a pattern such as `"./*": "./src/*.ts"`, without updating `package.json`, so every import of it by package name failed; the codemod now points the entry at the `.vibe` source, revert takes that back, and setup preloads `vibelang/bun` in each package that runs `bun test` and reaches a migrated package.
- `try conf` with `conf` a `Config`, an Effect intersected with a brand, or a value of an interface that extends Effect reported EK0502 though its type came out right; `try` now runs such a value.
- Parentheses inside `Readonly<Record<K, V>>` schema declarations were rejected; grouped arguments now map to the same readonly record schema.
- The specification split `for concurrent` limits into "above 1" and "at or below 1", which left `NaN` in neither: it said nothing about whether a `NaN` limit forks each item or materializes the iterable. It now follows Effect's own resolution, `Math.max(1, n)`: only limits resolving to `1` run on the enclosing fiber, and every other limit, `NaN` included, forks one fiber per item, so a `NaN` limit runs one item at a time, materializes the iterable first, and interrupts each item's `fork` children when the item ends.
- A local value named `Data` could capture the builders generated by a `data` declaration; generated references now keep the Effect module while source references keep the local value.
- The specification said a `try` or `yield` in any default runs in the enclosing effect function, while its next paragraph says a parameter default can't run an Effect. It now says that only a destructuring default in effect code suspends, as `await` does in an `async` function, and that a parameter default can't.
- The `catch` head rule left erased TypeScript wrappers ambiguous. It now follows them consistently while preserving explicit source parentheses as a boundary.
- Dynamic imports were implicit in the specification's Promise-call list and their failure phases were unclear. The bridge trigger now names runtime imports, distinguishes argument throws from Promise rejection, and leaves type queries erased.
- The specification defined effect code as Appendix A's Effect-parameter code minus class field initializers, which that grammar never parses with the parameter, and said `fork(x)` and `join(x)` keep their TypeScript meaning everywhere outside effect code. The definition now follows Appendix A: class field and enum member initializers parse without the parameter, while a parameter list or `static` block keeps its reservation, so a `join(p)` parameter default is `EK1701`, as `await` there is a SyntaxError.
- The `match` specification left constrained generic subjects ambiguous; it now checks their finite constraints, honors represented TypeScript flow refinements and preserves ordinary literal types.
- Migration instructions omitted `--fix` from a scoped codemod command; both scope flags are now documented and tested with `--fix` in either argument order.
- A provider-comma line break could lose its documented keyword classification; recoverable heads now retain `provide` and `EK1202` on either side of the separator.
- Effect type fixes could suggest invalid bang syntax directly after `extends` or `implements`. Those base types now keep their named spelling; nested type arguments remain eligible for shortening.
- A helper return-type quick fix could write an imported type name that was out of scope and be refused by `--fix`. It now qualifies the type through its import, or uses `infer _` when a type cannot be written there.
- `vibelang --fix` could refuse a safe rewrite inside `Effect.catchTags` because an existing error quoted its old arguments. It now keeps that diagnostic's identity while applying the rewrite.
- Host timer and object-URL methods could escape checks through aliases, interface augmentations, or static `globalThis` constructor keys; those reads now consistently report `EK4402` while pure helpers and local implementations remain valid.
- `when undefined:` and a pattern naming a contextual keyword such as `of` or `type` failed with `pattern expected`; both now parse as the literal or name they spell, in `match` and in `is`.
- Running the migrate flow's setup again left the earlier setup's `.vibelang-toolchain` tarballs on disk, where `jj` committed them with the new setup; setup now removes that directory before it returns to the Effect upgrade.
- In the specification's region-body rules, a paragraph about `do` checks sat between the sentence ending "how it transports completions is its choice:" and the list it introduces, so it read as that list. The paragraph now follows the list.
- `vibelang --fix --fix-vip-only` removed the `try` of a plain call that gives a yieldable error, `return try toError(id)`, so the error became the program's success value, and `--fix` did the same to `yield* toError(id)`; both now write `throw toError(id)`, keep `try` where no statement can throw, and write `try x.asEffect()` for an `Effect.Yieldable`.
- The migrate flow's setup edited a vendored repository that no workspace names (foldkit's `repos/effect`): its `package.json` scripts, `dprint.json` and tsconfig files; setup now wires only the root and the workspace's own packages, as the Effect upgrade does.
- The specification named no diagnostic for `fork.other e`, `fork.in(5) e`, `try.map x`, `for concurrent("fast")`, a reserved `{ join }` shorthand, or a `using` head in `for concurrent` or `for try`, and Appendix B omitted the compiler's `EK1802` for the retired `await.all` operations. They are now `EK1705`, `EK1706`, `EK1803`, `EK1907`, `EK1702`, and `EK1906` or `EK2005`, with an `EK1802` row, in chapter 2 and Appendix B.
- An explicit empty service key, `static readonly key = ""`, was replaced with a derived name; `""` now keeps its identity at runtime, in declarations and in duplicate-key checks.
- `Effect.Array`, `Effect.String`, `Effect.Record` and the other Effect modules named like a JavaScript or TypeScript global reported `TS2339` in a `.vibe` file, so the specification's `Effect.Array.head(xs)` did not compile; each now names Effect's module, and the emitted code imports it.
- A type under one of those modules, such as `Effect.Array.NonEmptyReadonlyArray<number>` or `Effect.Record.ReadonlyRecord<string, number>`, reported `TS2694`; it now names the module's type, and the declaration file writes it as `import("effect/Array").NonEmptyReadonlyArray<number>`.

- A service with `static readonly defaultValue` could be written as a type, `let flags: Flags`, and the declaration file then used the `Context.Reference` constant as a type, which broke TypeScript consumers; that type now reports `TS2749` (`TS2694` in an import type), and `Flags.Shape` and `typeof Flags` still work.

- A type query of one of those modules, such as `typeof Effect.Array` or `typeof Effect.Array.head`, reported `TS2339`; it now names the module, and the declaration file writes `typeof import("effect/Array")`.
- The concurrent-loop ownership example passed a string to `sync`, which requires a thunk. Both calls now use valid thunks, with a matching Effect counterpart.
- Computed field names appeared interchangeable between `error` and `schema error`. The specification now uses each native counterpart's key checks and retains TypeScript's `TS1170` for rejected payload key forms.
- The specification described plain error payload keys as runtime reads, incorrectly implying a later key binding would fail. Plain payload keys are now explicitly erased type members; schema keys and method names keep their runtime evaluation.
- A `.vibe` file with no Effect form still declared an inferred `Effect.Effect<A, E>` and imported `Effect`, as `Runtime.makeRunMain` did, where TypeScript writes `import("effect/Effect").Effect<A, E>`; the name now appears only in a file that writes it or has an Effect function, `A!E!R`, `try` or a bare Effect global.
- Effect lint instructions named only `.vibe` files; they now explicitly cover selected `.ts` and `.vibe` inputs with the upstream rule eligibility and file exclusions.

- The specification left diagnostic coverage unclear for concurrent operations other than `try.all`. It now states the same context and operand checks for all four operations, with the existing error codes.
- The specification left the ending check for `do` undefined for empty switches and VibeLang loops. It now uses an explicit empty-switch base case and the native iteration checks, preserving nonfinal values and rejecting final loops.
- Service default initializers had an unspecified Effect boundary; they now follow source class-field rules, with Effect-based factories computed before the declaration.
- Effect functions and methods inferred `void` for throw-only or mixed throw/fallthrough bodies; they now infer `never` or `undefined`, matching `Effect.gen`.

- Service shapes with properties named `key` or `defaultValue` were rejected when the service declared the matching identity or default factory; these ordinary implementation properties now work.

- Service members using a direct `this` type compiled when TypeScript rejects the corresponding shape; they now report `TS2526` and explain how to use a named type or interface.

- The migrate flow failed a batch on `EK4832` for an exported `Schema.Struct` constant with no type export, which `--fix` must leave because a `schema` declaration would add a public type; `verify` no longer counts it.
- The ESLint configuration the migrate flow writes for `.vibe` files enabled typescript-eslint's recommended rules whatever the repository's Oxlint configuration chose, so a rule the repository turns off, such as foldkit's `no-explicit-any` under `packages/foldkit/src`, failed its lint on migrated files, and the rules it enables never ran on them; the configuration now reads `.oxlintrc.json` on each run and applies its rules and overrides wherever ESLint or typescript-eslint has the rule.
- The migrate flow's `--fix` dropped an Effect import the declaration file prints when a tsconfig set `noEmit`; it now asks for declarations, whatever the tsconfig says.
- `vibelang lint` ignored the Oxlint and ESLint disable comments a migrated `.vibe` file keeps, such as `// oxlint-disable-next-line effecttsgo/schema-sync`, and reported the rule anyway; it now honors them as Oxlint does.
- The migrate flow left a `Data.TaggedError("E")<{ … }>` field unmarked, so the migrated `error` declaration declared it `readonly` where the TypeScript's declaration did not; the codemod now marks it `mutable`.
- The sidecar guide listed `bun check` without requiring a `check` script, so the documented command failed in a new Bun project. It now explains how Bun invokes the project's TypeScript checking script.
- The `knip.config.ts` the migrate flow writes held a type assertion, `{ … } as { ignore?: … }`, so a repository whose Oxlint or ESLint forbids type assertions (`typescript/consistent-type-assertions`) failed its lint on the migrated configuration. It now declares the type, `const config: { ignore?: …; [setting: string]: unknown } = { … }`.
- The formatter sorted the names within an import or export, case-insensitively, so `import { Option, String, flow }` became `import { flow, Option, String }` and a repository's Oxlint or ESLint `sort-imports` rule then failed on the formatted file. The names now keep the order you wrote.
- A tool that reads a `.vibe` file through the TypeScript mapper, such as Oxlint through the Oxc fork's VibeLang hook, reported `TS1338: 'infer' declarations are only permitted in the 'extends' clause of a conditional type` at each `: infer _` return annotation, because the mapper kept it in the TypeScript it returns. The mapper now drops the annotation, and TypeScript infers the return type from the body, as `infer _` means.
- Appendix A still described one modifier diagnostic after the error-member rule had been corrected. It now preserves the full applicable Functions diagnostic set without a redundant error-body category.
- Schema references could silently make required fields, tuple slots or record keys optional, or readonly fields writable. The specification now rejects conflicting decoded-key flags with `EK2109`, including implicitly readonly schema-error payloads.
- Service reads such as `try Users` were rejected as non-Effects; service keys now pass the Effect operand check.
- Rejected pattern syntax such as primitive template interpolation had no assigned fallback code; the reference now uses `EK0707` while preserving specific pattern diagnostics and independent TypeScript errors.

- Service bodies and value initializers reported a legacy error and suggested making the member static; they now report `EK0902` and direct the implementation into a layer. Members in an aliased-shape service body use the same member diagnostic.
- A `data`, `schema` or `error` declaration with its opening brace on the next line gained extra indentation on its first format pass; it now reaches its final indentation in one pass.

- A `try` in a service's `defaultValue` initializer reported `EK0501` with advice to make `defaultValue` an effect method, which a service cannot declare; it now explains how to compute the value before the declaration and capture it in the default factory.

- The migrate flow ran `vibelang --fix` over a whole package for each batch, which rewrote files earlier batches had committed and undid their hand repairs; each batch now keeps the rewrites of its own files only.
- The migrate flow's rules told the repair agent that a function with no Effect operation stays plain, while the toolchain compiles an unannotated function or method to an Effect; the rules now say to write its return type or `: infer _`, and list the skill's forms the toolchain does not implement yet with what to write until each lands.

- A `.vibe` file in a project without `vibelang-runtime` or `effect` installed reported only `Cannot find namespace 'Effect'` or `Cannot find name 'TaggedError'`, and its exports declared `any`; each such error now names the package that supplies the name and says to install it.
- EK4833 warned on `interface Api<A> extends Effect.Effect<A, never, never>`, where `A!E!R` cannot stand and its quick fix was refused; it now skips an interface's `extends` element and still rewrites an Effect type nested in its type arguments.
- The migrate flow added `vibelang` to the `devDependencies` of every package whose lint script it extended with the root ESLint config, which resolves `vibelang/eslint` from the root, so Knip reported it unused in each such package; setup now adds it only to the root and to packages whose own scripts run `vibelang-format` or the Prettier plugin.
- A file that imports Effect's modules as namespaces, `import * as Context from "effect/Context"`, got a declaration file that imported `{ Context } from "effect"` for a `service`, or `{ Context as Context_1 }` beside its own import, and `--fix` dropped the import or shortened `Duration.Duration` to `Duration`, which printed another alias. The declaration file now uses the file's own import, `--fix` keeps it, and `noUnusedLocals` accepts it.
- Running the migrate flow's setup again on a new toolchain committed, then stopped at `Refusing to move bookmark backwards or sideways` and wrote no `setup.json`; the new setup now replaces the earlier one, and a bookmark with a recorded batch on it still refuses.
- The migrate flow never told a batch that a `node` script reaching a migrated module needs `--import vibelang/register`, so the script failed on the `.vibe` import; the migration rules now say so.
- The return-type quick fix of EK1001, EK9203 and EK4301 printed a type from another module or a namespace by its bare name, which in a `.vibe` file can name a prelude module (`: string | Ref<Any>` wrote Effect's `Ref`); it now prints the type through the names that reach it from the function, or writes `: infer _`.
- In a plain function, a `return`, `break` or `continue` in a `finally` block was an error (`EK2006`), and a `throw` there was joined to the failure in flight, so `try { throw new Error("x") } finally { return 3 }` failed instead of returning 3. Each now replaces the pending throw or return, as in JavaScript.
- Changing a workspace dependency’s `vibe.config.json` or `jsconfig.json` could reuse stale compiled output. The loader cache now tracks the nearest supported config, preferring `vibe.config.json`, then `tsconfig.json`, then `jsconfig.json`.
- Projects enabling `@effect/language-service` could crash the compiler while checking optional schema fields; builds and lint now use the correct checker layout.
- In a project that emits declarations, `EK4832` and `--fix` rewrote a struct exported with `type X = Schema.Schema.Type<typeof X>` to `schema X { … }`, which declares `type X = typeof X.Type`, so the declaration changed; they now leave that spelling, and the interface form, as written.
- The migrate flow's inventory listed the `x.d.vibe.ts` declaration sidecars that `vibelang` writes beside each `.vibe` file as Effect source files and plan candidates, and the codemod would have renamed one to `x.d.vibe.vibe`; both now treat every `x.d.<extension>.ts` as a declaration file.

- Nested interruption examples left the target of `restore` implicit. It now explicitly restores the nearest mask's entry state, including an already uninterruptible state, with a pending-interruption example.

- Service construct signatures could compile as methods or produce a misleading missing-contract error; they now report one `EK0902`, while quoted, computed, and optional methods named `new` remain valid.

- Without host declarations, missing `fetch`, `process`, and `Buffer` names appeared as banned platform APIs; the compiler now keeps TypeScript's missing-name and missing-property diagnostics.
- The migrate flow read a compiler crash as a clean run, recording no errors and no fixes; `compile`, `codemod` and the declaration step now stop and show the crash.
- The migrate flow left a `.d.ts` beside each source file outside a project's `rootDir`, and the batch's commit picked them up; the declaration step now removes what the compiler wrote outside its output directory.
- Repeated Vite development requests could lose the original source paths and text in cached source maps; each request now keeps an independent map, including inline module outputs.
- The migrate flow committed `.vibe` files that `vibelang-format --check` rejected, so a target's format check failed on its first batch; `record` now formats each batch's `.vibe` files with `vibelang-format`.
- `await runPromise(program)` in an `async` function reported `EK1005`, although `EK0103` tells you to write exactly that; no fiber runs an `async` function, so a runner is allowed there.
- The migrate flow's setup left a package tsconfig's `include` at `src/**/*.ts`, so a composite project rejected its first `.vibe` module with `TS6307`; setup now adds `src/**/*.vibe` beside each `.ts` or `.tsx` pattern.
- The migrate flow's ESLint config for `.vibe` files failed on a repository using TypeScript 7, because `typescript-eslint` refuses it; the config now uses its recommended rules only where it loads.
- The migrate flow found no Vite config for packages whose test script names a shared one, and wired the plugin into an Astro app's `vite.config.ts`, which broke `astro check`; it now follows `--config` in each package's test script, and leaves an Astro app to `astro.config` with a warning.
- A Vite config in a CommonJS package failed to load `vibelang-vite` with `ERR_PACKAGE_PATH_NOT_EXPORTED`; it now loads through Node's `require` of an ES module.
- The migrate flow failed declaration identity when `vibelang-format` reordered a named import, such as `{ ThreadId, type Ref }` to `{ type Ref, ThreadId }`; the gate now compares an import or export list in sorted order.
- A module augmentation of a `.vibe` module, `declare module "./user.vibe"`, kept the source name in the emitted `.d.ts`, where no such module ships, so a consumer got `TS2664` or, under `skipLibCheck`, lost the augmentation; it now names `./user.js`. A declaration sidecar names `./user.vibe` in an augmentation and in `import x = require(...)`, so stock TypeScript finds the sidecar there too.
- The migrate flow added `vibelang-vite` to every migrated package, so Knip reported it unused in each one without a Vite config; only a package that owns a wired config gets it now.

- The migrate flow's setup ran `vibelang agents init` after its format pass, so the `.claude` plugin manifests and `opencode.json` it wrote failed the target's format check; setup now formats them with the target's formatter.
- The specification omitted imported lint rule codes and defaults; it now publishes a generated table for every rule in the pinned upstream release.
- The specification omitted shipped throwing-call contracts; a generated inventory now records each pinned library overload, its callbacks and any returned callable.
- A plain `error` pattern rejected errors from another copy of a package; it now matches the same `_tag`, an error family's base still matches its subclasses' errors, and its extractor binds the original value.
- A `data` declaration with more than four type parameters reported `EK2126`, the constraint diagnostic; it now reports `EK2801` and constraints keep `EK2126`.
- Template-literal keys and repeated `globalThis.globalThis` accesses bypassed platform diagnostics; equivalent static spellings now report the same `EK4402` as direct access.
- Host globals missing from the old name table bypassed platform diagnostics; their declaration files now identify values such as `FileReader`, `WebAssembly`, and `globalThis.Headers` and report `EK4402`.
- The migrate flow failed a batch's declaration identity whenever a renamed module's importer had written `./leaf.ts`, because the importer's declaration now says `./leaf.js`, so every such module had to stay TypeScript; the gate now treats a relative `./leaf.ts` and `./leaf.js` as one module, since TypeScript resolves both to `leaf.d.ts`.

- The migrate flow's `upgrade-effect` step stopped with `Refusing to move bookmark backwards or sideways` after committing when `--base` named a commit behind an earlier run's bookmark; `--base` now restarts the bookmark there.
- Installing `vibelang` with pnpm 11 or later exited with `ERR_PNPM_IGNORED_BUILDS` for `dprint`, and the migrate flow's setup stopped there; the setup guide now shows the `allowBuilds` entry, and the flow adds it.
- The migrate flow staged every build of one VibeLang version under the same tarball name, so a target's npm, Bun or pnpm install could keep parts of the earlier build and a rebuilt toolchain's `vibelang-format` command was missing; setup now names each staged tarball for its content.
- An exported value whose inferred signature comes from a library, such as `Schema.decodeUnknownSync(Schema.String)`, declared `SchemaAST.ParseOptions` and added `import { SchemaAST } from "effect"` although the file never wrote `SchemaAST`, so its declaration differed from TypeScript's; it now declares `import("effect/SchemaAST").ParseOptions`, as TypeScript does.
- The specification's method-call example consulted mutable invocation helpers and changed native errors. Its counterpart now uses an ordinary call, preserving receiver and callee evaluation.
- A comparison-table row appeared to allow both execution operators in either function body. It now explicitly pairs `await` with its `async` context and `try` with its effect context.
- The specification left template-pattern admission and signed-zero exhaustiveness inconsistent. Primitive templates now require no substitutions and compare without coercion; signed Number-zero arms no longer claim to cover both zero signs.
- The specification nested async-match Promises and gave default or negated custom-matcher arms incorrect types. It now adopts async results and follows TypeScript control flow for the actual ordered matcher tests.
- A cached-match counterpart read mutable `Reflect.apply` and diverged when it was overridden. The specification now keeps the behavioral cache rule and a fixed native-generator witness, removing the lowered helper recipe.
- The execution overview omitted fiber joins and typed throws and said calls perform no work. It now lists both execution sites and distinguishes ordinary call evaluation from running a returned Effect.
- The tooling reference implied every compiler error used a VibeLang code; it now distinguishes native TypeScript errors from VibeLang grammar and proposal errors, including independent errors inside embedded code.
- The specification gave conflicting diagnostics for `try x catch (e) { … }`; it now reports the missing handler function first and shows an explicit plain or Effect-handler repair.
- The specification omitted `fork` and `join` in ordinary async-arrow heads inside Effect code; those heads now inherit the same reservation as plain arrows, while their bodies keep ordinary async behavior.
- The documented `Fiber` and `Deferred` warnings suggested Effect-only syntax in `async` functions; their repairs now use the existing `runPromise` bridge and keep the source function asynchronous.
- The specification left Effect type slots ambiguous beside tuple markers, object types and expression operators; it now preserves the surrounding TypeScript syntax and states when the requirement slot is present.
- The advice for renaming an imported `join` used a forbidden Node value import. It now uses an admitted relative VibeLang import.
- The specified service shape alias created circular base types for recursive contracts, while local services could capture incompatible generic shapes under one key. Shapes now name their member object directly, and captured outer type parameters are `EK3005`.
- The pattern grammar left empty-array patterns ambiguous, omitted regex-literal extractor suffixes, and let a local `not` binding compete with prefix negation. Each now has one syntax-based meaning, and identifier presence keys explicitly retain their accepted meaning.
- The Promise analogy appeared to admit `async do`, which VibeLang does not adopt. It now uses a native async arrow call, and `async match` jump rules cite their accepted VIP.
- The Promise comparison omitted that returning an Effect leaves it unrun. It now contrasts `async` return assimilation with Effect success data and shows `return try e` when the inner result is intended.
- The pattern specification left failed `or` binding replacement and repeated lexical `is` loop bindings inconsistent. Alternatives now retain one shared cell, while loop conditions use fresh cells and preserve the initial do-body TDZ.
- The matching specification inherited inconsistent iterator records, list cardinality, expression reads and property order from the pinned draft. It now states one set of source-order and ECMAScript protocol rules, preserving primitive iterables, optional absence, ordinary rest copying and inclusive comparisons.
- The catch explanation incorrectly attributed a mixed failure/defect Cause to `try.any`. It now describes recovery without that origin claim; the native operation already elects those failures to defects.
- Imported generic `data` constructors could report `EK4401` when read from a standalone declaration file; their declarations now retain Effect’s constructor signatures, so direct calls and aliases work without a boundary wrapper.
- Bare `Model` and `Prompt` gave generic missing-name errors, while `Utils` silently chose the root module; `EK1401` now lists every exporter and offers each import, and `--fix` preserves a previous root `Utils` binding with an explicit import (VIP-14, detail 55).
- Host-specific `import.meta` members and copies of its object compiled in `.vibe` files; only direct `import.meta.url` reads are now allowed, with `EK4402` explaining how to move host access to TypeScript.
- Copies of `globalThis` and reads through nonliteral keys bypassed its access restriction; they now report `EK0107`, while literal member access, type queries and local shadows keep working.
- Literal `data:` and `blob:` imports could load string-supplied code from `.vibe` files; they now report `EK0107`, including URL-equivalent scheme spellings and imports inside Effect wrappers.
- Inline type-only and empty Node imports could retain runtime module loads under `verbatimModuleSyntax`; they now report `EK4402`, and the type-binding fix writes an erased `import type` clause.

- A `service` could silently accept index signatures or constructor bodies; both now report `EK0902` with guidance to declare named contracts.

- Effect functions such as `andThen`, `scoped` and `tryPromise` needed a qualified name, and the skill's first program failed with `TS2304`; every non-clashing `Effect` export is now global, and `vibe.effectGlobals` can turn them off.

- A `match` or `if`/`else` chain with thousands of arms over a large union took about a minute and a half to check; repeated narrowing now reuses its results, so a 2000-arm `match` checks in about 10 seconds.
- The specification checked throwing calls in plain handlers' bodies but skipped eager parameter initialization. The same check now covers defaults, destructuring and computed binding keys, while implicit exceptions and uncalled functions keep their existing behavior.
- Formatting a `catch` expression with a comment before its handler was refused; those comments and their line breaks now stay in place.
- The specification lost loop-head binding scopes and allowed forbidden returns to hide in binding defaults. Both loop forms now retain JavaScript's operand scopes and apply their outward-jump restrictions to head initialization as well as the body.
- The specification could lose a synchronous throw when a generic result became an Effect or a callback default disappeared from a declaration. Existing generic contracts and conservative default-callback bounds now survive both boundaries.
- A required schema field could silently become optional through a referenced codec; conflicting or uncertain decoded optionality now reports `EK2109`, with a preserving `--fix` expansion to explicit codecs.
- The platform decision gave banned `globalThis` members the wrong diagnostic and omitted the allowed `Function` checks; it now agrees with the language reference and the accepted `Function` exemptions.
- Closing a bundler build or watcher during compilation could leave the compiler and its output pipes running. The `vibelang-vite` and `vibelang-unplugin` integrations now await teardown and stop a compiler that exceeds a one-second grace period.
- The specification’s priority statement relied on an unspecified decision layer. It now points readers to accepted VIPs, their public amendments and cited counterparts, with the same publication rule in the VIP index.
- Region completion examples exposed compiler control records or normal block values to layer finalizers. Finalizers now see the original generator payload while source values and jumps remain intact.
- The specification widened every `do` literal and dropped values crossing transparent blocks. It now keeps ordinary expression typing and complete source completion values, including empty completions and values carried by jumps.
- Forbidden Effect modifier positions lacked a specified diagnostic, and error members could lose a second modifier diagnostic. The specification now assigns `EK0108` and preserves applicable `EK0104` and `EK0105` without an extra member-category error.
- Editor formatting and the formatter companion ignored project style or used different output; the language server, `vibelang format` and formatter plugins now share the project's dprint configuration and format unsaved editor text without writing it to disk.
- The specification implied that running a completed Effect always suspends like `await`. It now states Effect's native scheduling behavior and when to request a cooperative yield.
- The specification omitted Promise-returning tagged templates from its explicit bridge trigger. The same Promise-result rule now covers tagged invocations and keeps the original call inside the bridge.
- The specification mixed generator-body throws with construction and copied synchronous callback throws onto async declarations. Call contracts now follow execution phase, and async declarations retain callback admission without inventing synchronous throws.
- The formatter specification did not distinguish executable JavaScript from embedded source maps. It now preserves code and diagnostic codes while requiring fresh maps for the formatted source.
- Producer docs promised a global two-element lead even with concurrent yields. That bound now applies to one sequential emitter; concurrent item fibers can each compute a value before waiting to offer it.
- The runtime specification omitted construction traces, so equal `Exit`s could hide an eager body. It now requires call-time and full run traces, including eager defaults and repeated runs.
- The severity guide described only four-digit codes. It now shows how to configure full printed codes such as `EK38100`.
- The producer specification still required one receiver-passing recipe after the shared binding rule had replaced it. Producers now use the same source-binding behavior as Effect functions, with the implementation left to the compiler.
- The specification gave conflicting meanings to `fork` and `join` in class and enum initializers. It now follows their ordinary initializer context, keeps class heads in the enclosing context, and distinguishes static keyword reservation from permission to run Effects.
- The specification required recursive thrown types that could grow forever or produce invalid declarations. Expanding summaries now conservatively use `unknown`, while finite recursive summaries stay precise.
- The public pattern decision omitted the accepted rule for negated custom matchers; it now states that narrowing follows the actual recognition test and demonstrates the ordinary-class and custom-matcher cases.
- The reference did not explain how to provide a local named `effect`; it now shows `provide (effect) { … }` and distinguishes it from an Effect-block provider.
- The public pattern decision omitted Promise adoption and default-arm flow; it now states the accepted TypeScript rules and shows that a failed guard can leave both subject types possible.
- The `try` reference omitted unchecked `any` operands; it now explains native delegation, including noniterable defects and iterable completion.
- The concurrency reference omitted when inputs are pulled or closed; it now states the pinned Effect behavior for sequential traversal, parallel materialization and array reuse.
- The specification described every numeric concurrency limit as an exact upper bound. It now delegates the full numeric domain to Effect, including zero and below-one limits that still run all items sequentially.
- The specification’s mixed-modifier diagnostic omitted blocks. Both `effect async { … }` and `async effect { … }` now recover with `EK0105`; the valid repair removes `async` and keeps the Effect block.
- The specification admitted data variants named `$is` or `$match`, whose calls reached Effect helpers instead of constructing variants. It now reports `EK1602` and suggests renaming the variant and its references.
- The accepted interruption rules named only some callable forms and could appear to reject a callable's own mask. They now cover every independent effect activation and explicitly allow its local mask.
- `Date.now()`, `Date()`, `new Date()`, and `Math.random()` were incorrectly rejected with `EK4403`; these ECMAScript built-ins now compile as VIP-33 requires.
- `vibe.effectModules: false` left implicit Effect names available; it now requires imports, filters implicit editor suggestions and keeps required imports during `--fix`.
- A module-level `provide` block reported a generic top-level error and suggested implicit execution through `main`; `EK1201` now points to an `effect function` or `effect { }` block (VIP-12).
- Bare internal HTTP, TLS and legacy stream imports escaped the Node platform check; they now report `EK4402` like their `node:` forms, while type-only imports remain erased.

- `service` accepted extra static helpers and could crash on a computed static name; those members now report `EK0902`. The supported `static readonly default` migration still reports `EK4855` and can be repaired without an extra `EK0902`. The same rule covers inline object and scalar shapes.

- Local services and services without a named package silently received fallback keys; they now require an explicit key, with a quick fix that preserves the existing identity.

- Service keys accepted class modifiers, and default properties could omit `readonly` or an initializer; these malformed declarations now report `EK0902`.

- Config migration could put severity settings inside a JSONC comment containing `{`; it now keeps the settings active and the comment intact.
- The specification left import-free `.vibe` files with conflicting scope rules. It now requires module scope before checking, preserves it in JavaScript and declarations, and states the `moduleDetection` exception and ordinary host behavior.
- The specification incorrectly required `for concurrent` on one line. A newline after `for` is now allowed, matching native `for await` and leaving the loop behavior unchanged.
- The specification could misread `effect is …` and `async is …` as invalid function shorthand. Both now retain their pattern-test reading, alongside the existing `as` and `satisfies` expression exclusions.
- The introduction hid contextual keyword parsing behind its promise about plain TypeScript code. It now states that those rules also apply in plain code and links to their declaration and expression boundaries.
- Project warning severities under `vibe.severities` were ignored; they now apply with config validation and inheritance, and `vibelang --fix` migrates legacy `vibelang.diagnostics` settings.
- Severity overrides for `EK0508`, `EK0703` and `EK0801` lost their leading zero during lookup; all four severity values now apply to these warnings.
- Terminal diagnostics dropped leading zeros from VibeLang codes; they now preserve them. See the [diagnostic code map](../vibelang-features/diagnostic-code-map.md).
- `for try (x of s)` and `for try (var x of s)` reported a generic `Variable declaration expected` syntax error with no fix. They now report `EK2005`, which says to declare the element with `const` or `let` and assign the existing variable in the body.
- `Stream` loops previously depended on the operand type; `for try` now explicitly consumes a `Stream` with `continue` and `break`, and rejects a `return` or a labeled jump out of the loop in its head bindings or body (`EK2002`, `EK2003`).
- An identifier or call followed by a separate block on the next line was rejected with `EK1022`. Standalone blocks now compile normally, including after identifiers named `uninterruptible`, `interruptible` and `restore`.

| Before | After and repair |
| --- | --- |
| A user-written `static` member in `error` or `schema error` | `EK1302`; run `vibelang --fix` to keep the fields and `static` members in an equivalent Effect TypeScript class. |
| A setter in `error` or `schema error` | `EK1302`; run `vibelang --fix` to retain it in an equivalent Effect TypeScript class. |
| Type parameters on `error` or `schema error` | `EK1303`; `vibelang --fix` converts a plain generic `error` to an Effect TypeScript class. A generic `schema error` needs concrete fields or a TypeScript schema factory; no class fix is offered because it would introduce `TS2562`. |
| `when -0:` or `when +0:` written to match either zero | Write `when 0:`, which matches both zeros. A signed zero now matches only that zero, and `EK4701` reports a `match` that relied on it to cover `0`. |
| An explicitly `readonly` schema field referencing mutable or uncertain decoded key flags | `EK2109`: run `vibelang --fix` to retain the existing codec as an explicit `Schema.Struct` value. Nested value mutability is unchanged. |
| A `match` arm that ends in a new line, in `,`, or at `}` without `;` | `EK0701`: run `vibelang --fix` to write the `;`. |
| Required tuple positions used a schema reference with optional decoded keys | `EK2109`; run `vibelang --fix` to preserve the existing codec, declarations and decoding with explicit Effect codecs. Schema-error declarations keep their constructor and matcher behavior. |

- EK4802's quick fix "Call it to run it" was offered in a function whose written contract rejects what the call runs, such as `return Exit.fail("data")` in an `unknown!!` function, and applying it added EK2001. It is now offered only where the contract accepts the call's failure, requirements and success.
- `vibelang --fix` could write a fix that added a type error when the file also had an unrelated syntax error, because its check of the fixed program then saw only syntax errors. It now checks every error, so such a fix is listed as not fixed.
- Bun, `vibelang/register`, Vite and unplugin could report `Cannot find module` for extensionless or directory imports after their TypeScript targets became `.vibe` files. They now resolve those imports with TypeScript's file priority and `index.vibe` fallback, preserving existing source files.
- The diagnostic reference omitted compatibility checks and the three existing requirement/service migration warnings. It now lists all eight interim `EK92xx` checks with their meanings and retirement owners, plus the migration warnings and their defaults.
- Async conversion could put a directly nested `await` inside a plain callback; the refactors now decline that body and preserve nested function boundaries.
- Async conversion could leave a returned Promise unbridged in an effect body; the refactors now require an explicit `await` for Promise or thenable returns, including unions that may contain one.
- Async conversion could pass a scalar or unproven `await` operand to `Effect.tryPromise`; the refactors now require Promise-like operands and retain nested async functions unchanged.
- A producer could silently discard a returned value. It now reports `EK2128`: a Stream has no return value. `vibelang --fix` keeps the value's evaluation and ends the stream with a bare `return`.
- The specification admitted generic parameters and return annotations on a bare effect-arrow parameter. Arrow heads now follow TypeScript: those decorations require parentheses, while `effect x => x` remains valid.
- The specification excluded valid effect-function overload signatures, decorated class methods and ordinary error-method overloads. Their grammar now follows the corresponding TypeScript declaration positions and checks.
- The specification inherited pipe-draft errors that rejected valid topic use or left chains and precedence undefined. Its effective grammar and operations now preserve sequential chains, nested topic scopes and ordinary TypeScript operators.
- The specification could lose a synchronous throw behind an effectful overload or an escaped rethrowing callback. It now checks every exposed overload bound and preserves the callback contract on returned and nested callables.
- The specification omitted the surviving TypeScript-form advisory codes and their safe repairs. The reference now lists them as configurable warnings and excludes advice for retired language features.
- The specification introduction described every Effect TypeScript comparison as an unchecked fragment. It now distinguishes partial examples from complete comparisons that can be checked directly.
- The specification did not prevent generated temporaries from changing anonymous function and class names. It now preserves source naming context, including names observed by class static initializers.
- The proposals comparison still listed handlers as shipped, and upstream drafts linked retired local research sources; handlers now remain explicitly open under VIP-35, archived chapters state that the first release has no handlers, and historical evidence links to its source revision.
- Benchmark projects could miss packages when the experiments and docs installs shared an npm scope. Staging now merges each scope's packages while keeping the first package found and the runtime's `effect` copy.
- Enabling `strictEffectProvide` silently skipped functions named `main`; it now reports those sites too, matching Effect TypeScript, so entry points can suppress the warning explicitly (VIP-26, VIP-38).
- A failed `scripts/remote.sh` sync could leave a temporary tracked-files list behind. The list is now removed on success and failure.
- `Headers`, `Request`, `Response` and `Event` used host constructors instead of Effect namespaces; values now name Effect modules while ambient types keep their meanings, including in emitted declarations.
- Migrating a retired `catch (cause: Cause)` could leave it unchanged because the replacement passed a plain value to `exit`; the fix now captures and runs the protected code inside an `effect` block.
- Nested `provide` hints falsely claimed separate builds and recommended removed `wire`. `EK4808` now suggests native composition that retains both layer outputs; the unsafe automatic merge is retired because it can change when provider expressions run and layers build.
- Editor input quick fixes could introduce argument errors, and helper annotation fixes could leave a callback error unchanged; unsafe repairs are now withheld, and captured inputs keep their types.
- Repository example staging now uses one local-package mapping for dependencies and overrides. The staged versions and published example manifests stay unchanged.
- Plain service method return types such as `number` reported `EK9205`; written plain and Effect return types are now accepted, while a missing return type still reports the error (VIP-9).
- Assigning to a service property without `readonly` reported a read-only error; service shapes now preserve the written property modifier, and service migration keeps read-only properties read-only (VIP-9).
- Outside its own member types, a local service's `S.Shape` compiled even though its namespace cannot exist inside a function or block; it now reports TypeScript's namespace error and offers `Context.Service.Shape<typeof S>`. Recursive own-member types keep the private shape hook, and `--fix` preserves them (VIP-9, detail `181`).

- The specification described how an `effect` body reads `this` and `super` with a helper recipe that was wrong in five separate edge cases. It now states the behavior: the body reads them exactly as the same body in an `async` function does, and building the Effect reads none of them.
- The specification restated class-pattern and cleanup rules in several chapters, and the copies drifted. Each rule now has one definition that the others link to, and chapter 2 lists every place `try` differs from `await`, with its reason.
- The specification described `do` and defaults with hand-written lowering recipes, which disagreed with JavaScript in new ways each round. It now states the behavior: a default behaves as in JavaScript with the `do` proposal, a `return`, `break` or `continue` in an array pattern's default closes its iterator as the same jump does from a `for…of` body, and a throw in an `effect` function's parameter default gives an Effect that dies instead of throwing at the call.
- `EK4402` banned `AbortSignal.timeout` by name, with no rule that covered `const { timeout } = AbortSignal`, and the inventory the specification cited did not exist. One rule now covers platform members: a statically named value is `EK4402` when its symbol reaches the host. `docs/design/inventory/platform-globals.json` is generated and test-checked, and it also bans `URL.createObjectURL` and `URL.revokeObjectURL`, which store Blobs in the host.
- The specification's `EK4701` rule for `_tag` said "exactly one string literal type", which left optional tags, union tags and members that share a tag undefined. It now follows TypeScript's `switch (s._tag)`: each literal in the tag's type is a case, an optional tag adds the case `undefined`, and a `_tag` that is not a literal type turns the check off.
- The specification's fix for `fork e catch h` moved `e` onto the forked fiber, so a failure in `e` no longer reached the caller. The fix is now `fork Effect.catch(e, …)`: `e` runs on the caller, as a Promise's operand does, and the handler runs on the fiber.
- The specification's `A!E!R` productions allowed a line break between a `!` and its slot, while its notes called the same program a syntax error. One rule now covers every `!`: a line break ends an Effect type, as it ends TypeScript's postfix type operators.
- The specification left a `return`, `break` or `continue` out of a `match` arm undefined, and the pinned draft read literally turned `return 7` into `throw 7`. A jump out of an arm now behaves as the same jump out of a `for…of` body: cached iterators close, then the jump goes on. Chapters 3, 4 and 8 gave three different answers for which `throw` skips that closing; there is now one rule, and a no-match error is `new TypeError()` everywhere.
- Renaming the `_` in an old `infer _` return annotation could change inference and introduce type errors. The editor now declines that rename; ordinary generic and conditional `infer` bindings still rename normally.
- Organizing imports or renaming an old inline `module` declaration could introduce unresolved imports and new errors. The editor now refuses these unsafe edits; move the code to a `.ts` file, as inline modules are denied by VIP-25.
- The specification gave conflicting throw contracts for foreign callables and callback propagation; it now composes own throws with `@rethrows`, preserves contracts across declarations, and distinguishes both synchronous schema decoder builders from the decoders they return. Platform-global and namespace rules now agree across chapters. Stream-loop jump diagnostics now agree with the shared rule that a label on the loop itself is consumed there.
- `await.all`, `await.race`, `await.any` and `await.allSettled` still compiled beside VIP-18's `try` operations, with their own element rules and runtime helpers; they are now `EK1802`, and `vibelang --fix` rewrites them to `try.all` and its siblings with the same behavior.
- `sh scripts/bench/compiler.sh` could miss the compiler after a normal build; it now prefers the native build output while preserving `VIBELANG` overrides and legacy builds.
- `vibelang --fix` could refuse an `Effect.gen` rewrite because a yielded SQL query became unexecuted data. It now calls structured Effect results returned by `.vibe` helpers, preserving their execution.
- With `noUnusedLocals`, `vibelang --fix` could refuse a valid rewrite because it made an import from `effect` unused. It now removes those imports as part of the safety check.

- Commas between service method signatures were rejected as missing method bodies; methods now accept interface separators, including trailing commas (VIP-9).
- Commas between service properties reported `EK1013`; properties now accept interface separators, including trailing commas (VIP-9).

- The specification's `try.allSettled` counterpart, `Effect.all([a, b].map(Effect.exit))`, was a TypeScript error when the operands had different types, and lost the tuple when it compiled. An array literal now maps to `Effect.all([Effect.exit(a), Effect.exit(b)])`, typed as a tuple of `Exit`s, as `Promise.allSettled` keeps one.
- The specification lowered a destructuring default that contained `try`, `await` or a returning `do` into an arrow, so `const { x = do { return 9 } } = {}` returned from the arrow instead of the function. Such a default now runs in the enclosing function, keeping evaluation order, TDZ, `var` scoping and iterator closing.
- Running the optional Windows compiler check with `--vitest` in a path containing `#` failed with an unhelpful module error; it now explains Vitest's limitation and how to run compilation checks and `--vitest` checks separately.
- The repository hygiene scan rebuilt its fixed scratch-path rules for every file; those rules are now shared across the scan, preserving the same diagnostics.
- Effect tagged-error patterns rejected branded copies and namespace aliases; they now use the resolved module's guard, including in extractor patterns.
- The VIP migration left by-name arguments such as `Effect.retry(load() + 1, …)`, function values at program positions and `fork` callbacks implicit, so marking their functions could run the work at the wrong time. `vibelang --fix --fix-vip-only` now writes `effect { … }` blocks for by-name arguments, captures function values with `Effect.suspend` or `Effect.sync`, and writes `fork effect { … }`.
- The VIP migration left function literals in collections passed to `Effect.all` and racing combinators, so marking functions could leave their work unrun. `vibelang --fix --fix-vip-only` now writes explicit Effects at those program positions and keeps callback arguments as functions.
- A failed register benchmark left its temporary workspace on disk; it now removes that workspace on setup or compiler failure while preserving an explicit `--out` directory for inspection.
- Knip export collection duplicated rest-binding handling between object and array patterns; both now use one traversal, preserving nested defaults, omitted elements and exported names.

- Ordinary classes with computed static readonly fields, such as `static readonly [kind] = "name"`, could crash `vibelang` or `--fix`. They now check normally, and their computed members stay unchanged.
- Documentation hover generation could leave temporary projects behind when the language server failed to start; it now removes them on startup failure as well as after a refresh.
- A payload field named `constructor` in `error` or `schema error` failed to parse as though it were a constructor method. Typed fields with that name now compile and retain their payload values.
- Packaging a `dprint` plugin could leave a temporary archive behind when replacing the archive failed; it now removes that temporary file on every return path.
- An initializer directly after `!!` caused a syntax error; `const e: number!!=Effect.succeed(1)` now parses with the same meaning as the spaced form.
- Inline object types in an Effect error slot were rejected; `number!{ message: string }` now works like the corresponding `Effect` type.
- Effect tagged-error patterns written with a directly imported constructor, such as `when TimeoutError:` after `import { TimeoutError } from "effect/Cause"`, did not use the module's guard, so branded errors from another package instance fell through. They now call the guard and narrow the matched error to its type.
- Imported aliases in `Option`, `Exit` and `Result` patterns could fail to compile; they now use the resolved module guards and extract the specified fields, safely rejecting unbranded subjects.

- Automatic tracing settings could silently insert function spans that no accepted language proposal defined. The compiler and TypeScript mapper now reject `tracing`; add operation spans explicitly with `withSpan`.
- The `alchemy-stack` example failed on `effect@4.1.1`: importing `@alchemy.run/cloudflare` failed with `Cannot find module .../effect/dist/Crypto.js`, because `alchemy@2.0.0-beta.84` imports the removed `effect/Crypto`. The example now patches `alchemy` with Alchemy's own Effect 4.1 port on install, and the Alchemy page shows how to apply the patch.
- Global throw annotations could not be inspected as data; a generated snapshot now lists their overloads, shipped own-throw contracts and exact declaration inputs, and checks when they become stale.
- Host messaging references such as `postMessage` and `globalThis.postMessage` could bypass the platform check; they now report `EK4402`, while local bindings keep working.
- Projects configured only with `vibe.config.json` could lose editor settings, and imported packages could miss `vibe.config.json` or `jsconfig.json`. Editors and package settings now use the nearest config in the documented precedence order and refresh when a canonical config is created.
- Throwing a `Cause` object was rejected; it now fails with that exact object in Effect code and throws it normally in plain JavaScript code.
- The specification and producer guide made a labeled `break` or `continue` naming the `for try` itself `EK2003`, unlike JavaScript and `for concurrent`. It now means the loop's own unlabeled jump; only labels on enclosing statements are `EK2003`.
- The specification promised that `match` class arms on ordinary classes would emulate the TC39 draft's construction-identity test, which compiled JavaScript cannot do for classes from `.ts` or `.js` files. A class without its own `Symbol.customMatcher` now matches by `instanceof`.
- Typed ESLint programs required `tsconfig.json` even when a project used `vibe.config.json` or `jsconfig.json`; `typedProgram()` now discovers the nearest project in the same order as the compiler and still honors an explicit `project`.
- The editor parser accepted repeated statement `catch` clauses; it now marks them as invalid syntax while preserving TypeScript's `any` and `unknown` catch annotations.
- `vibelang --fix` left some arrows with Effect return annotations unmarked, so they lost their Effect behavior when only the `effect` keyword decided their form. It now marks these arrows `effect`, including arrows whose bodies qualify for direct-call optimization.
- Concurrent arrays could not use the documented concurrency spellings; they now run with `try.all`, `try.race`, `try.any` and `try.allSettled`; settled outcomes include defects and interruption as `Exit` values.
- Formatting a concurrent loop whose limit used `try` could fail with an overlapping-edits error; the formatter now preserves the complete loop head.
- Building from source could fail the runtime test of a 100,000-element delegated producer on a busy host after five seconds, while it was still delivering elements; it now allows 30 seconds.
- The module and resource VIP references still named `effect@4.0.6`; they now describe the accepted `effect@4.1.1` pin, with its 149 root exports and scope functions checked.
- On the docs site, a specification link whose text held code with brackets, such as ``the `[Effect]` parameter``, kept its `.md` path, so the site build failed on a dead link; it now links to the section on the site.
- Effect functions and program literals had no explicit spelling for migration; `vibelang --fix --fix-vip-only` now writes `effect` functions and `effect { }` blocks while preserving their behavior.
- `Date` patterns accepted objects with only `Date.prototype`; they now require a real date, including valid date subclasses and invalid dates.
- A `schema` or `schema error` declaration could throw `ReferenceError: Schema is not defined` when an explicit `Schema` import was used only by the declaration. Generated schema references now retain a runtime import.
- Editors still highlighted `layer` declarations and `service class` as VibeLang syntax after those spellings were removed; tree-sitter and VS Code now recognize only the accepted service spelling.

- The `examples/pipeline` README and sample output showed producer logs in the wrong order; both now show `Stream.take` closing the producer before the loop logs the second alert (VIP-21).

- Generic `data` declarations could collide with a user’s `NameDefinition` interface; generated helpers now choose a free name.
- `vibelang lint` skipped projects using `vibe.config.json` or `jsconfig.json` and ignored invalid project settings; it now uses compiler config precedence and reports configuration errors.
- Cyclic schema declarations incorrectly reported that a schema was not a schema; they now report only TypeScript’s initialization diagnostics.
- Schema declarations accepted comma field separators; the compiler now reports `EK1013`, and `vibelang --fix` writes semicolons.
- Schema declarations inferred mutable arrays, tuples, and records as readonly; they now preserve the collection type's mutability, support `Readonly<Record<K, V>>`, and keep the same types through `vibelang --fix`.
- An unused local `main` previously warned that it should be exported; it now compiles without that warning (VIP-26).
- The obsolete `with Layer { ... }` provider alias previously compiled with a warning; only `provide Layer { ... }` is now supported, and the old alias receives TypeScript syntax errors (VIP-12).
- Module-level `using`, including nested blocks and class static blocks, previously failed; these declarations now compile and dispose at the end of their TypeScript scope (VIP-8, VIP-26).
- Coding agents initialized with `vibelang agents init` missed Effect lint checks; their instructions now include `vibelang lint` and its Oxlint configuration.
- Agent instructions taught retired call and function forms; the shipped skill and starter essentials now follow the accepted syntax, distinguish Promise `await` from Effect `try`, and explain failure handlers and cleanup.
- Lower the Node.js floor from 26 to 22.22.3 (22.x) or 24.11.1 across packages, starter, build and release checks; Node 22.22.3 supplies main-module detection, synchronous import hooks and the imported-CommonJS ESM cache fix (Node.js #59679).
- VIP-21: a producer ran its body only when its consumer pulled, through a continuation handoff that VIP-21 replaced. A producer is now Effect's `Stream.callback` with a one-element buffer, ended by `Queue.end`: its body runs on a fiber of its own and may run up to two elements ahead of the consumer. A `for...of` or `yield*` over a Stream that needs a control operation is now EK4201, as other Stream consumers were, and a failure in a producer's cleanup after its consumer stops is no longer reported.
- VIP-4: a TypeScript function documented with `@throws {E}` or `@throws {never}` still needed `@vibelang trusted` before Effect code could call it, and every JavaScript built-in was trusted except `JSON.parse`, `decodeURI` and `decodeURIComponent`. `@throws` alone now says what a function throws, `@throws {unknown}` means what no tag means, and VibeLang ships one generated table of `@throws` annotations for the ES built-ins: `JSON.parse` throws `SyntaxError`, `BigInt(text)` `SyntaxError` or `RangeError`, `RegExp(text)` `SyntaxError`, the `Intl` locale lookups `RangeError`, `eval` `unknown`, and `Math.max` and the rest `never`. A DOM function has no annotation, so it throws `unknown` (`EK4401` outside a wrapper).
- Migration now includes `.vibe` in formatter, lint and ast-grep commands: the compiler ships a Prettier plugin and formatter companion using its own dprint formatter, ESLint checks VibeLang beside Oxlint, and ast-grep loads the shipped tree-sitter grammar.
- VIP-30: project discovery checks `vibe.config.json`, `tsconfig.json`, then `jsconfig.json` in each directory; explicit config paths still select that file.
- An LSP client that only accepts pushed diagnostics, such as Claude Code's, showed no errors in `.vibe` or `.ts` files, because the language server answered only `textDocument/diagnostic` requests. The server now publishes each open file's diagnostics to such a client after every open, change and save.

- A target set up from a staged toolchain (`step.mjs toolchain`) installed `vibelang-runtime`, `vibelang-vite` and `vibelang` without their `LICENSE` and `NOTICE` files, so license tooling such as a bundle's third-party notices rejected them. The staged tarballs now carry the files the published packages carry.
- Under `vibelang-vite`, an import of a directory whose `index.ts` had become `index.vibe`, such as an alias to `src/mount`, failed with `Could not load ... Is a directory`, and an extensionless `./x` did not reach `x.vibe`. The plugin now adds `.vibe` to `resolve.extensions`. The migrate flow also wires a config written `defineConfig(() => ({ ... }))`.
- The migrate flow wrote `package.json`, `tsconfig.json`, `pnpm-workspace.yaml` and Vite configs in its own format, so the repository's `format:check` failed on them. Upgrade-effect, setup and each batch's record now run the repository's own formatter (Oxfmt, Vite+ `vp fmt`, Prettier, Biome or dprint) on the files they wrote.
- Knip could not read `.vibe` files: it reported every import of a migrated module as unresolved and never an unused export of one. `vibelang` now ships `vibelang/knip`, a Knip compiler for `.vibe`, and the migrate flow writes it into a `knip.config.ts`, keeping a `knip.json`'s settings.
- After the migrate flow, an app, example or website whose Vite config bundled a migrated package's sources failed with `PARSE_ERROR` or `Module not found` on its `.vibe` modules: setup added `vibelang-vite` only to the tests' config. It now adds the plugin to every Vite and Vitest config of a migrated package or of a package that depends on one through workspace packages.
- A package the migrate flow set up for `bun test` failed with `Export named '…' not found` on its first `.vibe` import: the repair wrote a top-level `preload` in `bunfig.toml`, which `bun test` ignores. Setup now writes `preload = ["vibelang/bun"]` under `[test]` for a test command that runs `bun test`.
- After the migrate flow (`.smithers/flows/migrate`), a project that checks the migrated sources with stock `tsc`, `tsrs`, `bun check` scripts that invoke TypeScript, or TypeDoc failed with `TS2307` on every import of a migrated module. Setup now supplies declaration sidecars and enables `allowArbitraryExtensions` in every tsconfig, and the codemod names a migrated module `./x.vibe` from `.ts` files, so those checkers read its sidecar.
- Stock `tsc`, `tsrs`, `bun check` scripts that invoke TypeScript, and TypeDoc failed with `TS2307: Cannot find module './x.vibe'` in a project that imports a `.vibe` module, or skipped it. The compiler now writes `x.d.vibe.ts` beside each `.vibe` module, which those tools read under `allowArbitraryExtensions` ([Let TypeScript tools read .vibe modules](vibelang-cli.md#let-typescript-tools-read-vibe-modules)).
- In a project that emits declarations, `vibelang --fix` changed the declaration files: it removed an import such as `import * as Schema from "effect/Schema"` that an export's type used, and rewrote `Effect.Effect<void, never, never>` as `void!!`, which dropped the `never` arguments. It now keeps such an import and writes `void!never!never` in an exported statement, so the declarations stay the TypeScript's.
- In a project that emits declarations, `vibelang --fix` rewrote an exported `Schema.Struct` constant that had no type of its name as a `schema` declaration, which added `export type Name = typeof Name.Type` to the declaration file. EK4832 now leaves such a constant; with its type written beside it, the pair still becomes `export schema Name { … }`.
- The experimental TypeScript mapper reported `EK9001` for imports from inline modules. It now reports `EK9100` for inline modules and their imports, explaining that they require building with `vibelang`.
- The experimental TypeScript mapper required a `$plain` member on exported functions with an Effect return contract, rejecting valid assignments to `typeof f`. Their projected types now keep only the Effect contract.
- In JavaScript that the experimental TypeScript mapper emits, passing an imported plain function with a written return type as a callback, as in `[1, 2].map(square)`, failed with `Plain call of square found no plain form`. The callback now receives the function as written.
- A nested module type such as `Layer<HttpClient>` could emit a declaration with an unqualified inner type. Declarations now qualify nested module types too, such as `Layer.Layer<HttpClient.HttpClient>`.
- Unrelated baseline type errors could prevent Bun, Node and bundler loaders from loading a clean `.vibe` module. Loaders now reject only errors in the source they load and project-wide errors.
- Under `bun --preload vibelang/bun`, a TypeScript module that imported `./x.js` failed with `Cannot find module` when `x.ts` had been replaced by `x.vibe`. Bun now loads `x.vibe`; an existing `x.ts` still wins.
- `vibelang/bun` and `vibelang/register` refused a project with `"composite": true` with `TS6304` and `TS6379`. They now compile it.
- Tree-sitter rejected block-param calls named `error`, such as `error{}`; it now accepts them as the compiler does.
- Writing a contract such as `number!!` on a function whose `try` block returned a `do` block, or a `throw` expression beside a `match`, reported `TS7024` and `TS7022` on the catch binding, though the same function compiled without the contract. The function now compiles either way, and the catch binding has the try block's error types.
- A `join [a, b]` inside `uninterruptible { }` never finished when one fiber failed while another was still waiting. The join now interrupts the waiting fiber, runs its cleanup, and fails with the first fiber's error.
- A `match` at the end of a `do` block incorrectly reported `TS1109`. The block now returns the selected arm’s value.
- Formatting a statement-level `match` after a statement without a semicolon could refuse the file after joining the statements. Formatting now preserves that boundary.
- Tree-sitter accepted unescaped line breaks inside quoted strings; it now rejects them as the compiler does, while preserving escaped line continuations.
- Tree-sitter highlighting could misread `catch`, `??`, statement starts, `!T`, empty type parameters and bare `await`; these forms now parse as the compiler parses them.
- The starter now starts after a Yarn Classic install without needing Redis.

- Importing both `vibelang-runtime` and `vibelang-runtime/kernel` in Bun no longer fails at startup, in either import order.
- A running call used as a bare statement in a constructor, static block, getter or setter now reports `EK1001` and explains that the surrounding code runs as plain JavaScript.
- Running calls in getters, setters and parameter defaults now report `EK1001` instead of silently returning or storing an unrun Effect, including defaults of Effect functions.
- Effect functions now report EK4301 when assigned, returned or stored in a typed element that expects a plain function, including members of objects and class instances.
- A plain call that finds no plain form now fails with a defect naming the function, instead of returning an unrun program.
- An owned fiber could escape through an assignment, return, call or capture inside an await, fork or concurrent loop operand. The compiler now rejects those escapes while allowing direct reads there.
- Repeated calls along a chain of functions without written contracts could make the compiler run out of memory. Inferred error and service channels now keep each type once, so repeated calls no longer multiply inference work.
- A `module` declaration's exports were copies: after `bump()` changed an exported `let count`, the file and its re-exports still read `0`, and the module's imports ran before the file's earlier imports. Each module declaration the file imports now compiles to a JavaScript module of its own, `main.vibe.text.js` beside `main.js`, so its exports are live bindings and it runs in import order; `vibelang/register`, `vibelang/bun`, `vibelang-vite` and `vibelang-unplugin` load it from the file's compile.
- Quick fixes dropped the comments inside what they rewrote: a comment in an error's field list or before an `Effect.succeed` argument disappeared. Fixes now keep those comments, and a rewrite that cannot keep its comments is not offered.
- `vibelang --fix` stopped after 16 rounds, so a file with more than 16 nested `Effect.Effect<…>` types was only partly rewritten and a second run changed it again. It now continues until nothing is left to fix, and reports a rewrite that repeats a source state instead of writing a partial result.
- The editor's error-declaration quick fix cut a generic parameter list at the first `extends` inside it, turning `class Bad<T extends string>` into `error Bad<T { n: T }` and leaving `TS1005: '>' expected`. The fix now copies the whole type-parameter list from the parsed class.
- The formatter sorted import and re-export declarations, so modules initialized in a different order after formatting and the program's output changed. Declarations now keep their source order; the names within one declaration may still be sorted.
- `--fix` and the editor removed an import when a rewrite dropped its last binding, including an import of a local module whose initialization the program relied on, so that module no longer ran. A module that was loaded now keeps a side-effect import, `import "./adapter.ts"`, in the same position.
- The `Effect.provide`, `Effect.provideService` and `Effect.withSpan` quick fixes moved the program expression into the block, so a getter or a factory call ran after the providers instead of before them. A program expression other than a call passed by name, an arrow function or a variable the file never assigns now stays in its original call, and its warning offers no fix.
- The service-class quick fix replaced a class whose key is an expression, such as `keys.pop()!`, with a `service` declaration, so the key's evaluation and its side effects were lost. A class with a dynamic key now stays as written; only literal keys are rewritten.
- The `catchTag` and `catchTags` quick fixes wrote a class test, `when Gone:`, so a failure that carries the tag without the class's prototype, such as a copied error object, failed at run time with `No match arm matched`. The fixes now write the structural test the call made, `when { _tag: "Gone" }:`.
- The `catchTags` quick fix gave the merged handlers one shared `catch (e)` parameter, so a handler that read an outer variable named `e` read the caught failure instead and returned the wrong value. Handlers now keep their own bindings: the shared variable is renamed when a handler's own name would be captured.
- Migration could record formatted sources whose public declarations no longer matched the bytes verified earlier; verification now covers formatted sources, and recording rechecks any later formatting change. Protected test edits are rejected before verification runs again after formatting.
- A `catch` quick fix could shadow an outer name read by the handler, changing its result; CLI and editor wrappers now choose a free parameter through the checker, including escaped names and exhausted fallback names.
- A catch-handler editor fix removed `async` or `*` even when its body still used `await` or `yield`, leaving new compile errors; CLI, editor and diagnostic guidance now withhold that edit and ask for an explicit body conversion.
- Removing `async` from a `catch` handler deleted comments after it; modifier repairs now preserve every comment and the handler body.
- `vibelang --fix` removed an `effect` import with a doc comment before it, such as a module header, when the declaration did not write the import: tsc drops the comment with the import, so without it the comment led the declaration and the published `.d.ts` changed (Smithers `Canonical.d.ts`). `--fix` now keeps such an import when removing it would change the declaration.
- Running a stored `any` operand with `try` could expose `unknown` success in exported declarations. Success now remains `any`, matching native `yield*` inference.
- An `effect` modifier on an ambient declaration, abstract method or type member could escape its rejection or produce parser errors. It now reports `EK0108`; `vibelang --fix` removes the modifier while keeping the signature.

#### Compiler and diagnostics

- The compiler crashed on a service declaration with a static member whose name is computed, such as `static [Symbol.iterator] = 1`, while looking for the service's `key`. It now treats only a member named `key` as the key.
- A call of a union of a plain function and an Effect function, such as `(flag ? double : Math.abs)(3)` with `double` unannotated, compiled and gave the Effect function's program back unrun when it was chosen. It is now EK4301; annotate `double` or call each function where it is chosen.
- A `schema` declaration's `.d.ts` declared an interface, `interface User extends Schema.Schema.Type<typeof User> {}`, before the constant, so a library that rewrote `const User = Schema.Struct(…)` and `type User = typeof User.Type` as a `schema` changed its public declarations. It now declares the constant and then `type User = typeof User.Type`, byte for byte what the Effect TypeScript declares.
- A function's form followed its body: adding a log call to an unannotated exported helper changed its declaration from plain to Effect and broke callers compiled earlier, a callback type written in place accepted Effect callbacks while the same type through an alias did not, and an unannotated protocol method such as `static [customMatcher]()` or `[Symbol.dispose]()` that ran an Effect returned it unrun. A function's form is now written: a plain return annotation or `: infer _` makes it plain, a function without one is an Effect function, a literal takes its destination's form, and a callback type means what TypeScript means; see [Upgrade from 0.0.10](#upgrade-from-0010).
- A match whose last arm only binds the value, `when let other: …`, reported EK4701 over a union of literals or tags as if that arm handled no case. Such an arm now handles every case, as `default` does.
- A structural type could stand for a service. A requirement for one service could be relabeled as another and fail at run time with `Service not found`. Services are now nominal by their key; see [Upgrade from 0.0.10](#upgrade-from-0010).
- A `service` declaration's `.d.ts` declared VibeLang's own interface, runtime key type and `Shape` namespace, and its key was always derived, so a library that rewrote a `Context.Service` class as a `service` changed its public declarations and its key (foldkit's `Dispatch`, alchemy's `Correlation`). It now declares Effect's own `Context.Service` class, byte for byte what the TypeScript declared, and `static readonly key = "…"` in the body keeps the original key, which the `Context.Service` quick fix and `vibelang --fix` now write.
- An `error` declaration's `.d.ts` declared VibeLang's own `#private` member and a `namespace E { type $error = ErrorBrand<…> }` marker beside the class, so a library that rewrote a `Data.TaggedError` class as an `error` changed its public declarations. It now declares exactly what the `Data.TaggedError` class declares, and a match counts an arm over any error class extending `YieldableError` toward exhaustiveness, wherever the class is declared.
- Pre-release builds of 0.0.11 reported EK4701 for a `match` without `default` over an open subject, such as `match (x: number) { when 1: 1; }`, though VIP-7 checks only finite unions. Such a match compiles again, and a value that no arm matches throws the proposal's `TypeError`.
- A non-tail `resume` could receive a value outside its type and crash after only EK2119 warned. EK2119 is now an error; write a success type covering the handler's answers.
- A `using` initializer that was not a single call, such as `flag ? acquire() : acquire()`, `(acquire(), handle())` or `wrap(acquire())`, ran its inner acquisitions in the caller's scope. `using` disposed the value a second time, the acquisition's release ran after the block, and the function falsely needed `Scope` (EK2002 or EK3205). The whole initializer now runs in the block's scope, so each resource is released once, when the block exits.
- A function whose `using` initializer had a generic requirement, such as `using r = open()` with `open: () => A!!R`, kept `Scope` in its own requirements, so a caller that passed a scoped acquisition needed `Scope` it never used. The function now omits it: its requirement is `Exclude<R, Scope>`. With `R extends Scope`, the initializer now requires `Scope`, so `using` binds a value with no disposal method instead of reporting TS2850.
- Providers now remove only services supplied on every path. Invalid providers report EK3207; unions, optional tuple elements and array spreads keep requirements they cannot guarantee, and service defaults are checked against their shape and member contracts.
- The process.exit and process.exitCode replacements did not state their exit statuses. The diagnostic and table now say to return for 0, fail for 1 or interrupt for 130.
- Experimental FileSystem and Crypto requirements could be mistaken for Effect's services and fail with a missing service at runtime. Their keys now have distinct identities, and the entry selects their experimental layer.
- A local method named runSync could suppress main, while an aliased runner could go unrecognized. Runner detection now follows the resolved function.
- A browser entry could import Node's runner and fail to load in a browser. It now uses BrowserRuntime and imports no Node modules; the page starts main explicitly.
- Conflicting platform imports silently chose one platform. EK3206 now rejects a second, different platform import; keep one per file.
- An entry using standard and experimental services could build the platform twice. It now provides one shared platform layer.
- EK3205 could name a missing platform service without its provider. It now names the layer that supplies each service.
- Class and object methods with plain return annotations could hide an unrun Effect. They now report EK2003, with the contract repair in [Upgrade from 0.0.10](#upgrade-from-0010).
- Reading Path.sep produced an unexplained missing-property error. EK4503 now points to Path().sep on the service implementation.
- Errors on shared prelude and global names could leave their meaning unclear. Notes now identify the selected module or global and explain how to reach the other.
- A misspelled name could suggest a platform global that EK4402 bans. Suggestions now omit banned globals outside TypeScript escapes, and missing Process or Locks names point to Experimental.
- Subclasses of fieldless error families could reject their own constructor fields. They now accept those fields for abstract bases and bases with a widened tag.
- Passing a running call to prelude pipe could give only a TypeScript type mismatch. EK4502 now explains that the call already ran and shows how to pass a program.
- Returning a block-owned fork could silently hand the caller an interrupted fiber. EK4838 now warns and suggests a caller-owned scope or explicit detachment.
- Using provide in an expression could produce unrelated parser errors. The diagnostic now explains that provide is a statement.
- Wide failure, service and match lists could overwhelm diagnostic messages. Each list now shows at most ten members and counts the rest.
- An unsupported Effect installation could be reported as missing. EK1011 now names the resolved version and the required installation.
- A `for...of` whose binding default failed, a `for...of` over an array with its own iterator, and an array destructuring whose default failed left the iterator open: its `return()` never ran. Every live iterator is now closed as JavaScript closes it, innermost first, before the failure is reported.
- Explicitly empty service keys could be missed. A `service Empty {}` key is now recognized.
- Imports from paths containing spaces, `#`, `?` or percent signs could fail at runtime. Generated imports now escape those characters.
- Deeply nested arrow functions could take a long time to check. Effect return inference now shares the guarded type lookup.
- Files with many generated helper names could compile slowly. Generating those names now takes linear work.
- An unresolved or invalid call could also get a misleading unsafe-call error. The compiler now reports the original error without that extra message.
- Cyclic error inheritance could produce errors about generated constructors. Those follow-on errors are now suppressed.
- An error base written as an expression could appear as an internal name in a diagnostic. The message now shows the source expression.
- A missing call pipe could suggest the wrong operation. The diagnostic now gives guidance that applies to the operation you used.
- A large function could get a false non-exhaustive-match error after TypeScript stopped flow analysis. It now keeps only the flow-analysis-limit error.
- Bare program names such as `interrupt` could silently run nothing. See the new diagnostic and call fix in [Upgrade from 0.0.10](#upgrade-from-0010).
- A trailing throw could throw the wrong operand or get a misleading contract error. See the parentheses repair in [Upgrade from 0.0.10](#upgrade-from-0010).
- Error subclasses with a primitive or list base constructor could fail only when instantiated. See the earlier declaration error in [Upgrade from 0.0.10](#upgrade-from-0010).
- A nameless `module { … }` could get platform and call errors. See the naming hint in [Upgrade from 0.0.10](#upgrade-from-0010).
- An `await` binding could compile into invalid JavaScript. See the binding check in [Upgrade from 0.0.10](#upgrade-from-0010).
- An entry could pick a platform layer from the runtime's development dependencies. It now resolves platform packages from the entry's project.
- `const fs = FileSystem; fs.writeFileString(...)` gave an unexplained missing-property error. The message now suggests `FileSystem()` or a direct service call.
- Platform diagnostics could recommend a hatch for an API that has a service. They now point to Effect's `lstat` and home-directory APIs or the [experimental replacements](#experimental-platform-apis).
- An Effect arrow that read `this` only in a parameter default or a class's `extends` clause, or an Effect method that read it only in an `extends` clause, lost `this` and failed with a `TypeError`. Both now keep the enclosing `this`.
- An Effect arrow that read its enclosing function's `arguments` saw a different object, shared by every run of the same Effect; in an anonymous function expression that named its own variable it failed with a `ReferenceError`, and in a plain function it crashed the compiler. It now reads the arguments of the same call, afresh on each run.
- A producer that read `arguments` got an empty object. It now reads the arguments of the call that made its Stream.
- An Effect arrow created in a constructor read `undefined` for `new.target`. It now reads the constructor call's `new.target`, as a plain arrow does.
- An Effect method or arrow that wrote a super property in any form but `super.x = v` and `super.x += v`, such as `super.count++`, `super[key] += v` or `[super.x] = pair`, and an Effect arrow in a class field that used `super`, could compile to JavaScript that failed to load with `'super' keyword unexpected here` or `Invalid left-hand side in assignment`. They now run as JavaScript runs them, evaluating the key once, and a `super.tag` template tag keeps `this`.
- Inside a named Effect function expression or producer, such as `function self(n) { … self(n - 1) … }`, the name meant an internal generator: a call passed by name failed with `Not a valid effect`, deep recursion overflowed the stack, and returning the name returned the generator. The name now means the function itself.
- A binding spelled like a name the compiler generates, such as `answer$direct` beside a function `answer`, `sum$recur`, `work$try` in a function `work`, or `Users_base` beside a service `Users`, could change which function a call ran or what a local held, stop the module from loading with a `SyntaxError`, or make its declaration file invalid. Generated names now avoid every name the file spells.
- An Effect function whose parameter default names the function itself, such as `function f(g: Self = f)`, got the generator that runs its body instead of the function, so the default was not an Effect function. The name now means the function, as in TypeScript.
- A binding or label spelled like a name that `match` or `is` writes, such as `const $match1 = 99` read in an arm, could read the match subject instead of its own value, or stop compilation with a duplicate label. Those names now avoid every name the file spells.
- A binding spelled like a helper that a form calls, such as a `$is` or `$noMatch` function beside a `match`, or `$awaitAll` and `$forConcurrent` beside `await.all` and `for concurrent`, replaced the helper: a match chose the wrong arm or returned the binding instead of failing, and the fiber forms ran the binding instead of their fibers. The forms now always call the runtime's helpers.

- Plain functions that call one another, with a parameter or local named like the function, such as `function even(even: number)`, failed with `TypeError: even is not a function` once the recursion ran deep. The deep path now calls the function.
- A by-name `a() || b()` or `a() ?? b()`, such as `retry(first() || second(), policy)`, tested the Effect that runs `a()` instead of its value, so `b()` never ran. It now tests the value, as the same expression in a lambda does.
- A pipe whose topic stands alone, such as `source() |> sink.take(%)`, could read a getter or a reassigned `let` in its body before it ran its left side. The left side now runs first, unless the body reads only values that can't change.
- `try(f, mapper, input())` evaluated its inputs before its mapper. It now evaluates its arguments in the order written.
- `wire(a(), b())` evaluated `b()` before `a()` when `b()`'s layer needs a service that `a()`'s layer provides. The arguments now run in the order written; only the layers they make are reordered.
- `for concurrent(limit()) (const x of items())` evaluated `items()` before `limit()`, so the loop could iterate items that `limit()` had replaced. The head now runs in the order written.
- An optional chain that went on after a call that runs an Effect, such as `box?.read().value`, crashed with a `TypeError` when `box` was absent, and an optional call such as `codec.parse?.(input())` could run its arguments when skipped. The rest of the chain is now skipped, arguments included.
- A call with expected failures, such as `JSON.parse` read through a getter, read its function after arguments that run an Effect, so the getter ran late and the call could reach a function an argument had replaced. It now reads the function first, as JavaScript does.
- A tagged template whose tag declares expected failures, such as ``tag`text` ``, threw them as defects that `catch` never received, and EK2004 said its `try` could not fail. The template now uses the tag's failures, as a call does.
- A nested pattern that tests and binds a property, such as `{ value: 1 and let n }`, read the property twice, so a getter ran twice and `n` could differ from the value tested. A pattern now reads each part of its subject once.
- An exhaustive `match` without `default` skipped code in its last arm's pattern, such as the getter in `when registry.State.Waiting`. That code now runs.
- `wire(Decorated)`, where `Decorated` provides and needs the same service, was typed as needing nothing and failed with `Service not found`. Its type now keeps that input, as `Decorated`'s does.
- `wire` imported under another name (`import { wire as compose }`), called as `Runtime.wire`, or given a spread array (`wire(...[LA, LB])`) skipped dependency ordering, so a layer could be built before the layer it needs and fail with `Service not found`. These forms are now ordered and checked as `wire` is, and a spread whose layers cannot be listed is EK3204.
- A service declared inside a namespace, `export namespace N { export service S { … } }`, had a declaration file entry without its key type, so TypeScript code could not pass `N.S` to `Layer.succeed` or `Effect.provideService`. Its declaration now matches a top-level service's.
- Effect's `pipe` imported under another name, such as `import { pipe as flow } from "effect"`, or read as `Function.pipe`, got none of the diagnostics that point out where 0.0.10's look-ahead made its first argument a program. It is now recognized under any name, so EK1023, the migration note and `--fix` cover those calls too.
- A `sync` or `try` hatch whose function returned `number | Promise<number>` gave the Promise object where its type promised a number, and one that returned data with a `then` field, such as `{ then: 7 }`, crashed with `then is not a function`. The hatch now waits only for a value whose `then` is a function, deciding per value when the type allows both.
- A pattern recognized built-in matchers by spelling: with a parameter named `String`, `when String` still tested `typeof x === "string"`, and `when Option.None` on your own `data Option` failed with EK2127. A matcher now means what its name resolves to, so those are a variable pattern and your type's variant.
- A function with a plain return annotation, such as `function sumTo(n: number): number`, died with a `RangeError` on deep recursion, while the same function without the annotation completed. Its call cycles now continue on heap frames past the depth limit, as unannotated ones do, and its callers, TypeScript ones included, still call it as a plain function.
- A `match` without `default` that handled every case of a finite union ran its last arm without testing it: a getter the test reads was never read, and a value outside the declared type, from an unsound cast or `any`, took the last arm. The last arm is now tested like every other arm, and a value that fails it throws a `TypeError`.
- An object pattern never matched a function, so `when { size: let n }` skipped a function with a `size` property. It now matches any object or function, and still reads no property of a primitive.
- A default in a catch binding, such as `catch ({ id = fallback() })`, could fail or need a service that the function's contract left out, so a `number!!` function compiled and its callers could not catch the failure. The compiler now counts the default's failures and requirements in the function's contract.
- An error subclass of a generic base, such as `error Child extends Base<number> { own: string }`, failed to compile with TS2345 because its generated constructor dropped the base's type arguments. The constructor now takes what `Base<number>` takes, plus the subclass's fields.
- A `for concurrent` loop let its body assign a `const` binding, as in `for concurrent (const n of xs) { n = 99 }`, destructured bindings included. Assigning one is now TS2588, as in a `for...of` loop; a `let` binding stays assignable.
- `join` rejected a dictionary of fibers typed with an index signature, such as `Record<string, Fiber<number>>`, with EK4611, and accepted an object whose index signature also admitted non-fibers, which then failed at runtime. It now checks index signatures as it checks properties.
- A `.vibe` file's declaration file imported Effect's types from `vibelang-runtime` (`import type { Effect } from "vibelang-runtime"`), so it differed from the declarations of the Effect TypeScript it replaced and made consumers' types depend on the runtime. Declarations now import `Effect`, `Layer`, `Schema` and `Scope` from `effect` and write `Effect.Effect<…>` and `Scope.Scope`, as Effect TypeScript does.
- `Readonly<{ path: string }>` in a `.vibe` file declared `Readonly<{ readonly path: string }>`: the same type, but other declaration text than the TypeScript it replaced. The members of an object type that is `Readonly`'s type argument now declare no `readonly` of their own unless the source writes one.
- A type that a `.vibe` file's declarations inferred from one of Effect's modules was written as an import type, `import("effect/Option").Option<string>`, where Effect TypeScript that imports `Option` declares `Option.Option<string>`, so removing a prelude module's import, as `--fix` does, changed the declarations. Declarations now name such a module through the name the source writes, the Effect module always, and import it from `effect`; a module the source never names keeps its import type.
- An Effect type in the `!` form declared every channel, `number!!` as `Effect.Effect<number, never, never>`, where the Effect TypeScript it replaced wrote `Effect.Effect<number>`. Declarations now leave out the empty slots at the end of a `!` form, and dependencies that a return annotation leaves for the body when they come to `never`; a slot the source fills, `never` included, stays.
- A `.vibe` file that kept an import of `effect`, such as `import { Array } from "effect"`, declared the other names its declarations needed in a second import of `effect`, where the Effect TypeScript it replaced had one. They now join the kept import.
- A `.vibe` function with a callback parameter that has no contract, such as `mapAll<A, B>(items: ReadonlyArray<A>, f: (a: A) => B)`, declared the callback as `(a: A) => Effect<B, E, R>`, which names `effect`'s `Effect` module rather than its type, so stock TypeScript rejected the declaration file with `TS2709`, and with `skipLibCheck` on a TypeScript caller could pass a plain function that then failed with `Not a valid effect`. Declarations now write `Effect.Effect<B, E, R>`, through the file's own import of `Effect` when it has one, as Effect TypeScript does.
- A method with a plain return annotation that called itself, such as `size(): number { return 1 + (this.next ? this.next.size() : 0) }`, a recursive `toString(): string` or `static depth(n: number): number`, or two such methods that called each other, was rejected with `EK2003`, as if its call of itself ran an Effect. Such a method now compiles to a plain method, and a synchronous callback can call it.
- `new` on a function declared in a `.vibe` file, such as `new make()`, reported only TypeScript's `TS7009`, and through a cast, `new (make as any)()`, or under `@ts-ignore` it compiled and returned the function's program instead of an object it constructed. It is now `EK1020`, which names the function and says to declare a class; a function of a `module` declaration keeps TypeScript's meaning.
- Calling a service key with arguments, such as `Fn(3)` for `service Fn: (n: number) => number`, reported TypeScript's `TS2348`, which suggested `new`, itself an error for a service. It is now `EK3007`, which says that `Fn()` returns the implementation, and its quick fix writes `Fn()(3)`.
- `EK4836` did not warn at `Effect.withSpan(() => load(id), "load")`, whose program is already an arrow, or at an `Effect.provide` or `Effect.provideService` call that did not stand as a statement or a return, such as `const user = Effect.provide(() => load(), AppLive)`. Both now warn: the first's quick fix writes the prelude's `withSpan(() => load(id), "load")`, and the second says why it has no fix.
- The `Effect.catchTag`, `Effect.catchTags`, `Effect.catch` and `Effect.provide` quick fixes wrote a program passed as an arrow, `Effect.catchTag(() => load(id), "Gone", …)`, as that arrow called in place: `((() => load(id))()) catch (e) => …`. They now write the call it returns, `load(id) catch (e) => …`, which means the same.
- An inferred type that the compiler reached through the runtime's alias of `Effect`, such as the type of `export const idE = identity<Effect<number>>`, was declared as `import("vibelang-runtime").Effect<number, never, never>`, so TypeScript consumers' types depended on the runtime. Declarations now write it `Effect.Effect<number, never, never>`, imported from `effect`.

- A `const` that held an arrow with a plain return annotation, such as `const countdown = (n: number): number => n === 0 ? 0 : countdown(n - 1)`, died with `RangeError: Maximum call stack size exceeded` when it recursed deeply, where a function declaration completes. It now recurses as a function declaration does, continuing on heap frames past the stack's depth.
- A call that runs an Effect in a generator method, such as `*items() { yield load(2) }` in a class or an object literal, compiled and yielded the program unrun. It is now `EK2003`, since a generator method is a JavaScript generator, whose body is plain code; yield a program, `() => load(2)`, to hand one out.
- `export const main = () => { … }` compiled, but no host ran it, since only a function declaration named `main` is an entry, so the program printed nothing. It now draws `EK4843`, a warning whose quick fix writes `export function main() { … }`.
- A function you declared named `fork` captured the keyword form: with `function fork(x: number)`, `fork slow()` called that function, so `join` of its number was EK4611. `fork x` and `fork { … }` now always start a fiber; only the call form `fork(x)` calls your function.
- `join(fiber)` with parentheses was TS2304, an unknown name. It now joins the fiber, as `join fiber` does, and `join([a, b])` keeps the shape; a function you declare named `join` makes it an ordinary call of yours.
- Clearer messages for a plain function that throws or runs an Effect (EK2003). The message led with the annotation, `number is a plain return annotation, but quantity can fail with InvalidQuantity`, offered only the contract and a hatch, and for a function that runs an Effect suggested `number!Errors!`, which closes `R`, so a function that needed a service got EK2002 next. It now leads with the rule, `quantity can't throw InvalidQuantity` or `read can't run Count(), an Effect`, names the throw or the call, and lists each way out as code: the Effect contract with the channels the body adds, `number!!Count` included, which the quick fix also writes for a function that runs an Effect; `die(…)` under `number!!`; or a `.ts` file, a `module` block or a `sync` hatch. A throw that escapes a constructor, an accessor, a static block, a JavaScript generator or a module's top level reads the same way, and its note no longer cites a decision number.
- Clearer messages for a callback that runs an Effect or throws where a plain function is expected (EK4301). The message said `this callback can pause (find)`, its fix pasted the whole callback into `Effect.forEach(…)`, however long, and its notes cited decision numbers and a "Visitor spelling". It now says what the callback can't do and why, `This callback can't run find(id), an Effect: ReadonlyArray.prototype.map calls it synchronously, as a plain function`, writes a long callback as `(id) => { … }` in the fix, and shows the one spelling that returns the program, `(id) => () => find(id)`. A callback that throws also suggests catching inside it, a function passed by name says it `can't be passed to` the callee, and a discarded Effect subtype, such as an SQL statement, says the statement discards it and shows the call that runs it.
- Clearer messages for a `match` that leaves a case (EK4701), a call of a callback parameter that can fail (EK2001), a `pipe` whose first argument changed meaning (EK1023), and the content mapper's errors. Their notes cited the decision log by number and spoke of a program "by look-ahead". They now say the same in the docs' words, and EK1023 shows the code that keeps the old meaning: `const first: A!E!R = () => …`.
- Clearer messages for services and providers (EK3001-EK3006, EK3201-EK3207), catches (EK2004, EK2114), and two notes of EK3101 and EK4838. Some started in lower case, such as `no provider for Todos.`, and EK3201's only fix was `Effect.provide(() => …, layer)`, where the docs teach a `provide` block; EK3203 and EK3206 offered no fix. They now start as sentences, `Nothing provides Todos, which this program needs.`, EK3201 offers `provide layer { … }` first, and EK3203 and EK3206 say how to break the cycle or split the entry. A lint keeps every message, variant and note starting as a sentence.
- Clearer messages for `.pipe` on a call that already ran (EK4502). Its fix suggested `|>` with `%`, or passing the call by name, two forms being retired. It now writes the call with the program passed as a function, stage by stage: `f(1).pipe(Effect.retry(policy), Effect.timeout(t))` suggests `Effect.timeout(() => Effect.retry(() => f(1), policy), t)`, as Chapter 28 already said.
- Clearer messages for errors that offered no fix: an unreachable catch clause (EK2106), a second clause for one operation (EK2108), `await` on a plain value (EK4603), a binding inside an `or` pattern (EK4702), a regular expression or relational pattern (EK4704), and a condition that isn't a boolean (EK4822). Each now says how to repair it, such as `when let v and (A or B): …` or `when let v and if (…): …`. EK2002 also names the `provide` block: `Provide Users inside find with provide layer { … }, or add it to the contract: string!!Users`.
- Clearer messages for a program run at a module's top level (EK1001) and a throw in a factory's body (EK2115). `export const config = loadConfig()` suggested only "Export a function instead"; it now shows the code that holds the program, `const config = () => loadConfig()`. A top-level `provide`, `handle`, `uninterruptible`, `interruptible` or `restore` block now says to move it into a function, a top-level throw expression reads like a throw statement, `A module's top level can't throw Bad`, and EK2115 no longer says a body "cannot run throw".
- Declaration output left ordinary `async` function declarations without a thrown-type contract, so a consumer treated each call as possibly throwing `unknown`. They now carry `@throws {never}`, because a throw in an `async` body rejects the `Promise`; a written `@throws` is kept, and a written doc comment gains the tag.
- While an argument such as `Layer.effect(Reports, {` followed by `const printer = try Printer` was half written, the language server could recurse until its stack overflowed and the process died: checking the argument asked for the call's signature, whose resolution checked the argument again. The check now answers from the resolution already in progress.
- An ordinary `.ts` file could get TypeScript errors that stock TypeScript does not report, in code TypeScript never checks, such as a function that error recovery reads as an import's module specifier (`import { a } from` followed by `function f() { missingName }`): a VibeLang pass whose diagnostics no longer apply to `.ts` files still asked the checker for types across the file. The pass no longer runs, so `.ts` files keep exactly TypeScript's diagnostics.

- Member predicate and extractor patterns could lose their `this` value and throw. They now retain their receiver and evaluate its base and computed key once.

#### Runtime

- A `provide Key = value { … }` block built a one-service Layer on every pass, with a new Scope and Layer MemoMap around its statements, so a hot path paid about five times the cost of `Effect.provideService` and a layer the block's statements provided was memoized with the caller's layers. A `Key = value` provider now provides its service as `Effect.provideService` does; only a layer the block lists builds one.
- A `using` whose initializer did not require `Scope`, such as `using db = openDb()` where `openDb` waits and returns a Disposable, held cancellation off until `openDb` finished, so a `timeout` around it waited for the whole wait. Every initializer now runs with the interruptibility around the `using`, as `yield*` runs it, so the deadline ends the wait and nothing is disposed.
- A Disposable acquired by an Effect with its own release was disposed twice by `using`. It is now released once.
- A fiber returned from a block-bodied arrow was already interrupted, with only a warning. A fiber that escapes the region that owns it is now an error.
- Experimental platform layers had the same names as Effect's layers and were easy to confuse. Their exports now start with Experimental; see the import repair in [Upgrade from 0.0.10](#upgrade-from-0010).
- An unhandled typed error from main could print only its tag and omit useful fields. Failure reports now include the error's fields while preserving redaction.
- Loading the native runtime with an incompatible Effect could fail during module linking before the version check. It now reports the supported Effect version first.
- Traced calls could lose their logical caller while forwarding to another function. Tracing now captures that caller before forwarding, including named function expressions and methods.
- Calling a plain VibeLang function from TypeScript with `call`, `apply`, `bind` or as a method could lose `this` and throw a `TypeError`. The generated Effect wrapper now forwards the receiver (reported by Vladimir Kalnitsky).
- Running the same Effect again could see an earlier run's changes to a rest-parameter array or to a method's default parameter value, and program lambdas with optional or rest parameters could fail with a missing-variable defect. Each execution now binds its parameters afresh.
- Running the same Effect again could start from an earlier run's assignment to a parameter, such as `++n` or `n += 1`. Each execution now starts from the original arguments.
- `using` read a value's `[Symbol.dispose]` again at block exit, so replacing the method, or a getter that returned another one, changed which release ran. It now reads the method once, when it acquires the value, as JavaScript does.
- `join` on an object or array read each element twice, so a getter could make it join one fiber and interrupt another. It now reads each element once.
- In a function that compiles to plain JavaScript, a `finally` block that failed while another failure was in flight replaced it, so an outer `catch` saw the cleanup failure instead of the first one. The two failures now join as `Effect.ensuring` joins them, and the outer `catch` receives the first, as in an Effect function.
- In a function that compiles to plain JavaScript, a `finally` block that crashed while another failure was in flight kept only the first: a TypeScript caller saw one exception, and an Effect caller one defect. The exception that leaves is now a `SuppressedError` whose `error` is the cleanup's and whose `suppressed` is the first, and an Effect caller sees both defects in order, as in a function that compiles to an Effect.
- A `for...of` loop whose body or destructuring crashed over an iterator whose `return()` then threw too kept only the body's defect, as JavaScript's loop does, in plain code and in Effect functions alike. The loop now fails with both, in order.
- A failed `join` or `await.all`, or a decided `await.race`, interrupted the other fibers one at a time and waited for each one's cleanup before interrupting the next, so it hung when one fiber's cleanup waited for a sibling's. It now interrupts them all at once, as `Fiber.interruptAll` does, then waits for their cleanup.
- A program holding an await operation over an operand that is not a literal, such as `const p: number[]!! = await.all items`, read `items` once, when the program was built, and reused that reading on every run. Each run now reads the operand afresh, as `Effect.all` does.

#### Editor and language server

- The refactor "Convert to a VibeLang function" turned the removed shorthand `async later(n: number) { ... }` (`EK0101`) into `later(n: number) { ... }`, which does not parse. It now writes `function later(n: number) { ... }`.
- Hover text could run the inferred contract into the behavior paragraph. A blank separator now keeps them readable.
- Completion after `FileSystem.` or `Experimental.Process.` could omit service members. It now includes the shorthand members.
- Canceling a request during contextual type lookup could leave the editor waiting. That lookup now checks for cancellation.
- Rename could insert an invalid identifier and break the file. The server now rejects invalid replacement names.
- An ordinary `fork` identifier before an operator could be highlighted as a keyword. It now keeps identifier highlighting.
- An ordinary `join` identifier before an assertion or operator could be highlighted as a keyword. It now keeps identifier highlighting.
- Interruption blocks lacked keyword highlighting. `uninterruptible`, `restore` and `interruptible` now receive it in block form.
- Tree-sitter rejected `using` as a parameter or ordinary identifier. It now accepts those contextual uses.
- After an edit to a `vibelang.manifest.json`, the language server kept the diagnostics of the old manifest, such as no EK4401 for a call of a declaration the manifest no longer listed, until the project reloaded. A change to a manifest now rebuilds the project's program, as a `package.json` change does.

#### Tooling and bundlers

- `vibelang lint` with an Oxlint configuration skipped every `effecttsgo/*` rule VibeLang answers with syntax or a build diagnostic, so `Effect.succeed(undefined)` in a `.vibe` file passed with `effect-succeed-with-void` set to `error`, while the same text in a `.ts` file failed under Oxlint. Each rule the configuration turns on now reports `.vibe` files, under its `EK38xx` code. `missed-pipeable-opportunity` counted the calls `try` and `catch` compile to as pipeline stages, and no longer does. `vibelang lint --help` printed the compiler's help in a directory with no Oxlint configuration, and now prints the lint help.
- Migration converted modules that Node on a package `bin`, `bun file` from a directory with no preload, or Playwright's Babel load, so `ERR_UNKNOWN_FILE_EXTENSION`, `Module not found` or a Babel parse error appeared only when someone ran that tool. A package script's `.ts` path into a renamed module broke the same way. Setup now finds these entries, keeps the modules they reach TypeScript, and names each in `plan.json` and `setup.json`.
- `vibelang-format` and `vibelang format` started one Node and one dprint process per file, about 64 ms each, so a check of alchemy's 8,595 `.vibe` files took 403 to 600 s and its pre-commit hook 863 to 1311 s. They now run dprint once per style and core over all the files, with byte-identical output and the same exit codes, and remember the texts dprint left unchanged, so checking a clean tree starts no dprint: 8 s cold and 1 s clean on that repository.
- The published-declaration checker (`scripts/api-identity.mjs`) stopped every module at the first group of eight when a declaration was missing on both sides, such as t3code's `connection/platform.d.ts` (`TS2883`) or four `packages/contracts` files (`TS7056`), and reported no differences. Callers can now pass each side's emit diagnostics as `absentDeclarations`: a declaration missing on both sides with the same codes and source locations compares equal, an export that reaches a missing declaration is unavailable on its own with the reason, and the other exports are compared. A one-sided or differently caused absence never compares equal.
- A loader's compile, for `vibelang/bun`, `vibelang/register` or a bundler plugin, type-checked every `.ts` file in the package of the `.vibe` module it served, though the loader serves only `.vibe` modules and reports only their diagnostics, and a type error in any such `.ts` file kept the compile out of the cache, so every process compiled again. A one-line `.vibe` module beside a costly `.ts` file took 4.9 s to load instead of 0.2 s, and opencode's standalone server compiled its server package again on every start. A loader's compile (`vibelang --loader-root`) now checks and emits only the `.vibe` files under its package, with the same JavaScript and `.vibe` diagnostics; opencode's server became ready in 2.9 to 4.0 s from a warm cache instead of 8.1 to 8.5 s, as fast as its TypeScript tree, and in 10.9 to 12.7 s instead of 18.4 to 19.3 s from a cold one.
- A cold Vite dev server pre-bundled none of the imports a `.vibe` module's JavaScript adds, such as `effect/Schema` for a `schema`, because its dependency scan read the `.vibe` source. The first request found them, Vite optimized again and reloaded the page, and a browser test running on it failed (2 of opencode's 193 app stories). `vibelang-vite` now lets the scan read each `.vibe` module's JavaScript, with Vite 7 and Vite 8.
- `vibelang --fix` crashed on a file with a malformed import such as `import * ct.sleeon from "effect/Option"` once one of its fixes applied: removing the effect imports the fixes left unused read the import's specifier as a string. It now skips an import whose specifier is not a string.
- The compiler crashed on `@vibelang leakable`, the documentation-comment marker that exempts a service from EK4809, and on any service member whose requirement's declaration has a documentation comment, such as `Effect.Effect<string, never, Maybe!!>`: reading the comment skipped it as trivia. The marker now exempts the service as documented.
- `vibelang --fix` parsed every library and package again for each round of fixes, so a type nesting 20 `Effect.Effect<…>` took half a minute on a busy machine. A run now parses a file again only when a fix edits it, which took that type from 23 s to 6 s.
- Coding agents edited `.vibe` files without VibeLang's skill or diagnostics unless you set each one up by hand. `npx vibelang agents init` now writes the skill, an `AGENTS.md` section, the language server configuration and a post-edit check for Claude Code, Codex, opencode, Cursor and VS Code ([Coding agents](coding-agents.md)).
- Typed ESLint rules read a `.vibe` module's types as unresolved from a `.ts` file, because typescript-eslint's TypeScript cannot load `.vibe`, so rules such as `@typescript-eslint/no-unnecessary-type-assertion` reported code that `vibelang -p` accepts. `vibelang/eslint` now exports `typedProgram`, a program for typescript-eslint's `parserOptions.programs` in which each `.vibe` module, another workspace package's included, reads as the declaration `vibelang` writes for it.
- EK4831's quick fix kept the deeper indentation of a `Context.Service` shape whose type arguments stood on lines of their own, so the `service` declaration's members and closing brace stood one level too deep. They now take the declaration's indentation.
- Code migrated from TypeScript kept `import { Array } from "effect"`, which hides JavaScript's `Array` in a `.vibe` file, for you to rename by hand. An import of Effect's `Array`, `String`, `Number`, `Boolean`, `Function`, `Symbol`, `BigInt` or `RegExp` module under that name now draws EK4842, whose quick fix imports it as `Arr`, `Str`, `Num`, `Bool`, `Fn`, `Sym`, `Big` or `Regex` and renames its uses.
- `vibelang --fix` left a schema constant and its type alias, such as `const Kind = Schema.Literals(["a", "b"])` just before `type Kind = typeof Kind.Type`, for you to rewrite. They now draw EK4841, whose quick fix writes the schema alias `schema Kind = "a" | "b"`. A type written before its constant keeps its form, because the alias's declaration file lists the constant first.
- A `--fix` rewrite that left two names of one import unused, such as `Option` and `pipe`, was refused with TS1005 because its two removals overlapped. The import list is now written once with the names it keeps.
- `vibelang --fix` left `pipe(x, Option.map(f), Option.getOrElse(g))` pipelines for you to rewrite with Option's methods. They now draw EK4840, whose quick fix writes `x.map(f).getOrElse(g)` through the same data-first functions.
- `vibelang --fix` left Effect `Match` chains, `Match.value(x).pipe(Match.when(…), …, Match.exhaustive)`, for you to rewrite as a `match` expression. They now draw EK4839, whose quick fix writes the `match` wherever its arms test and give the same, with the chain's type.
- `vibelang --fix` left every `Effect.gen(function* () { … })` program for you to rewrite by hand (EK1002). It now writes the body in direct style, each `yield* e` as the call that runs `e`, wherever that keeps what the program does, and EK1002's note says why where it does not.
- In JavaScript that the experimental TypeScript content mapper emits, a module in an import cycle that called a plain VibeLang function, or passed one as a callback, before the exporting module had run got programs that never ran instead of values. It now gets the values, and no fiber or runner starts.
- A running call followed by .pipe(Effect.catchTag(...)) had no catch quick fix. The compiler now offers a VibeLang catch rewrite for a single catch operator.
- `--fix` could leave an unnecessary `Effect.succeed` in a rewritten catch arm. It now simplifies that handler.
- A missing `tsconfig.json` could leave the compiler or bundler retrying forever. It now stops with TS5058.
- The runtime loader could claim an included dependency source was excluded by the project. It now explains that no loader output is available and the dependency needs compiled JavaScript or its own project.
- Webpack could keep a stale bundle after compiler backend or build-dependency changes. Those changes now trigger a rebuild.
- Watch mode could rebuild after an unrelated sibling directory changed. It now ignores those events.
- Redirected watch output could contain terminal-clearing sequences. Output is now cleared only on a terminal.
- A nonincremental `noEmit` build could say a JavaScript output was missing. It now explains that this configuration requires rechecking.
- Cache debugging could say a file changed during compilation when it changed just before it. The message now includes the timestamp safety margin.
- The starter could generate a reserved npm package name. It now normalizes reserved names.
- A long target name could generate an invalid npm package name. The starter now limits package names to 214 characters.
- A target that was a file could produce a filesystem exception. The starter now reports that the target is not a directory.
- A missing package-manager executable could produce an unhelpful spawn error. The starter now names the missing executable.
- The starter's next-step `cd` command could break on spaces or shell characters. It now quotes the directory path.
- An npm-created project's README could tell you to run Bun commands. It now uses the selected package manager.
- A program that loads `.vibe` modules from many workspace packages through `vibelang/register`, `vibelang/bun` or a bundler plugin was slow to start with an empty cache: each package's compile type-checked the sources of every workspace package it imports, so a package was checked again for each package that imports it, and a 22-package program took 30 to 40 s to start, against 10 s without VibeLang. Each compile now checks only its own project's files, and the packages it imports only supply types to it, so that program starts in 20 to 25 s. A type error in an imported package's file now stops the import of that package's `.vibe` modules instead of the importer's.
- Each compile of `vibelang/register`, `vibelang/bun` and the bundler plugins started Node to run the `vibelang` launcher, which only finds and starts the native compiler, adding about 70 ms per project. The loaders now start the native compiler themselves.
- VibeLang's ESLint parser failed on a file with an `import` keyword that starts no call, such as `import<A0`, which TypeScript parses without a syntax error and its checker rejects. It now converts the keyword as typescript-estree does, as a `TSImportKeyword` node, so ESLint reports the file's other problems too.

#### Docs

- The release notes repeated fixes and placed some before their section; fixes now appear once in the bug list.

- The contributor compiler-case command could run without runtime dependencies. It now installs them before the case suite.

- Links to inline HTML anchors in the synced documentation did not jump to their sections; synced pages now preserve those anchors and resolve specification links to them.
- Completion could hang the language server in a file with a call left open after an earlier closed one, such as a second `pipe(` typed below `pipe(o, Option.getOrNull)`: matching the earlier `)` searched the whole file and found the later `(`. It now searches only before the token, as TypeScript does.
- The compiler crashed on a file with a broken import whose recovery left a nameless binding, such as `import { Control, handle, resumeWithion nee "vibelang-runtime"`, beside an Effect error class: looking for the empty name in the rewritten code walked past its end. An empty name now matches nothing.
- Language design inconsistencies were missing from these notes. They now list
  confirmed issues, examples and safe patterns in [Known design issues](#known-design-issues).
- Platform-global examples could fail when copied from the page. The page now includes the context needed to compile its browser-service, import and export examples.
- Search descriptions could contain fenced source code. The site now skips code blocks when choosing a page description.
- The site's 404 page could appear in search results. It now tells search engines not to index it.
- Saving a captioned test example could fail with missing helper names. Test files now import what they test; shared fragments no longer claim to be standalone files.
- The language skill incorrectly sent transformed schema fields to `Schema.Struct`. It now explains that a schema declaration can use those fields.
- The language skill used a diagnostic code that does not exist. It now names a code the compiler reports.
- The devtools guide said platform values could be imported or passed directly. It now describes the restrictions in [Platform code](#platform-code).
- The platform installation guide could install mismatched package versions. It now uses the [exact-version setup instructions](../setup/existing-project.md).
- The language skill showed outdated config access and omitted a complete scoped-file example. It now uses Effect 4's `Config.String` and shows scoped cleanup.
- Migrating files with the same stem could overwrite emitted output. The [migration guide](../setup/existing-project.md) now explains the collision and how to rename files.
- Starter tracing instructions were missing. The [getting-started guide](../013-getting-started.md) now shows how to opt in during development.
- Declaration consumers were not told the minimum TypeScript version. The [installation guide](../getting-started/004-installation.md) now requires TypeScript 5.7 or later.
- The Bun test recipe omitted declaration and project setup. The [CLI guide](../setup/vibelang-cli.md) now includes both.
- The Bun preload instructions could imply that watch and hot reload rebuild VibeLang files. The [CLI guide](../setup/vibelang-cli.md) now explains their limits.
- The formatting guide implied that every comment prevented formatting. It now limits that refusal to comments in rewritten clause chains.
- The examples README did not state the required Effect version. It now gives the exact pin.
- macOS VSIX instructions could fail because `code` or `cursor` was not on `PATH`. The [editor guide](../setup/vscode.md) now includes shell-command setup.
- The proposals page described shipped bundler adapters as future work. It now identifies the adapters already available.
- The repository home page showed benchmark results without measurements. It now gives commands to reproduce the benchmarks.
- The agent essentials used an undeclared layer binding. The example now declares the layer before providing it.
- The language skill claimed Node and Bun entries supplied Locks. It now requires an explicit Locks layer and explains its platform limits.
- The diagnostic guide omitted registered codes and their repairs. It now lists them and checks coverage against the compiler registry.

- The diagnostic appendix omitted the native call-error codes named by trailing-block migration; it now lists `TS2345`, `TS2554` and `TS2769` with their triggers.
- The entry-migration guide described rewriting unmarked `main` functions and retaining retired runtime helpers; it now limits repair to platform-marked modules, names the explicit runners and explains when repair refuses.
- The retired-forms migration guide could fail to publish because its spec links escaped the user-docs root; those links now use the specification’s published URLs.

- The diagnostic guide omitted the adjustable editor warning EK9100. It now identifies its default severity and editor-only behavior.
- The platform guide lacked a complete HTTP request that read the response body. It now checks a JSON request with FetchHttpClient.layer.
- A copied module-block Node import could fail because the starter disables Node declarations. The guide now installs @types/node and enables those types explicitly.
- The process exit guidance did not explain numeric main returns. It now states that normal return exits 0, failure exits 1 and interruption exits 130.
- Bun starter instructions could imply the generated app ran on Bun. They now distinguish the package manager from the Node runtime and link to Bun runtime setup.
- A platform import in a shared module could appear to supply services. The guide now explains that non-entry imports are removed and the entry must supply the platform.
- The Bun stack guide discussed only source-loader locations. It now also explains unmapped emitted-JavaScript stacks and the Node source-map command.
- The Vitest recipe could exclude test sources through the app project. It now selects a separate test project and includes a Node test-runner recipe.
- The React and Vite guides incorrectly required import rewriting for vite build. They now explain the plugin enables it automatically and distinguish direct CLI emission.
- The Vue and Svelte guides incorrectly required import rewriting for vite build. They now explain the plugin supplies it and keep the separate CLI requirements.
- The Vue and Svelte guides said an excluded VibeLang test fails with ENOENT. They now show the project-include error and the glob that repairs it.
- The Vue build guide omitted unresolved imports alongside vue-tsc's rewrite errors. It now identifies TS2307 for ./todos.vibe in runtime.ts and TodoBoard.vue.
- The late diagnostic reference omitted statement, escaping-fiber and mapper guidance. It now explains EK1017, EK4838 and the editor-only EK9101 with their repairs.
- Calling a program value whose type is an Effect intersected with other members, such as an Alchemy Worker (`Effect<Worker> & Named<...>`), reported `TS2349`. The call now runs the program, as it does for a plain `Effect`.
- Compiling a project of several `.vibe` files with declarations on could stop with "fatal error: concurrent map read and map write", because the declaration files of different files were written in parallel over shared state. Each file now works from its own copy, and the compiler finishes.
- An unfinished top-level `await` statement in a module, such as `export {}; await + f(const 0 await !x`, parsed its last tokens twice, into two overlapping statements. The parser now keeps one.
- Formatting a file twice could indent a line again when the first format moved a statement onto a line of its own and the statement continued on the next line: a call's arguments, as in `{{0!\n("")}}`, a binary operator, as in `{{x\n+ y}}`, or a `%` operand. The first format now gives the final indentation.
- Abstract classes could silently become services, and service defaults used a different contract from Effect; services now use `service` declarations and `defaultValue` thunks checked as `() => Shape`.
- The same `A!E` annotation meant different types on a function and a service member; omitted slots now mean `never` everywhere.
- Workspace dependency cycles could make `setup` miss Bun preloads and Vite wiring for packages that imported migrated code. Every package that reaches the code is now wired.
- A passing compiler-case suite gave no warning when a case or phase became slower; `scripts/bench/case-timings.mjs` now compares repeated timing reports, flags median increases over `50%` without blocking correctness checks, and rejects incomplete or mismatched evidence.
- ESLint rules saw adjacent generic openings such as `F<<T>(x: T) => T>` as one `<<` token; they now receive both `<` tokens at their source positions, while left-shift operators stay intact.
- Knip reported a public export as unused when its JSDoc followed a statement separated by CR, U+2028 or U+2029; these line terminators now keep the tag just as LF and CRLF do.
- Knip reported an export marked with `@public` as unused when the comment followed an earlier statement on the same line; the adapter now preserves the context Knip reads in TypeScript.

- Concurrent array operations rejected `any` operands even though TypeScript admits them; `try.all`, `try.race`, `try.any` and `try.allSettled` now use TypeScript array assignability.

### Known gaps

- The latest completed full validation suite is red. Failures include compiler acceptance and diagnostic reporting, automatic migration, cleanup and runtime exports, bundler resolution of declaration sidecars, declaration comparison, and documentation examples. Some checks also fail because their recorded expectations no longer match the current rules. A passing release-notes check does not establish that the language passes its full suite.
- At release review, the conformance inventory recorded **40 confirmed open classes** and **2 awaiting fresh verification**. A class groups related examples with one underlying disagreement with the specification; it is not a count of failing tests. They cover source admission and diagnostics, Effect and Promise boundaries, pattern matching, lexical scope, resource cleanup, services, declarations, and JSX integration. This is an incomplete inventory based on earlier compiler snapshots; subsequent fixes still need fresh verification.
- Declaration identity with stock TypeScript (`tsc`) is incomplete. The latest full-suite failures include namespace-imported types, some `data` declarations, and optional or defaulted parameter signatures after migration. Written relative import spellings can also differ. Compare the emitted `.d.ts` API with the original TypeScript declarations before shipping a migrated library.

### Known bugs

These bugs were found and confirmed and are being fixed; please don't re-report them, and each entry moves to the fixed list when its fix lands.

- A `tsconfig.json` broken so that it parsed with a computed property name, such as one with an unterminated string before `"lib": ["esnext"]`, crashed the compiler while it looked for the legacy `vibelang.diagnostics` setting. Looking up a setting now skips names that have no text, and the file's syntax errors are reported.
- Vite cannot load tests when the project's path contains `#`, even in a plain project without VibeLang. Use a directory path without `#`.
- Under Yarn Classic, `import { NodeRuntime } from "@effect/platform-node"` fails at startup unless `redis` is installed, because the package's root module loads its Redis integration. Import the module itself instead: `import * as NodeRuntime from "@effect/platform-node/NodeRuntime"`.

#### Generated names

- Your names can collide with the compiler's own names: for example,
  `answer$direct`, `sum$recur`, `work$try`, `$match1`, `$is`, `$noMatch`,
  `$awaitAll`, `$forConcurrent` or `Users_base`. Calls and patterns can use
  your value, or generated JavaScript and declarations can contain duplicate
  names. A local `SyntaxError` can also break the generated error check for
  `JSON.parse`. Rename the colliding source binding (see Known design issues).

#### `this`/`arguments`/`super` in effectful functions

- An effectful arrow that uses `this` only in a parameter default, a nested
  class's `extends` expression or a computed member name can lose its receiver
  and throw (see Known design issues). Capture `this` in a local before the
  arrow and use that local.
- A named effectful function expression that calls or returns its own name
  can refer to a generator instead of the function: retries can crash and
  recursion can overflow the stack. A declaration's self-reference in a
  parameter default can also return the wrong function. Use an anonymous
  function referring to its outer variable, and avoid self-referencing defaults
  (see Known design issues).
- `super.count++`, `--super.count` and computed compound assignments such as
  `super[key()] += value()` in an effectful method can produce JavaScript
  that fails to load or an invalid assignment target. Use separate reads and
  simple assignments, saving a computed key once (see Known design issues).
- A nested effectful arrow that reads `arguments` can see a different object
  from its enclosing function; mutations can also carry over between runs
  of the same program. Capture `const args = arguments` in the enclosing
  function body and share that local (see Known design issues).
- A producer that reads `arguments[0]` can yield `undefined` instead of its
  first argument. Use named parameters in the producer body
  (see Known design issues).
- An effectful arrow created in a constructor can see `new.target` as
  `undefined`. Capture `const target = new.target` in the constructor and
  read `target` from the arrow (see Known design issues).

#### Evaluation order

- `||` and `??` inside a program argument can test the cold Effect object
  instead of the call's result, skipping a fallback that should run. Pass a
  block program that stores the expression in a local before returning it
  (see Known design issues).

  ```vibe
  // fragment
  Effect.retry(first() || second(), { times: 0 })
  Effect.all([absent() ?? fallback()])
  ```

- Continuing an optional chain after an effectful call, as in
  `box?.read().value`, can throw when `box` is absent. Check the receiver
  explicitly before calling and reading the result.
- A value pipe such as `source() |> sink.take(%)` can read the stage's getter
  or function before running `source()`, reversing side effects or calling
  an old function. Store the left value in a local before applying the stage
  (see Known design issues).
- A trusted method call with effectful arguments can evaluate those arguments
  before looking up the method. Optional trusted calls can run arguments
  that should be skipped and can then throw. Check optional receivers and
  callables first, and save the method before evaluating its arguments.
- A `sync` or `try` hatch returning a scalar-or-Promise union can hand back
  an unresolved Promise despite a scalar result type; ordinary data with a
  non-callable `then` property can instead be treated as a Promise and crash.
  Use an async callback for mixed returns; for data with a `then` field,
  call the runtime's `sync` from a `module` block, where it is an ordinary
  function.
- `try(evaluate, makeMapper(), input())` can run `input()` before
  `makeMapper()`. Evaluate the mapper and inputs into locals in written order
  before calling the hatch.
- `wire(makeA(), makeB())` can evaluate layer factories in dependency order
  instead of the order you wrote, changing their side effects. Build the
  layers into locals in written order, then pass those locals to `wire`.
- `for concurrent(limit()) (const item of items())` can evaluate `items()`
  before `limit()`, even selecting an old collection and skipping work.
  Evaluate the limit into a local before the loop.
- A function with an Effect contract whose body compiles to plain
  JavaScript, such as `function twice(n: number): number!! { return n * 2 }`
  or `(x): number!! => x + 1`, is accepted where only a plain function fits:
  at a module's top level, in a plain function, as a plain callback, or as
  an overload's plain candidate. It runs synchronously there, and adding a
  pause to its body later turns each such use into an error. Call it only
  from Effect code, or remove the Effect contract if it is meant to be plain.

#### Errors

- When both a `try` body and its `finally` fail in an otherwise plain
  function, cleanup can replace the original failure instead of preserving
  both causes. An outer catch can receive the cleanup error instead of the
  original one (see Known design issues).
- A call in a catch binding's default can fail or need a service that the
  function's checked contract and declarations omit. Move destructuring
  and defaults into the catch body.

  ```vibe
  // fragment
  try { work() } catch ({ id = fallback() }) { return id }
  ```

- An error subclass without its own constructor can lose its own fields when its base has a custom constructor that rebuilds the argument object.
- An error subclass such as `error Child extends Base<number>` can be
  rejected because its generated constructor forgets the base's type
  arguments. Write an explicit constructor accepting the base and subclass
  fields and passing them to `super`.
- Throwing `Cause.fail(...)` inside an otherwise plain function can give
  `catch` the whole Cause instead of its error; `Cause.die(...)` can even
  be caught as an expected failure. Use `Effect.failCause` explicitly.
- A trusted tagged-template call can let its declared expected error escape
  as a defect, bypassing `catch`. Use an ordinary call to the trusted function
  where its API supports one.

#### Concurrency and resources

- Aggregate joins and races can hang during cancellation if one child's
  cleanup waits for another child's cleanup: children are interrupted one at
  a time. Avoid dependencies between sibling finalizers; when managing fibers
  explicitly, `Fiber.interruptAll` signals them together.
- `using` looks up `Symbol.dispose` or `Symbol.asyncDispose` again at cleanup
  time. Replacing the method, or using a getter that returns different methods,
  can run the wrong disposer. Keep the disposal method stable for the lifetime
  of the binding.
- `join tasks` can read object getters or array entries twice, joining a
  different child from the one used for cancellation. Copy the selected fibers
  into a plain collection once before joining.
- `join` rejects a valid `Record<string, Fiber.Fiber<number>>`, yet can
  accept a record whose index signature also permits non-fibers and then
  crash. Use an object with explicit fiber properties, or map valid dictionary
  entries through `Fiber.join` and `Effect.all`.
- Assigning to a `const` binding in a `for concurrent` head is accepted and
  changes the value, including destructured bindings. Keep those bindings
  unchanged; introduce a separate local for mutable state.
- A `for...of` whose destructuring default runs an Effect can leave its
  iterator open when that default fails. Move the destructuring and default
  into the loop body.
- Array destructuring such as `const [n = fallback()] = values` can leave
  its iterator open if the Effect default fails. Destructure first, then run
  the fallback after destructuring has finished.
- An effectful `for...of` over an array with a custom iterator can skip
  iterator cleanup on failure. Bind the array as `Iterable<T>` before looping
  so it uses the protected iteration path.

#### Services and layers

- A service's `static readonly defaultValue` is not checked against its declared
  shape or method contracts. Wrong value types, hidden failures or plain
  methods where Effect methods are required can compile and then fail or
  return the wrong type. Use an explicitly checked provider such as
  `Layer.succeed` for the implementation.
- Providing a choice between layers or contexts can claim that every branch's
  services are available, even though only one branch runs. Missing-service
  failures then appear at runtime despite a closed contract. Branch around
  separate provider blocks, or make every branch supply the required services.
- A possibly empty array of layers can count as providing its element type's
  services even when the array is empty. Use a nonempty provider tuple or
  provide the required layer directly.
- Calling `wire` through an import alias, a namespace or a tuple spread can
  skip dependency ordering and fail with a missing service. Use the direct
  `wire(layerA, layerB)` form with explicit arguments.
- `wire(layer)` can erase a layer's requirement for the same service it
  produces, even though building that layer still needs an external provider.
  Use the layer directly and supply its input service.

#### `match` and `data`

- Matching `Option<A> | string` with the Option arms first can be rejected
  because the generated tests require an already narrowed Option. Put the
  disjoint `String` arm first.
- A match covering every nested data variant can still be reported as
  non-exhaustive. Match the nested field separately, or add a fallback arm.
- A nested property pattern that both tests and binds a getter's value can
  read it twice, binding a different value from the one that passed the test.
  Read the property into a local and match that saved value.
- A variable pattern named `String`, `Number` or another built-in matcher
  can ignore your binding and use the built-in test; a data type named
  `Option` can be mistaken for Effect's Option. Rename the source binding
  (see Known design issues).
- A custom extractor inside an `or` pattern can be
  rejected because its generated result is not kept for narrowing. For `or`,
  use separate adjacent match arms instead.
- The final arm of an exhaustive data match can skip evaluating the matcher
  expression, including its getters. Store the matcher value in a local before
  matching if its lookup must run (see Known design issues).

#### Modules and declarations

- A dynamic import of a VibeLang source can keep the source extension when
  extension rewriting is disabled, or fail to escape URL characters such as
  `#` when it is enabled, so the emitted module cannot be loaded. Use a static
  import where possible.
- Importing Effect's `pipe` under another name can reject a program argument
  that works with the name `pipe`. Keep that import named `pipe`
  (see Known design issues).
- CommonJS imports of source modules with spaces or URL characters in their
  names can request an encoded filename that does not exist. Rename the
  source module to avoid those characters.
- A service inside a namespace can work at runtime but lose its service-key
  API in generated declarations, so TypeScript consumers reject it as a
  provider key. Declare and export the service at the top level.
- A generated `.d.ts` types an exported function with no return contract
  and a body that compiles to plain JavaScript, such as
  `export function double(n: number) { return n * 2 }`, as returning an
  Effect. A consumer compiled against the `.d.ts` instead of the source
  gets unrun Effects from `[1, 2].map(double)`, with no diagnostic, and
  `double(2)` at its top level is `EK1001`. Give such an export a plain
  return contract, `double(n: number): number`, which the `.d.ts` keeps.

#### `--fix` and the formatter

- Formatting can reorder value imports and change the order in which their
  modules initialize, changing program behavior. Disable import-declaration
  sorting in the formatter settings when initialization order matters.
- `--fix` can discard comments when converting tagged error fields or
  unwrapping `Effect.succeed` and `Effect.fail`. Preserve those comments when
  applying the change manually.
- Converting `catchTag` or `catchTags` to a class pattern can stop catching
  a copied or structural error that has the right `_tag` but no class
  prototype. Keep a structural tag pattern, or keep the original call.
- Converting `catchTags` can reuse one handler's parameter as the shared
  catch binding and capture a different handler's outer variable, changing
  its result. Apply the rewrite manually with a fresh catch binding
  (see Known design issues).
- Import cleanup after a form rewrite can remove an entire import and
  silently skip that module's initialization. Retain a side-effect-only
  import when its initialization is needed (see Known design issues).
- Converting `Effect.provide(programExpression, layerExpression)` to a
  provider block can evaluate the layer before the program expression.
  Evaluate the program into an explicitly Effect-typed local first, then
  evaluate the provider and run the saved program inside its block
  (see Known design issues).
- Converting a `Context.Service` class can delete evaluation of a dynamic
  key expression such as `keys.pop()`. Keep the original declaration when
  evaluating the key has side effects (see Known design issues).
- The editor's quick fix from a tagged error class can truncate a constrained
  generic parameter or a comment containing `extends`, leaving invalid syntax.
  Preserve the full type parameter list when converting manually; CLI `--fix`
  refuses this malformed edit.
- One `--fix` invocation can stop after 16 rounds with deeply nested,
  overlapping fixes still available. Run it again until it reports no edits.

### Known design issues

The language design has these confirmed inconsistencies; the specification is
being revised, programs that rely on them may change, and each change will be
listed with an upgrade step.

- **A parameter type can move argument work in time.** An `Effect` parameter
  passes the whole call expression by name, so even its receiver and inputs
  can run again on every retry, after later arguments have already run.
  A mixed `Effect<number> | number` parameter or an unfixed generic `T`
  instead runs the argument at the call; fixing `T` from another argument
  can change that choice. Overload selection can choose this strategy and
  a callback's function-or-program representation. The same issue reaches
  program topics in pipes and elements passed to `Effect.all`.
  Vladimir Kalnitsky raised the central call-argument issue. Today, save
  inputs in locals when they must run once, and use an explicit block program
  when work must repeat; check the selected signature after library updates.

  ```vibe
  // fragment
  retry(fetchUser(nextId()), policy) // nextId can run on every attempt
  acceptMixed(fetchUser(nextId())) // Effect<User> | User: runs at the call
  acceptGeneric(fetchUser(nextId())) // unfixed T: runs at the call
  ```

- **Annotations can run a value or hold it as a program.** An inferred
  binding runs a call, while an explicitly Effect-typed `const` holds it;
  object fields, conditional initializers and factories add more holding
  rules. A factory's outer body can run while constructing the held program.
  At a return boundary, whether an Effect subtype is data also depends on
  the written or contextual success type, so widening it can stop work from
  running. Today, use `const p = () => work()` to defer work explicitly,
  save construction inputs separately, and call a returned program as `p()`
  when execution is intended, including in release callbacks.

  ```vibe
  // fragment
  const value = work() // runs here
  const held: number!! = work() // holds a program
  const explicit = () => work() // explicit deferred body
  ```

- **Some helper aliases need explicit checking.** Aliasing helpers such as
  `pipe` can lose their special handling. Retain documented helper names
  and verify that an alias preserves the intended behavior.

  ```vibe
  // fragment
  const helper = { runSync: (n: number) => n * 2 }
  const doubled = helper.runSync(21) // can suppress the entry for main
  ```

- **Plain `finally` and Effect `finally` combine failures differently.**
  The plain JavaScript path can replace the body's failure with cleanup's
  failure; the Effect path retains both causes. Adding an Effect operation
  can therefore change the error an outer catch receives. Today, keep fallible
  cleanup in an explicit Effect program and combine it with the body using
  `Effect.onExit`; avoid relying on plain `finally` to preserve both failures.

  ```vibe
  // fragment
  try { throw new BodyError() }
  finally { throw new CleanupError() }
  ```

- **Module names that differ only in letter case are one module.** A
  module declaration compiles to a file named for it in lower case,
  `main.vibe.state.js`, so `module State` and `module state` in one file are
  EK4408, unlike two bindings. Today, use names that differ by more than case.
- **A generic return type can decide whether a result runs.** Calls whose
  instantiated return type is Effect run their result, while mixed unions
  and structured Effect subtypes can remain data; an optional call has its
  own running rule. A generic identity helper is therefore not necessarily
  an inert pass-through for a program. Today, avoid routing program values
  through such helpers: return a holder such as `{ program }` to keep one
  as data, and call `holder.program()` explicitly when it should run.

  ```vibe
  // fragment
  declare function identity<T>(value: T): T
  identity(savedProgram) // instantiated Effect result can run
  ```

- **A plain return annotation changes foreign-call failure handling.**
  A TypeScript call that needs a trust boundary in an Effect function can
  become an ordinary call inside a plain-annotated helper; trusted listed
  failures can become defects rather than enter E. A plain annotation is
  therefore no proof that foreign code cannot throw. Today, use an explicit
  `try` hatch to map expected exceptions and declare the resulting error
  contract, including inside helpers; do not use a plain wrapper to bypass
  a boundary diagnostic.

  ```vibe
  // fragment
  function plain(n: number): number { return foreignRisky(n) }
  function computational(n) { sleep("1 millis"); return foreignRisky(n) }
  ```

- **Completing an error contract can change what callers see.** Callers
  of a function with a written E see its declared error family, while
  callers of one without a contract see the narrower inferred errors. Check
  emitted declarations after extracting a signature.
- **Timeouts and races can discard cleanup failures.** The promise that
  cleanup failures are preserved applies to local finalization, but pinned
  Effect's `timeout`/`race` can discard a losing fiber's final exit, including
  its cleanup failure. Today, record failures inside the child's finalizer
  before it exits; if every cause is required, manage and observe each
  child's `Exit` explicitly rather than relying on the race's parent cause.

  ```vibe
  // fragment
  timeout(() => {
    try { sleep("1 hour") } finally { throw new CleanupError() }
  }, "10 millis") // parent can report only TimeoutError
  ```

- **Effect member lookup depends on declaration conventions.** Synthesized
  data methods depend on a receiver parameter named `self`, `*OrOptions`
  or a special-case table. Real members and a module's own exports win over
  synthesized methods and same-named service exports, so an Effect update
  can silently redirect a call. Today, keep the exact Effect pin, prefer
  explicit module functions such as `Stream.take(stream, 3)`, and call a
  service through its explicit key when a module export would be ambiguous.

  ```vibe
  // fragment
  stream.take(3) // synthesized from the library declaration
  Stream.take(stream, 3) // explicit module function
  ```

- **Construction and execution phases are not fully specified.**
  Defaults, destructuring, getters and collection iteration do not share
  one complete phase rule with cold calls, factories and held values. A
  reusable Effect also need not recreate a captured iterator, hot Promise
  or resource. Today, evaluate once-only inputs into locals, create fresh
  inputs inside an explicit program when each run needs them, and avoid
  side effects in defaults or getters at these boundaries.

  ```vibe
  // fragment
  const shared = () => consume(iterator) // captures one iterator
  const fresh = () => consume(makeIterator()) // creates one per run
  ```

- **Generated bindings lack one general capture-avoidance rule.**
  The specification has local naming fixes but no universal requirement that
  generated names preserve every source binding. A legal user name can
  therefore be captured by a generated helper. Today, avoid the compiler
  helper names listed under Known bugs and rename a colliding local.

  ```vibe
  // fragment
  const savedAnswer = 99 // avoid a helper name such as $match1
  const answer = match (1) { when 1: savedAnswer; default: 0; }
  ```

- **Moved function bodies lack one complete lexical-context rule.**
  The specification's separate receiver and closure promises do not cover
  every use of `this`, `arguments`, `new.target`, `super` and a named
  function expression's self-binding through suspension and reruns. The
  implementation symptoms and repairs are listed under Known bugs. Today,
  capture source activation values before creating effectful arrows, use
  named producer parameters, and use simple `super` reads and assignments.

  ```vibe
  // fragment
  const receiver = this
  const later = () => { sleep("1 millis"); return receiver.value }
  ```

- **A generator's annotation selects its runtime protocol.** An unannotated
  `function*` is a Stream producer, while an explicit `Generator` or
  `AsyncGenerator` return annotation selects a native JavaScript iterator.
  Adding a type can therefore change how the result is consumed and which
  operations are allowed. Today, keep native generators in a `.ts` module
  and use a VibeLang producer consistently for Stream work.

  ```vibe
  // fragment
  function* produced() { yield 1 } // Stream producer
  function* native(): Generator<number> { yield 1 } // JavaScript iterator
  ```

- **Separate compilation has no complete semantic metadata contract.**
  The specification promises checked handler and callable behavior across
  packages while also saying some control metadata is not emitted
  or read. An Effect-shaped declaration alone cannot certify a foreign
  callback's fiber behavior or a factory's construction phase. Today, keep
  compiler and runtime versions aligned, inspect emitted contracts, and
  keep handler-sensitive code together or behind explicit trusted adapters;
  do not infer continuation safety from a `.d.ts` return shape alone.

  ```vibe
  // fragment
  declare function externalWork(): number!! // shape alone is no certificate
  const p = () => externalWork() // verify the boundary before using a handler
  ```

- **A type-correct rewrite can still change behavior.** Automatic fixes and
  optimizations lack one common requirement covering values, causes, evaluation
  phase, bindings and ownership. Checking that a rewrite adds no errors does
  not prove those observations are preserved; even an exhaustive final match
  test can have an observable getter. Today, review automatic fixes, preserve
  explicit scopes and once-only locals, and compare effects and cleanup in
  tests before accepting a rewrite at these boundaries.

  ```vibe
  // fragment
  Effect.provide(makeProgram(), makeLayer())
  provide makeLayer() { makeProgram() } // construction order can change
  ```

- **The specification makes EK4802 an error by default; the compiler still
  warns.** Returning an Effect value from a function that runs Effects, where
  the success type names no value, reports EK4802 as a warning until the
  compiler's default changes. Treat it as an error today: return the result,
  `return program()`.
- **The specification says a hatch waits only for a function written
  `async`; the compiler still waits for a promise that a synchronous hatch
  function returns.** Today `sync(() => Promise.resolve(5))` succeeds with
  `5`; under the specification it succeeds with the promise itself. Write the
  function `async` when you mean to wait, which both treat the same way.
- **The specification makes EK9100 an error that no setting lowers; the
  compiler warns in the editor only and a project can set it.** Write the type
  it asks for, which both accept.

### Known limitations

- An interruption that arrives while a `using` initializer runs in a mask
  of its own, as in `using r = Effect.uninterruptible(() => open())`, is
  delivered as that mask ends, before `using` receives the value, as Effect
  delivers it. A Disposable made there is not released. Acquire it with
  `using r = Effect.acquireDisposable(() => open())`, which registers its
  disposal inside the mask.
- Platform checks are static, lint-strength checks, not a sandbox. Aliases
  such as `const g = globalThis; g.process.pid`, calls through `as any`,
  and `Reflect.get` can bypass them. See [the scope of platform checks](../platform/platform-globals.md#limits-of-static-checks).
- `Intl.DateTimeFormat().format()` reads the current clock without EK4403
  when no argument is supplied. Read time with `Clock` and pass the value
  explicitly. See [clock-check limitations](../platform/platform-globals.md#limits-of-static-checks).

### Platform

- The file that exports `main` names its platform once with
  `import "vibelang/platform/node"` (or `"vibelang/platform/bun"`,
  `"vibelang/platform/browser"`). When `main` needs services of that
  platform's bundle, such as `FileSystem` and `Path`, the compiled module
  runs it with the bundle's layer, so `main` no longer writes
  `provide NodeServices.layer`. The import loads nothing; the compiler removes
  it. A `provide` inside `main` still wins, tests provide their own layers,
  and EK3205 names only the services the layer does not provide, with the
  layer that provides each of Effect's and the experimental ones. Without the
  import, nothing changes, and EK3205 names the import that would provide
  the platform's services. A file names one platform: a second, different
  platform import is error EK3206.

### Experimental platform APIs

- `Experimental`, in scope in every `.vibe` file, holds what Effect lacks.
  Each service has its own key; it is experimental and goes when Effect ships
  the API. See
  [Experimental platform APIs](../vibelang-features/118-experimental-platform-apis.md).
  - `Experimental.FileSystem` adds `access(path, { executable })`,
    `open(path, { nonBlocking })` and `File.chmod` to Effect's `FileSystem`.
    `lstat` is Effect's own since 4.0.6.
  - `Experimental.Crypto` adds `hmac`, `sign` and `verify` (ECDSA P-256 and
    Ed25519), with secret keys as `Redacted<Uint8Array>`, beside the members
    of Effect 4.0's `Crypto`, which Effect 4.1 replaced with `effect/crypto`.
  - `Experimental.Process` reads the process id, platform, architecture,
    executable, versions, host name, available parallelism, time origin and
    memory use, and signals processes with `kill` and `isRunning`. Its native
    `homeDirectory` query follows `os.homedir()` account fallback; Effect's
    `UserDirectories.home` resolves the configured environment. Browsers have no
    `Process` layer.
  - `Experimental.Locks` holds Web Locks with `hold`, `tryHold` and `query`.
    Node.js's `ExperimentalNodeLocks.layer` locks only within one process; Bun has no
    layer.
- The experimental `FileSystem` and `Crypto` keys are class services, as
  Effect declares them. `Experimental.FileSystem.Service` is a superset of
  Effect's interface, but the service is not Effect's: a layer of Effect's
  `FileSystem` does not provide it.
- `vibelang-runtime/experimental/platform-node`, `-bun` and `-browser` hold
  the layers. `ExperimentalNodeServices.layer` and `ExperimentalBunServices.layer` there are the
  platform bundles plus `FileSystem`, `Crypto` and `Process`, and
  `ExperimentalBrowserServices.layer` provides `Crypto`, Effect's crypto
  services and `Locks`. A layer of a service that extends Effect's provides
  the experimental service and Effect's from one implementation, and a
  `Crypto` layer provides the platform's Effect crypto services too.
- `vibelang-runtime` lists `@effect/platform-node`, `@effect/platform-bun` and
  `@effect/platform-browser` 4.1.1 as optional peer dependencies.
- EK4402 names the experimental service instead of a hatch, with no import:
  `Experimental.FileSystem` for `X_OK` and `O_NONBLOCK`, `Experimental.Process` for `os.hostname()`,
  `process.pid`, `process.kill` and the other calls it replaces, and
  `Experimental.Locks` for `navigator.locks`. It names Effect's own
  `FileSystem.lstat` for `lstat`, `Experimental.Process.homeDirectory` for
  native `os.homedir()`, and `effect/crypto`'s `Mac`, `Signature`, `Aead` and
  `Cipher` for HMAC, signatures and ciphers.

### Prelude

- Every module of `effect`'s subpath packages is in scope without an import,
  as the root's modules are: `HttpRouter`, `HttpClient`,
  `ChildProcess`, `ChildProcessSpawner`, `TestClock`, `Hex`, `SqlClient` and
  the rest. Imports you already have keep working and shadow the global. Where
  two names meet, a JavaScript or shared web global wins (`Headers`,
  `Response`, and now `Event`), then a root module (`Utils`); `Model` and
  `Prompt`, which two subpath packages share, still need an import, and
  TS2304 names both. With the DOM in `lib`, the bare name `Worker` is now
  `effect/workers`' module; use `globalThis.Worker` inside a hatch or TypeScript module for the DOM constructor.
  [Effect's modules](../getting-started/008-importing-effect.md) lists every
  collision.
- A module's name also names its export of the same name, wherever the module
  has no meaning of its own, a deliberate change from TypeScript: the
  type `Option<number>` is `Option.Option<number>`, `FileSystem.readFileString(path)`
  calls the `FileSystem` service with no import, `FileSystem()` is its
  implementation, and a member the module lacks reads the export, as
  `FileSystem.of` does. A service's value member reads from its
  implementation, `Path().sep`; `Path.sep` is EK4503, as it is on the key. The module's own exports win, so `Option.some` and
  `FileSystem.layerNoop` keep their meaning and `Option.Option<A>` still
  compiles. The same holds after `import { Prompt } from "effect/ai"`, and
  for the experimental services: `Experimental.Process.hostname()`
  calls the `Process` service with no import. In a
  type, the DOM's `Cache`, `Console`, `FileSystem`, `Scheduler`,
  `Transferable` and `Worker` lose their bare names; alias one in a `.ts`
  file to use it.
- An error on a name these rules settle says which meaning the name has and
  how to reach the other: `function send(m: Message)` (TS2709) names Effect's
  `effect/cluster/Message`, `new Worker("./worker.js")` (TS2351) names
  `globalThis.Worker` for the DOM's, and `Number.sum(1, 2)` (TS2339) says
  JavaScript's `Number` wins and suggests
  `import { Number as EffectNumber } from "effect"`.
- `vibelang --fix` removes the imports these make redundant and writes
  `M.M` as `M` where the module's name means its export:
  `FileSystem.FileSystem.readFileString(path)` becomes
  `FileSystem.readFileString(path)` and `Option.Option<number>` becomes
  `Option<number>`. Run it once after you update.

### Platform code

- Node.js reaches a `.vibe` file only through Effect's services or by
  escaping to TypeScript. Node's globals (`process`, `Buffer`,
  `require`, `__dirname`, ...) and the web's globals that do I/O or read the
  clock or randomness (`fetch`, timers, `console`, `crypto`, `performance`,
  `localStorage`, ...) are no longer in scope in `.vibe`, holding one as a
  value included, and a `.vibe` file no longer imports a `node:*` or bare
  Node.js module as a value. Each is EK4402, which names the replacement.
  `import type` from them, ECMAScript's built-ins, the web's pure helpers
  (`URL`, `TextEncoder`, `structuredClone`, `AbortController`, ...), and
  `.ts` files are unchanged. [Platform globals](../platform/platform-globals.md)
  lists every answer. How to fix each kind:

  | You wrote | Write instead |
  | --- | --- |
  | `import { join } from "node:path"` and the like | the Effect service with no import: `Path.join(directory, name)`, `FileSystem.readFileString(path)`, `ChildProcessSpawner.string(ChildProcess.make(command, args))` |
  | `process.env.NAME` | `Config.String("NAME")()` |
  | `process.argv`, `process.cwd()` | `Stdio.args()`, `Path.resolve()` |
  | `process.pid`, `os.hostname()`, `fs.lstat` | VibeLang's experimental services, such as `Experimental.Process.pid()` |
  | `console.log`, `setTimeout`, `crypto.randomUUID()` | `Console.log`, `sleep`, `SecureRandom.uuidV4()` |
  | `Buffer.from(text)` | `new TextEncoder().encode(text)`, or `Base64` and `Hex` |
  | a Node.js value an Effect API takes, such as `createServer` | a `module` block that imports it: `module node { export { createServer } from "node:http" }`, then `import { createServer } from node` |
  | a Node.js API nothing covers yet | the same `module` block or a `.ts` file, called through a hatch |

### Repeated is binding names

| Before | After and repair |
| --- | --- |
| Two `is` patterns binding one name in one block, such as `if (a is { id: let id }) …` twice in a function body | Each `if` head was its own scope; the bindings now live in the block that holds the `if` (chapter 004, decided detail 245), so the second pattern redeclares the name: `TS2451`, or `TS2300` beside a parameter. The diagnostic offers to rename the later binding and its uses, and `vibelang --fix` applies the rename (`id` becomes `id2`). |

## 0.0.10

Update `vibelang`, `vibelang-runtime` and the bundler plugin together. This
release restores the terse contract syntax and fixes resource cleanup,
recursion and matching. It also adds diagnostics: see the migration details
under Diagnostics before updating code that compiled on 0.0.9.

### Effect 4.0.6 and failures

Use exactly `effect@4.0.6`. Update `@effect/platform-node`,
`@effect/platform-bun` and `@effect/vitest` to `4.0.6` when used, and set
the `@effect/platform-node-shared` override to `4.0.6`. The starter includes
these pins. Syntax and error-channel types are unchanged.

A failure whose cleanup crashes is now a defect, following Effect 4.0.6:

```vibe
// fragment
error Busy

function save() {
  try {
    throw new Busy()
  } finally {
    die("flush crashed")
  }
}
```

Before, `exit(save())` contained `Fail(Busy) + Die("flush crashed")`.
Now it contains `Die(Busy) + Die("flush crashed")`, in that order, and
`cause.hasFails()` is false. The same rule applies to cleanup from `using`,
producers and abandoned continuations, and to combined concurrent failures.
A `catch` does not recover these defects. Effect's typed recovery operators
(`result`, `option`, `ignore`, `catchTag`, and fallbacks) now preserve them
too; `await.allSettled` propagates the defect instead of returning a failed
`Result`. `Effect.catchDefect` sees the original error first.

A failure beside an interruption, with no defect, is now caught:

```vibe
// fragment
error CleanupFailed

function stopped() {
  try {
    interrupt()
  } finally {
    throw new CleanupFailed()
  }
}

function recover() {
  return stopped() catch () => "recovered"
}
```

Before, `recover()` propagated `Interrupt + Fail(CleanupFailed)`. Now it
returns `"recovered"`, as `Effect.catch` does: the first expected failure
reaches the handler and the accompanying interruption is dropped. Catch
statements and handler expressions follow the same rule. Interruption alone
still propagates, and pending cancellation of the running fiber still unwinds
it. VibeLang's internal abandonment signal still bypasses recovery so cleanup
cannot resume an abandoned continuation.

`retry` likewise retries a failure beside an interruption, but never a cause
containing a defect. `Effect.mapError` maps every expected failure in place and
preserves the other reasons. Code that inspects causes or depended on an
Effect recovery operator dropping a cleanup defect should be updated.

### Upgrade an existing project

Keep VibeLang packages at 0.0.10. Update Effect and its platform and test
packages together, and set the transitive peer override in `package.json`:

```json
{
  "overrides": {
    "@effect/platform-node-shared": "4.0.6"
  }
}
```

With npm:

```sh
npm install --save-exact vibelang-runtime@0.0.10 effect@4.0.6 @effect/platform-node@4.0.6
npm install --save-dev --save-exact vibelang@0.0.10 vibelang-vite@0.0.10 @effect/vitest@4.0.6
npm run build
npm test
```

With Bun:

```sh
bun add --exact vibelang-runtime@0.0.10 effect@4.0.6 @effect/platform-node@4.0.6
bun add -d --exact vibelang@0.0.10 vibelang-vite@0.0.10 @effect/vitest@4.0.6
bun run build
bun run test
```

Update only the platform and test packages your project uses; a Bun platform
project uses `@effect/platform-bun@4.0.6` instead of the Node platform.
Commit the updated lockfile. Review tests that inspect causes, recover a
failure beside interruption, or expect a cleanup defect to be dropped, using
the before/after examples above. See [Existing project](existing-project.md)
for mixed TypeScript and editor setup.

### Syntax

- The terse contract syntax is back as an alias of `Effect<A, E, R>`.
  Both spellings work in the same file; guides, the skill and the starter use
  the terse form again:

  | Terse | Means |
  | --- | --- |
  | `User!NotFound!Db` | `Effect<User, NotFound, Db>` |
  | `User!NotFound!` | `Effect<User, NotFound>`: needs nothing |
  | `User!!Db` | `Effect<User, never, Db>`: cannot fail |
  | `User!!` | `Effect<User>`: cannot fail and needs nothing |
  | `User!NotFound` on a function with a body | `Effect<User, NotFound, infer R>` |

- `Effect<User>` keeps its 0.0.8 and 0.0.9 meaning,
  `Effect<User, never, never>`. Code using the 0.0.6 shorthand compiles
  again; EK1014 is retired. Hovers and fixes show the terse form.
  EK4833 still warns only on `Effect.Effect<…>`; its fix writes the terse
  form, including `Effect.Effect<A>` and `Effect.Effect<A, E>` on a body.
  `--fix` leaves existing `Effect<…>` annotations alone.

### Resource safety

- A C-style loop head such as `for (using h = acquire(); …; …)` releases
  its resources on every exit: normal completion, jumps, return, typed failure,
  defect and interruption. Multiple head values release in reverse order.
  Effect acquisitions in the head now compile, and labeled loops preserve
  their `break` and `continue` targets.
- `for (using x of values)` disposes each element when its iteration ends,
  then closes an iterator, producer or Stream on early exit, including failure
  and interruption. Producers and Streams now run in this form; generator
  `finally` blocks that were skipped now run.
- For a JavaScript Disposable acquired with an explicit release, use the
  documented plain holder pattern: acquire `{ value: disposable }` and
  release `holder.value`. Binding the Disposable itself also invokes
  `Symbol.dispose` and can release it twice. The pending-interruption window
  between a synchronous JavaScript acquisition and registering disposal still
  exists; see [Scope](../resource-management/030-scope.md).

### Correctness

- Plain recursive call cycles start with fast JavaScript calls and continue
  on heap frames at the eager depth limit, avoiding stack overflow for deep
  recursion. Calls through synchronous callbacks and functions with a plain
  return annotation still have JavaScript's stack limit.
- `match` and `is` read their subject once, including property getters,
  optional chains and patterns that perform several tests. An arm's binding
  no longer shadows the subject before it is read. Exhaustive matches over
  discriminant properties and optional-chain subjects retain their narrowing.
- Callable Disposables are disposed in blocks and loops. Await operations
  also accept callable iterables instead of treating them as records.
  Thanks to [Vladimir Kalnitsky](https://github.com/klntsky) for contributing
  the callable resource fix.
- Checking large `data` matches and `is` chains caches tag narrowing and
  matcher resolution, avoiding cubic work. A per-body budget of 3,145,728
  uncached union members bounds pathological cases with TS2563; split an
  oversized match into smaller functions if it reaches that limit.

### Diagnostics

Changes to previously accepted code:

- A typed catch expression, `load() catch (e: NotFound) => fallback`, now
  reports EK2112, a fixed-severity **warning**. It still compiles; the
  annotation never filtered failures. Write an untyped `catch (e)` and
  test `e` with `match` or `is`, rethrowing unhandled failures.
  The editor and `vibelang --fix` can make that rewrite.
- EK4409 now also warns when a primitive-success contract returns a call
  through `any` whose local initializer proves it returns a cold program.
  Give the callee an Effect-returning type so its call runs the program.
  With EK4409 configured as an error, previously accepted code in this case
  stops compiling until fixed. Ordinary dynamic value calls keep their existing behavior.
- The data-pattern work budget above can stop a formerly accepted, oversized
  body with TS2563. Split it into smaller functions.

New explanations for code that already failed, and improved messages:

- `fork do { … }`, `uninterruptible do { … }`,
  `interruptible do { … }` and `restore do { … }` now report EK1003,
  an **error**. Remove `do`: write `fork { … }`, and likewise for the
  other direct blocks.
- EK1015 explains `yield* call()` outside a generator: remove `yield*`,
  since a VibeLang call already runs.
- EK4502 explains `call().pipe(…)` when the success value has no `pipe`
  member: use `call() |> retry(%, policy)` or `retry(call(), policy)`.
  A result with its own `pipe` member still works.
- EK4503 explains implementation member reads such as `Users.region`:
  use `Users().region` inside an Effect function. Direct
  `Users.find(id)` calls and static key members stay valid.
- TS2540 explains implicit readonly members and shows `mutable`.
  EK1001 explains a misused inferred Effect default parameter: make the
  parameter optional and compute its default in the body.
- EK4701 names a missing nested data pattern, including its field path.
  An unresolved `TestClock` name suggests
  `import { TestClock } from "effect/testing"`.
- EK4402 names each platform API's Effect replacement, named import and
  providing layer: `FileSystem` with `NodeServices.layer`,
  `HttpClient` with `FetchHttpClient.layer`, `Path.resolve()` for
  `process.cwd()`, and `Experimental.Process.temporaryDirectory` for
  `os.tmpdir()` without creating a directory. Where Effect lacks an API, such as `os.hostname()`,
  it shows a `sync` hatch.
- EK4403 preserves units and test advice:
  `performance.now()` becomes
  `Number(Clock.monotonicTimeNanos()) / 1e6`, and `new Date()` becomes
  `DateTime.nowAsDate()`. Crypto replacements name their import and layer,
  and `TestCrypto.layer(seed)` for tests. The diagnostic configuration
  belongs in the top-level `vibelang.diagnostics` object of
  `tsconfig.json`.

### Tooling

- Completion hides compiler-written match bindings and the synthetic service
  brand. `noUnusedLocals` no longer reports compiler-written bindings.
- Watch summaries count warnings separately from errors.
- The formatter normalizes spaces after declaration keywords and preserves
  either contract spelling. The starter's documented dprint configuration
  formats its generated app.
- Typed catch fixes preserve comments, and catch rewrites omit unreachable
  default rethrow arms when the handlers cover every failure.
- `vibelang/project` resolves relative project paths from the caller's
  working directory, including compiler discovery.
- `--help` lists VibeLang's flags. The starter test command discovers its
  tests; the compiler's Go smoke suite has an explicit 20-minute timeout.
- Compiler package attribution points to the unified TypeScript upstream.

### Editor

- The VS Code and Cursor extension uses the VibeLang mark for `.vibe`
  files; packaging tests verify the icons in the VSIX.

### Docs

- Platform guidance starts with Effect's services, their imports and layers.
  Hatches illustrate APIs Effect does not cover, and complete Effect
  comparison tabs are checked as programs.
- Setup documents exact Effect pins, mixed TypeScript adoption and editing
  costs, local TypeScript and npm boundaries, supported dprint versions,
  cache startup, and current compiler limitations with executable evidence.
- Debugging guidance explains tracing, runner stacks and runtime costs.
  Token comparisons lead with measured corpus savings and identify longer
  VibeLang examples; they are not runtime performance promises.
- The shipped agent skill is self-contained. Public documentation clients
  can read the site without browser integrity checks. Repository paths,
  language names and editor setup guidance are current; retired hosted
  converter code and review scratch probes have been cleaned up.

## 0.0.9

This release has no breaking changes.

- `vibelang --fix` writes only the project's own files. It leaves workspace
  dependencies and referenced projects unchanged, while still reporting their
  diagnostics.
- When a round of fixes would add an error, `--fix` narrows down the refused
  fixes without rechecking the whole project once per file. Stopping it with
  SIGTERM exits cleanly, reports the interruption and writes no changes.
- Emitted declaration files import prelude names used in `typeof` queries
  and in inferred types copied from libraries. TypeScript consumers now
  resolve those names and retain their types.
- The register loader works with tools that read inline source maps, including
  Playwright's stack-trace support. They no longer mistake the loader's
  source map template for its own map.

## 0.0.8

0.0.7 was not published: 0.0.8 replaces it, and these notes include its changes.

### Changes that can break code since 0.0.6

- A contract is written `Effect<A, E, R>`, as in TypeScript. The shorthand
  `Result!Error!Dependencies` is retired: each use is the error EK1014,
  whose quick fix writes the Effect type it stood for. Run
  `vibelang -p tsconfig.json --fix` to rewrite a whole project:

  | 0.0.7 | 0.0.8 |
  | --- | --- |
  | `User!NotFound!Db` | `Effect<User, NotFound, Db>` |
  | `User!NotFound!` | `Effect<User, NotFound>` |
  | `User!!Db` | `Effect<User, never, Db>` |
  | `User!!` | `Effect<User>` |
  | `User!NotFound` on a function with a body | `Effect<User, NotFound, infer R>` |
  | `User!NotFound` anywhere else | `Effect<User, NotFound>` |

- A type argument left out of an Effect type means what it means in
  TypeScript: `Effect<A>` is `Effect<A, never, never>` and `Effect<A, E>`
  is `Effect<A, E, never>`. A return annotation such as `Effect<User>` on a
  function with a body was EK2003; it now checks that the function cannot
  fail and needs nothing. A service or control member may write
  `Effect<User>` or `Effect<User, NotFound>`, which EK2101 rejected.

- The starter treats EK3205 as an error: an entry module's `main` that
  needs services without providers stops the build and emits no JavaScript.
  Provide those services before running the entry program.
- Members returned by `Layer.effect(Service, effect { ... })` must fit the
  service's contract, as in `Layer.succeed`. EK3101 rejects a member that
  looks up services its contract does not allow at call time; failures
  outside the member's contract are EK2001.
- A recursive call whose contract leaves failures or requirements inferred
  uses the written success type in an operand or initializer. Where typing
  the call needs the whole contract, including an argument, a logical
  operand or a generic self-call, EK2102 asks for every channel instead of
  recursing through inference or reporting a circular return type.
- A `for...of` whose body runs an Effect calls its iterator's `return()`
  when the body fails or is interrupted, as it does on `break` or
  `return`. Iterator cleanup that was previously skipped now runs.
- EK4201 also rejects unhandled control operations passed by name across a
  fork, an await operation or a concurrent loop. Install the handler inside
  the new fiber, or run the operation on the current fiber.
- A comma between fields of an `error`, `schema error`, `service` or
  `control` declaration is EK1013. Separate fields with semicolons or new
  lines.

### Compiler

- A `data` declaration declares a tagged union with Effect's own
  `Data.TaggedEnum` type and its `Data.taggedEnum` constructors:
  `data Delivery { Waiting; Sent { tracking: string } }`.
  `Delivery.Sent({ tracking })` builds a value, and
  `when Delivery.Sent { let tracking }:` matches one. A `match` without
  `default` over a data type must handle every variant (EK4701). See
  [Data](../data-types/073-data.md).

- CommonJS output binds the names a file takes from the prelude, including
  `TaggedError`, bare Effect functions, `pipe` and `flow`. These names
  could previously fail with a `ReferenceError` when the module ran.
- Invalid jumps without a target, a Stream loop without a binding and
  incomplete Effect type arguments report diagnostics instead of crashing
  the compiler.
- A handler's tail `resume` inside a `for concurrent` body no longer
  reports EK4606.
- Hovering over a by-name argument no longer leaves the call inferred as
  `unknown`. The language server identifies itself as `vibelang`.

### New diagnostics

- EK1014 reports the retired contract shorthand and offers its
  `Effect<...>` replacement in the editor and through `vibelang --fix`.
- EK4833 reports only `Effect.Effect<A, E, R>`, and its fix writes
  `Effect<A, E, R>`. Hovers and messages show Effect types as `Effect<…>`.
- EK1013 names the field separator error, and its quick fix replaces the
  comma with a semicolon. Misspelled names in a `.vibe` file can suggest
  names from the prelude.
- EK1001 identifies the plain JavaScript context that cannot run a program,
  including class initializers, constructors, accessors, static blocks and
  default parameter values. EK4301's hatch suggestion includes the callback
  parameter where the call needs it.
- EK3201 explains that a program typed `any` has unknown service
  requirements. EK4401 suggests a `try` call that passes inputs into the
  hatch and the `trusted()` wrapper, and EK2003 explains that an exception inside a hatch
  becomes a defect with `sync` or an expected failure with `try`.
- With `--pretty`, a file with both TypeScript and VibeLang errors is
  counted once in the error summary.

### Starter and packages

- The starter builds standalone TypeScript sources, checks their errors and
  keeps source tests out of build output. New apps start at version
  `0.0.0`, and their README describes an installed app.
- The starter pins `@effect/platform-node-shared` to `4.0.5` so its
  transitive peer dependency agrees with Effect. Example projects install
  the published VibeLang packages and use the same platform override.
- `vibelang-vite` preserves fractional compile start timestamps when it
  compares file changes and provides compile and invalidation traces through
  `VIBELANG_VITE_DEBUG=1`.
- The release publisher skips an existing registry version only when its
  tarball checksum matches the local tarball. The internal TypeScript mapper
  is marked private.

### Docs

- The guides and packaged skill use `Effect<...>` contracts and teach
  `data` declarations and exhaustive matches.
- Setup describes npm and Bun separately, makes Bun optional for npm users
  and links TypeScript 7's removed-option migration notes. The Vite guide
  explains source checking and import extensions.
- The guides teach the current `trusted()` wrapper, the starter's provider
  check and Effect 4 APIs. They name `Cause.UnknownError`, explain that
  plain JavaScript recursion can overflow the stack, and link known
  limitations and the pending-interruption resource workaround.
- Examples omit harness directives and unexplained decision references.
  Token comparisons state the measured corpus, and agent setup starts with
  the packaged skill.
- GitHub is available from the site's top navigation on every page.

### Known limitations

- Stock `tsc`, `vue-tsc` and `svelte-check` do not check `.vibe` imports.
  The TypeScript 7.1 content mapper is experimental and unpublished, and
  does not lower `data` declarations; see
  [the current mapper limitation](known-limitations.md).
- Native Windows binaries are not available; Windows needs WSL.
- Effect remains pinned to `4.0.5` exactly. Effect `4.0.6` changes cleanup
  failure handling in a way VibeLang does not yet support; see
  [the pin's explanation](existing-project.md).
- A JavaScript Disposable acquired at the end of a masked `using`
  initializer can leak if interruption is pending before its release is
  registered. Use `Effect.acquireRelease` with protected acquisition; see
  [the safe pattern](../resource-management/030-scope.md#releasing-javascript-disposables).

## 0.0.6

0.0.5 was not published: 0.0.6 replaces it, and these notes include its
changes. 0.0.4 was not published either, so from 0.0.3 read the 0.0.4 notes
too.

### Changes that can break code since 0.0.3

These fixes are included in the changes since the last published version,
0.0.3. The comparisons below describe the unreleased 0.0.4 compiler.

- An optional call of a callback without a contract, `f?.(x)`, runs the
  program the callback returns, as `f(x)` does. On 0.0.4 it returned the
  program unrun. The callback's failures and requirements now reach the
  caller's contract, so a contract that leaves them out is EK2001 or EK2002.
- A file whose functions are Effects only because they throw, produce,
  declare `using`, or call `JSON.parse`, `decodeURI` or `decodeURIComponent`
  loads effect. On 0.0.4 such a function was typed and declared plain while
  its JavaScript returned an Effect. Where effect does not resolve, each such
  function is the new error EK1011.

### Compiler

- A comment before an expression that the compiler writes after a `return`,
  `throw` or `yield` stays a comment. A `match` arm whose value follows a
  comment, or whose pattern begins with a comment on its line, as in
  `when [ // first`, returned `undefined`.
- `uninterruptible { ... }` stays uninterruptible when it declares a `using`
  resource, and releases the resource when the block ends. On 0.0.4 such a
  block compiled without its mask, and an interruption reached its
  statements.
- The compiler no longer overflows the stack on a function that passes a
  call of itself by name, as `guard(healthy(index - 1))` does. It reports
  EK2102 at the function: write its failures and requirements in its
  contract.
- The failures and requirements of a callback without a contract default to
  `never`, so a call that omits an optional callback adds none.
- A call that runs no longer takes type arguments from its contextual type,
  which types its success value, not the Effect: `return late()` under
  `Late!!`, where `late` returns a `Late` error instance, compiles.

### New warnings

None of these warnings changes the emitted JavaScript.

- EK4409: a call of an `any`-typed value is a program's value or what an
  Effect function returns. The call returns its value, so a program the callee
  returns never runs. Give the callee a type. EK4409 is adjustable, like
  EK2004.
- EK4802 also reports an Effect value in a returned conditional's arm, in an
  operand of `??` or `||`, or on the right side of `&&`. Where the success
  type names no value (`void`, `unknown`, `any`, or a type parameter the call
  infers), it reports a returned Effect value or program literal, a program
  returned by name (a `const`, field or parameter), and a returned value whose
  type is a union with an Effect value or a program among its members. Its
  quick fixes call the value to run it, or write its type as the success type
  to return it; a union with a member that is no program gets only the second.
- EK2004 also reports where a plain function's `catch` lets an exception
  through: the first call in the `try` block of an untrusted function, a
  declaration without `@throws`, or a trusted package's export whose name
  ends in `Sync` or contains `OrThrow`. A plain `catch` receives expected
  failures only; `Result.try` or a `module` block catches the exception.
- EK1012: a call that never succeeds, stored by a variable's initializer, an
  object literal's field, an array element or an assignment. The call runs
  there, so `const missing = Effect.fail(new Missing())` fails at the
  `const`. To keep the program, write a function or the declared Effect
  type. EK1012 is adjustable, like EK4409.

### Tools and integrations

- Coverage: V8 coverage tools such as `@vitest/coverage-v8` and c8 count the
  functions and statements the author wrote, not the thunks and wrappers the
  compiler adds. Stack traces and breakpoints are unchanged.
- `vibelang-vite`: a Vitest rerun recompiles a `.vibe` module after its
  imports or the compiler change. The plugin keeps `.vibe` modules out of
  Vitest's on-disk module cache.
- Formatter: a `module` block formats to itself under a dprint host without a
  TypeScript plugin, where each pass added a blank line, and a statement that
  starts with a parenthesis formats with dprint's `;` guard instead of
  failing.
- The setup page's Bun check expects Bun 1.4.0 or later again.

### Known limitations

- A returned Effect value, program literal or program named by reference
  where the success type names no value is the success value, not a program
  to run. EK4802 warns.
- A stored call that never succeeds runs where it stands. EK1012 warns.
- A JavaScript Disposable acquired in a masked section at the end of a
  `using` initializer can leak when an interruption is pending: it is delivered
  as the mask ends, before `using` registers the release. The pending
  `scopes-using-pending-interrupt` case records `["acquired"]` instead of
  `["acquired","disposed"]`. Use `Effect.acquireRelease` with its default
  protected acquisition and an explicit disposal callback, or
  `using h = Effect.acquireRelease(...)` for a lexical lifetime.
  See the [safe pattern](../resource-management/030-scope.md#releasing-javascript-disposables).
- A class method annotated with a plain return type whose body runs an
  Effect keeps its plain type; called through an interface, it returns the
  Effect instead of running it.

## 0.0.4

### Changes that can break code that compiled on 0.0.3

Each one rejects, or changes, a program that compiled on 0.0.3 but ran
differently from what its types said.

- A `throw` that can escape a constructor, a getter or setter, a class
  `static` block, or a module's top level is a compile error: EK2003, or
  EK1001 at the top level. These run as plain JavaScript, so the throw ended
  the program with a defect its type said could not happen. A throw that a
  `catch` in the same code handles still compiles. Put code that must throw a
  JavaScript exception, such as a test's throwing getter, in a `module`
  declaration.
- A `match` arm that tests a class runs only for an instance of that class.
  A match that relied on a class pattern to cover a type that is neither that
  class nor a subclass of it is a compile error; on 0.0.3 it could run the
  wrong arm.
- A subclass in a schema error family that declares a `_tag` field must
  include its own name in that field's type.
- A `const` declared with an Effect type holds its initializer through
  `as`, `satisfies`, `!`, a conditional, and a pipe, as it already did through
  parentheses. The initializer runs each time the const is run, not where the
  const is declared.
- A direct `sync` or `try` of an async function passes the function exactly
  its inputs, and an `AbortSignal` only where its overload passes one. On
  0.0.3 a rest parameter received a stray `undefined` and an optional
  parameter of another type could receive the signal.
- Every package requires Node 26 or later.

### Compiler

- A plain function is called as a plain function from every import shape:
  a default import beside named or namespace imports, CommonJS output, and
  `export default f`.
- `super` and `arguments` work in Effect methods, Effect arrows, and `try`
  blocks. On 0.0.3, `super` in an Effect method emitted a module that failed
  to load.
- A bundle runs only its entry module's `main`, in ES module and CommonJS
  output, and a CommonJS file that exports `main` loads and runs it when Node
  runs the file. The compiler warns
  (EK3205) when an entry module's `main` needs services that nothing
  provides.
- `module` declarations: emitted names never collide with your names, global
  names, or the file's imports; CommonJS output keeps their re-exports; their
  declaration files use the `.vibe` file's imports.
- A schema error family's base schema encodes and decodes its subclasses.
- A non-tail `resume` has a type that covers every value its handler can end
  with.
- `using` awaits `Symbol.asyncDispose` of a value that only async-disposes.
  `sync` and `try` called as values pass an async function its `AbortSignal`.
- The compiler no longer crashes on `service X: typeof X` or on a pipe with a
  missing left operand, and the formatter no longer crashes on a file with a
  `match`.
- Lambdas and pipes keep their meaning in more places: a lambda for an
  optional member takes the member's contract; a factory lambda keeps
  TypeScript's type in a branch of a conditional argument; either arm of a
  returned conditional can make a factory; an annotated lambda can call the
  variable it initializes; a returned pipe that ends in a call returns what
  the call returns; a function literal on a pipe's left side stays a program
  for a curried stage; a pipe in an Effect-typed field keeps its function
  plain for callers.
- A `provide` block keeps `Exclude<R, I>` of a generic requirement, and a
  `for...of` over a Stream inside one no longer crashes the compiler.
- A `restore` block inside an uninterruptible expression is inside it, and a
  comment before a by-name program no longer ends its return early.
- A destructuring property name inside a hatch is not a capture.
- Declaration files: a function expression's written contract is its
  declared type, a `.vibe` file's header comment stays first, and schema
  declarations keep their comments.
- Diagnostics: a contract suggestion for a `never` success writes `never`,
  and a diagnostics comment can give its reason after punctuation.

### Tools and integrations

- The install guides install the current version and say that Windows needs
  WSL. The starter's `AGENTS.md`, `llms.txt`, and the agent skill teach the
  forms the compiler accepts.
- npm packages and the VS Code extension ship complete license and notice
  files.
- Projects: a project compiles sources above its directory; a program without
  a `tsconfig.json` checks each package's `.vibe` files with that package's
  settings; `VIBELANG_PROJECT` compiles the modules in its directory, and a
  workspace dependency's source compiles with its own `tsconfig.json`; a
  check-only project that imports `.ts` files compiles in the loaders; a root
  project compiles a nested package it reaches through `node_modules`.
- `vibelang-unplugin`: esbuild tree-shakes the `.vibe` modules of a package
  without side effects, and each entry's types import only its own bundler's
  types.

### Known limitations

- `using` does not release a value whose acquisition ends in an
  uninterruptible section when an interruption arrives during that section.
- A class method annotated with a plain return type whose body runs an
  Effect keeps its plain type; called through an interface, it returns the
  Effect instead of running it.

## 0.0.3

### Changes that can break code that compiled on 0.0.2

- `error`, `service`, and `control` declarations are classes. Error classes
  accept constructors, methods, and inheritance; each subclass has its own
  name as its tag. An error family's base can declare `_tag: string`;
  an abstract error has that tag type by default.
- `throw` always fails outside a TypeScript hatch or module. Plain functions
  and JavaScript generators cannot let a typed failure escape. Use an Effect
  contract for a function that can fail, or TypeScript for JavaScript throws.

### Language

- `schema error` declares a serializable error class. `schema Name = Type`
  declares a schema and its type; `service Name: Type` declares a service
  whose shape can be any type.
- Inline `module` declarations hold self-contained TypeScript. Import their
  exports by the module's name; diagnostics and editor navigation point into
  the body, and declaration emit writes a separate declaration file.
- Both sides of a catch expression receive its contextual type. An exhaustive
  match omits its final test. More data-first Effect functions support method
  syntax, including functions whose receiver is not named `self`.

### Tools and integrations

- Format `.vibe` with the dprint process plugin and lint it with
  `vibelang/eslint`. A tree-sitter grammar and Neovim support are available.
- TypeScript-style Effect forms warn with editor quick fixes where a
  VibeLang form preserves their meaning. `vibelang --fix` applies the fixes.
- The compiler package ships the VibeLang agent skill.
- Imported foreign-project sources use their own VibeLang settings.
  Declarations use `.js` specifiers for `.vibe` modules, and tools reuse
  successful whole-project compiles through an on-disk cache.
- `bun --preload vibelang/bun` runs and tests source modules.
  The Vite plugin's `register: true` lets child processes import `.vibe`;
  `vibelang-unplugin/deferred` loads the plugin when a bundler awaits it.

## 0.0.2

Nine published packages: `vibelang`, four native compilers
(`vibelang-{darwin,linux}-{arm64,x64}`), `vibelang-runtime`,
`vibelang-vite`, `vibelang-unplugin`, and `create-vibelang`.
`vibelang-unplugin` is new in this release. Native Windows binaries
are not available yet; use WSL and follow the Linux instructions.

### Changes that can break code that compiled on 0.0.1

Each is a compile error that names the problem; none silently changes what
compiled code does.

#### Platform globals through `globalThis` are EK4402

`process.env` was already `EK4402`. `globalThis.process.env`,
`globalThis.fetch`, `globalThis.crypto.subtle`, `globalThis.location`,
`globalThis.navigator`, and the other platform globals now are too when their
host declarations resolve. Without those declarations, TypeScript's usual
missing-member diagnostic remains. This standalone example has no Node types:

```vibe
// expect-error: TS7017
function home() {
  return globalThis.process.env.HOME
}
```

Read configuration with `Config` from Effect:

```vibe
// fragment
function homeDir() {
  return Config.String("HOME")()
}
```

Otherwise, read the global in a TypeScript module the project trusts, such as
`platformEnv.ts`:

```ts
// TypeScript (.ts)
/** @vibelang trusted */
export const processEnv = () => globalThis.process?.env
```

#### A call typed as a union of Effects runs where it stands

A call to a function that returns `Effect<A> | Effect<never, E>` now runs the
program, as `yield* decide(flag)` does in TypeScript. In 0.0.1 it silently held
the program.

```vibe
error Rejected

function decide(flag: boolean): Effect.Effect<number> | Effect.Effect<never, Rejected> {
  return flag ? Effect.succeed(1) : Effect.fail(new Rejected())
}
```

A 0.0.1 workaround that holds the program and then calls it no longer compiles:

```vibe
// expect-error: TS2349
function total(flag: boolean) {
  const held = decide(flag)
  return held() + 1
}
```

Delete the workaround and use the value:

```vibe
// fragment
function total(flag: boolean) {
  const value = decide(flag)
  return value + 1
}
// number!Rejected!
```

A function annotated with a union of Effects whose branches return decided
Exits, such as `cond ? Exit.fail(e) : Exit.void`, runs the chosen Exit.

#### `Request` is the web-standard class

Web-standard globals keep their names, as JavaScript's built-ins do: `Request`,
`Response`, `Headers`, `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`,
`AbortController`, `AbortSignal`, `Blob`, `FormData`, `structuredClone`, and
`fetch`. Of Effect's root names only `Request` collides, so `Request.tagged`
without an import is now TS2339 or TS2702. Import Effect's module:

```vibe
import { Request } from "effect"

interface Lookup extends Request.Request<string> {
  _tag: "Lookup"
  id: string
}

const Lookup = Request.tagged<Lookup>("Lookup")
```

#### A `const` with a declared Effect type holds the program

`const p: Effect.Effect<A, E> = make()` keeps the program `make()` returns cold
instead of running it, at any scope. When the call returns a program that
produces a program, as `Effect.cached(...)` does, the annotation must name the
outer program, `Effect.Effect<Effect.Effect<A, E>>`, or the compiler reports
TS2322 or TS2375. To run the call, drop the annotation.

#### A throw expression can't be an operator's left operand (EK1010)

In expression position, `throw cond ? a : b` threw `cond` and discarded the
rest; it is now EK1010. Write `throw (cond ? a : b)`. A statement that starts
with `throw` is unchanged.

#### A curried pipe stage after a call keeps the call

`x |> f(args)(%)` becomes `x.pipe(f(args))` only when `x` calls nothing. When a
call builds the left side, bind it first: `const s = Schema.NullOr(Schema.String)`,
then `s |> f(args)(%)`.

### Fixes

- An Effect subtype returned at an Effect boundary runs. A value the contract's
  written success type accepts is returned as data:
  `keep(command): ChildProcess.Command!never!Scope` returns the command.
- A discarded structured Effect call is diagnosed (EK4301). A program cast and
  piped with `|>` is passed by name.
- Callback cleanup waits for async and Effect finalizers on interrupt. Copied
  declaration types import prelude names.
- A `function*` annotated `Generator<...>` stays a JavaScript generator.
- Function-valued service implementations and contract-annotated arrows keep
  their programs.
- Nested Effect function declarations hoist, so a call above the declaration
  works.
- The checker no longer overflows the stack on a shorthand discriminant property
  under a union context.
- By-name tail programs, conditional by-name arms, and optional program fields
  run as written.
- Diagnostics: inline boundary callbacks, `Effect.fn` span advice, non-adjustable
  EK option policies, and `.d.ts` JSDoc that matches tsc.

### Known issues

- A throwing local arrow with no contract, inside a function with a plain return
  annotation, reports EK2003 on the outer annotation. Annotate the local arrow,
  such as `(value: number): void => { ... }`.
- EK4802 can warn on a local annotated `Effect<Effect<...>>` that returns its
  program unrun. The emitted code is correct.
- Programs that by-name lowering wraps spend extra Effect operations.
- A recursive `Schema.Class` whose `Schema.suspend` callback writes an Effect
  contract, `(): Schema.Codec<Crate, CrateWire>!! => Crate`, reports TS2506 and
  TS2740. Annotate the plain return type instead,
  `(): Schema.Codec<Crate, CrateWire> => Crate`. Both compile to the same
  JavaScript.
