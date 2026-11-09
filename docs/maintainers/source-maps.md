# Source maps

What a VibeLang source map must mean. Tests cite these rules. `docs/user/src/setup/source-maps.md` says what works in which tool.

## The seam

```text
.vibe text ─► parser ─► checker ─► lowering ─► printer ─► sourcemap.Generator ─► x.js + x.js.map
                                   sets each      │
                                   node's range   └─ the only writer of segments
x.js + x.js.map ─► vibelang/project ─► { code, map }
                                         ├─ vibelang/register   inline, file URLs
                                         ├─ vibelang/bun        inline, marked `// @bun`
                                         └─ vibelang-unplugin, vibelang-vite   handed to the bundler
```

Go owns positions and JavaScript owns delivery. `vibelang/project` is the seam: it reads what the compiler wrote, makes `sources` absolute, sets `sourceRoot` to `""`, and removes the compiler's directive. Nothing past it computes a position. `inline-source-map.mjs` owns the comment a loader appends. `vibelang/emit` moves a syntax tree's locations through the map for Babel and Metro, which read one file at a time.

`vibelangmapper.Emit` writes the only other map, for the experimental `vibelang-mapper` command. It composes the transpiler's map through the projection's segments, so text the projection keeps maps to itself and text it writes maps to the edit that wrote it. It must meet Shape, Content, Units, Range and Order. Tokens does not apply.

## Rules

Rule names are stable. A test cites them.

- **Shape.** A map is version 3, names one source and its generated file's base name, and leaves `names` empty: the printer writes none.
- **Content.** With `inlineSources`, `sourcesContent` holds the text the compiler read, without a BOM.
- **Units.** A line ends at ECMA-262's LineTerminatorSequence: LF, CR, CRLF, U+2028 or U+2029. A column counts UTF-16 code units. Both are 0-based.
- **Range.** Every segment stands inside its generated file and names a position inside its source. A column may equal its line's length.
- **Order.** Segments are sorted by generated position. Two may share one when the source goes backward, as in `tsc`.
- **Tokens.** An identifier or literal emit keeps reads back as itself: the last segment at or before its first column, on its line, names the same token in the source. This holds for ES module output: TypeScript's CommonJS transform spells imports and exports anew.
- **Sugar.** Code the lowering writes for a form takes the form's position, including a helper named like a written token: `Schema.Array` for a written `ReadonlyArray`, or `receiver_1.not` for `when helpers.not(...)`. See [Constructs](#constructs).
- **Generated code.** A function or statement no source stands for starts with a segment that has no source position (`printer.EFNoSourcePosition`). The columns around it map to the last source position, because `@jridgewell/remapping` drops a position that starts a line or follows another (`emitNoSourcePosition`). `internal/vibelang/generated.go` says which function of a lowered pair keeps its position. Native `match` cache `try`, `catch`, rethrow and finalization statements use this mapping too; their protected source statements retain their own positions. Generated region completion tests and transfers are unmapped too; the authored jump inside the region keeps its source position.
- **Imports.** An import the compiler adds has no segments.
- **Braces.** A closing brace maps only when a written `}` is inside its block. A block the parser or a lowering made has none to borrow (`emitBlockCloseBrace`).
- **Directive.** The compiler ends a file with its `sourceMappingURL` directive. `vibelang/project` removes that last line and nothing else, because a string or comment may spell the same text.
- **Declarations.** With `declarationMap`, a name in a `.d.ts` maps to its `.vibe` declaration, so go-to-definition reaches the source.
- **Determinism.** The same project writes the same maps, in any order of queries.

## Constructs

`packages/compiler/test/source-maps/contract.test.mjs` holds this table as data, reading both ends through two consumers.

| Construct | Generated | Maps to |
| --- | --- | --- |
| `effect function` | `function f(p)` forwarding to `Effect.gen` | `f`, `(`, parameters and `)` map to the written ones. The generator maps to none. Body statements map to their statements |
| `try e` | `yield* e` | `e` maps to itself. `yield*` has no segment of its own |
| `do { ... }` | statements, then `$do = value` | Each statement and the value map to where they are written |
| `e catch h` | `$catch(...)` around generated thunks | Operands and the handler map to where they are written. Thunks map to none |
| `for try` | a stream loop | The body's statements map to their statements |
| `schema` | `const S = Schema.Struct({ ... })` | `S` and each field name map to the written names. `Schema.*` maps to the field |
| `service` | `class S extends runtime.$service(key)` | `S` maps to the name, and a written key to its string |
| `error` | `class E extends TaggedError("E")` | `E` maps to the name |
| `data` | `const D = Data.taggedEnum()` | `D` maps to the name |
| `a \|> f(%)` | nested calls | Operands map to where they are written |
| `match` | an immediately invoked function or a block | Each arm's binding and value map to where they are written. Generated subject arguments of cached pattern reads have no source position; their checker anchors must not send an arm binding back to the subject |
| `.vibex` JSX | elements, or `jsx` calls | Elements and names map to where they are written |
| `module m { }` | its own file, `main.vibe.m.js` | Its map names the containing `.vibe` file |

Capturing `new.target` for an Effect body retains the written meta-property node in the capture initializer. Its `target` token keeps its source range when the read moves, across functions, constructors, nested Effect blocks and text variants.

## Text

| Text | Rule |
| --- | --- |
| BOM | The compiler's reader removes it, so it is in no position and not in `sourcesContent` |
| CRLF | One line end. `sourcesContent` keeps it |
| Astral characters | Two columns each |
| U+2028, U+2029 | Line ends in both texts. A comment's separator prints as a newline, and a string's stays |
| Empty file | A map with no segments |

## Tests

| Layer | Where |
| --- | --- |
| Token, range, order and content rules over cases, snippets and generated programs, including loss of complete mapping lines | `FuzzSourceMapTokens` |
| Bounds and statements in every compile | `OutputChecker.checkSourceMap` in `FuzzCompile` |
| Determinism | `checkDeterminism` in `FuzzCompile` |
| Shape, Content, Units, Range and Order of `vibelangmapper.Emit` | `FuzzEmitSourceMap` |
| Two independent consumers, and exact source, line and column checks for retained bundle strings, with mapping-loss controls | `programs.property.test.mjs` |
| Independent paused function and statement, with swapped-map controls | `inspector.test.mjs` |
| Metro, Babel, React Compiler and Oxc | `//packages:compiler-tools-test`, a dependency of `//packages:source-map-tools-test` |
| One test per tool | `packages/compiler/test/source-maps/`, target `//packages:source-map-tools-test` |

