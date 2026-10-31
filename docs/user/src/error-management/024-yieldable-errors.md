# Custom Error Classes

Effect's custom error values can be yielded inside TypeScript generators. An effect function signals the same domain failures with `throw`; an `effect function*` produces a Stream, and a plain `function*` remains a JavaScript generator.

[Upstream page](https://effect.website/docs/v4/error-management/yieldable-errors)

## Defining an error without a tag

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: try Console.log(try requireText("doc-1", "Hello")); try Console.log((try flip(requireText("doc-1", " "))).documentId)
class EmptyDocument extends Data.Error<{
  readonly documentId: string
}> {}

effect function requireText(documentId: string, text: string) {
  if (text.trim() === "") throw new EmptyDocument({ documentId })
  return text
}
// string!EmptyDocument
```

```output
Hello
doc-1
```

`Data.Error` creates an error class with typed fields and Effect's yieldable behavior. An explicit `throw` in an effect function puts `EmptyDocument` in `E`. Creating or returning an error object alone doesn't fail the computation.

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: try Console.log(emptyDocumentError("doc-1").documentId); try Console.log((try flip(rejectDocument("doc-1"))).documentId)
function emptyDocumentError(documentId: string) {
  return new EmptyDocument({ documentId })
}

effect function rejectDocument(documentId: string) {
  const error = emptyDocumentError(documentId)
  throw error
}
// never!EmptyDocument
```

```output
doc-1
doc-1
```

`new` only constructs, and a call returning an error instance returns data; `throw error` in an effect function fails with the held error.

## Creating tagged error classes

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-7, VIP-13, VIP-14
// run: try Console.log(try title("Draft")); try Console.log((try flip(title("")))._tag); const error = try flip(title("x".repeat(81))); try Console.log(match (error) { when TitleTooLong and { let length }: length; default: 0; })
error EmptyTitle
error TitleTooLong {
  length: number
}

effect function title(text: string) {
  if (text.length === 0) throw new EmptyTitle()
  if (text.length > 80) throw new TitleTooLong({ length: text.length })
  return text
}
// string!(EmptyTitle | TitleTooLong)
```

```output
Draft
EmptyTitle
81
```

An `error` declaration is a class extending `Data.TaggedError` (no import needed). Every instance has a readonly `_tag` equal to the class name, and the class names the instance type as well as constructing values. Use `schema error` when an error also needs schema-based serialization.

Give distinct error cases distinct tags. Tag-based matching compares strings, so `catchTag` and `_tag` narrowing can't tell two classes with the same tag apart, and nothing guarantees a duplicate tag is diagnosed. `is` and `match` use the generated `_tag` matcher too, so two packages that declare the same error name match each other's instances.

## Recovering failures by tag

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-7, VIP-13, VIP-14
// run: try Console.log(try displayTitle("")); try Console.log(try editableTitle("")); try Console.log(try displayTitle("Draft")); try Console.log(try editableTitle("Draft")); try Console.log((try flip(displayTitle("x".repeat(81))))._tag); try Console.log((try flip(editableTitle("x".repeat(81))))._tag)
effect function displayTitle(text: string) {
  return try catchTag(title(text), "EmptyTitle", () => succeed("Untitled"))
}
// string!TitleTooLong

effect function editableTitle(text: string) {
  return title(text) catch effect (error) => match (error) {
    when EmptyTitle: "Untitled";
    default: throw error;
  }
}
// string!TitleTooLong
```

```output
Untitled
Untitled
Draft
Draft
TitleTooLong
TitleTooLong
```

Both versions remove `EmptyTitle` from `E` and keep `TitleTooLong`. When cases need different responses, `Effect.catchTags` takes one handler per tag. These stay typed failures, though the classes also support generators in TypeScript.

## Coming from Effect

Existing `.ts` functions that yield `Data.Error` or `Data.TaggedError` stay in TypeScript; effect functions run their returned Effects with `try`. In an effect function, `return yield* new ErrorCase(...)` becomes `throw new ErrorCase(...)`.

In a `.vibe` file, `class NotFound extends Data.TaggedError("NotFound")<{ … }> {}` draws EK4830, whose quick fix writes `error NotFound { … }`; a `Schema.TaggedError` class draws EK4837, whose quick fix writes `schema error NotFound { … }`, which keeps its Schema ([TypeScript-style Effect code](../getting-started/012-devtools.md#typescript-style-effect-code)).

A producer uses `effect function*` and returns a Stream; a plain `function*` remains a JavaScript generator. Support for the new forms arrives with the compiler's VIP implementation.