The token oracle requires positions for eligible written tokens even when their generated line has no segments. Its controls delete all mappings or either written line across each text variant. Erased declarations and generated imports may still have empty maps. The short corpus selection and CPU limits are unchanged.

The generated-program token check distinguishes erased service metadata from retained properties. A service's `static readonly key` supplies the key string to the constructor; the metadata identifier is erased. A generated producer helper's `key` property is therefore not that source token. A minimized keyed replay combines a service and producer. Generated controls vary service names, line endings and comments, and still reject missing or shifted retained tokens and unmapped written object or class properties, including properties that spell the private producer key. The services chapter, this rule page and the specification lookup helper are declared inputs of the source-map target, so changes invalidate previous checks.

The generated-program run logs its replay seed, program key, text variant, bundler and active stage. Compiler and bundler children have a `30`-second bound; a terminated compiler fails the check. Runs report their composed token comparisons, and a retained string requires a source even when `main.vibe` is missing from the map. A fully eliminated module may have no comparisons.

A bundler can place a surrounding expression's segment and a string's segment at the same opening quote. The composed-map check reads inside the string and requires the original token's quote position. A keyed replay covers strings kept after a call is eliminated. A bundler can also inline a compiler temporary that holds a string: rolldown turns `$do1 = "length"` and its read `url[($do1)]` into `url["length"]` with the read's segment, which Sugar puts at the `do` keyword. For a string the compiled output assigns to such a temporary, the check accepts the position the compiled map gives a read of that temporary, and no other position than the quote. A keyed replay covers it. Module specifiers are excluded by their syntax in the text; a missing mapping is never itself a reason to skip a retained value. When finding strings assigned to compiler temporaries, the same syntax exclusion applies before counting occurrences: a synthesized import of `"effect"` is not a second runtime value that hides an inlined dynamic-import specifier. The import, the temporary assignment and its read remain distinct. Generated controls vary import forms, module names, line endings and temporary names, and still reject shifted reads or reads without the temporary.

The subprocess checks record elapsed time and distinguish their own deadline from another termination signal. Rolldown progress records identify import, creation, writing and closure. A loader replay covers a multiline warning whose comment-prefixed source text previously became nonexistent watched paths; the diagnostic parser retains the excerpt and the unchanged project finishes once.

While a diagnostic is continuing, nonexistent comment-shaped paths, including `//path/to/source`, stay in its source excerpt. Existing input files remain inputs, and a started file listing still accepts missing paths. The parser property covers these boundaries separately.

The tool-adapter suite stages a private Vite plugin beside its compiler peer. It reads the plugin manifest and source from the checkout, so testing does not depend on a separate install in the Vite package.

The Vite SSR replay writes a compiler cache entry after loading the module and waits for the cache watcher event. The stack must still name the original source position. Failure output retains the raw stack, SSR code and map, and a bounded list of watcher events. A keyed fast-check property varies cache keys, directory spellings and create/update/delete events, while checking that ordinary JSON and neighbouring directories still invalidate.
