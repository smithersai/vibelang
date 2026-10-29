# Branded Types

`Brand` provides Effect's branded types: a brand distinguishes domain values without changing their runtime representation. Use brands when two strings or numbers mean different things, and construct them at a boundary where their origin or validation is clear.

## Distinguishing identical representations

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(invoiceUrl("inv-3" as InvoiceId), customerUrl("customer-5" as CustomerId))
type InvoiceId = string & Brand.Brand<"InvoiceId">
type CustomerId = string & Brand.Brand<"CustomerId">

function invoiceUrl(id: InvoiceId) {
  return `/invoices/${id}`
}

function customerUrl(id: CustomerId) {
  return `/customers/${id}`
}
```

```output
/invoices/inv-3 /customers/customer-5
```

Two plain aliases for `string` stay interchangeable; these branded types differ at compile time, so a `CustomerId` can't be passed to `invoiceUrl`. The brand adds no field to the runtime string and doesn't validate external input.

## Nominal brands

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify(knownInvoice("inv-3")))
type InvoiceId = string & Brand.Brand<"InvoiceId">
const InvoiceId = Brand.nominal<InvoiceId>()

function knownInvoice(raw: string) {
  const id = InvoiceId(raw)
  return { id, url: `/invoices/${id}` }
}
```

```output
{"id":"inv-3","url":"/invoices/inv-3"}
```

`Brand.nominal` builds a constructor that returns its input unchanged, branded in its type. It validates nothing, so use it only where the domain meaning is already established. Call a constructor directly from plain code. In effect code, wrap a call that may throw with `Effect.try`, or use a validation method that returns an Option or Result.

## Refined brands and validation

```vibe
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log(try parseAmount(125)); try Console.log(parseAmount(1.5) catch (error) => error._tag)
type WholeCents = number & Brand.Brand<"WholeCents">
const WholeCents = Brand.make<WholeCents>((n) =>
  Number.isSafeInteger(n) || "amount must be a safe integer"
)

error InvalidAmount {
  cause: unknown
}

effect function parseAmount(raw: number) {
  return fromResult(WholeCents.result(raw)) catch effect (cause) => { throw new InvalidAmount({ cause }) }
}
// WholeCents!InvalidAmount!
```

```output
125
InvalidAmount
```

`Brand.make` takes a synchronous check that returns `true` for valid input or an explanation for invalid input. Its constructor throws a `Brand.BrandError` when validation fails. Use `result` to avoid that exception. `fromResult` converts a failed Result to a typed Effect failure, and `catch` maps it to `InvalidAmount`. A plain function can use JavaScript `try`/`catch` for constructor exceptions.

```vibe
// pending: VIP-5, VIP-6, VIP-14
// run: const valid = inspectAmount(125); const invalid = inspectAmount(1.5); try Console.log(Option.isSome(valid.optional), Result.isSuccess(valid.result), valid.valid); try Console.log(Option.isNone(invalid.optional), Result.isFailure(invalid.result), invalid.valid)
function inspectAmount(raw: number) {
  const optional = WholeCents.option(raw)
  const result = WholeCents.result(raw)
  const valid = WholeCents.is(raw)
  return { optional, result, valid }
}
```

```output
true true true
true true false
```

`option` returns `Some` or `None`; `result` returns a `Result` whose failure holds `BrandError`; `is` returns a boolean and has a refinement signature. These calls report invalid data without throwing. To fail with `BrandError` in E, use `try fromResult(WholeCents.result(raw))`. Unexpected exceptions stay defects.

## Composing constraints

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log(try chargeAmount(125)); for (const input of [-5, 1.5]) { try Console.log(chargeAmount(input) catch (error) => error._tag) }
type WholeCents = number & Brand.Brand<"WholeCents">
const WholeCents = Brand.make<WholeCents>((n) =>
  Number.isSafeInteger(n) || "amount must be a safe integer"
)

type Positive = number & Brand.Brand<"Positive">
const Positive = Brand.make<Positive>((n) => n > 0 || "amount must be positive")

const Charge = Brand.all(WholeCents, Positive)
type Charge = Brand.Brand.FromConstructor<typeof Charge>

error InvalidCharge {
  cause: unknown
}

effect function chargeAmount(raw: number) {
  return fromResult(Charge.result(raw)) catch effect (cause) => { throw new InvalidCharge({ cause }) }
}
// chargeAmount(125) succeeds; -5 and 1.5 fail with InvalidCharge.
```

```output
125
InvalidCharge
InvalidCharge
```

`Brand.all` combines the checks of constructors with the same underlying type. A valid result carries every constituent brand, so `Charge` is both an integer and positive. Deriving the type from the constructor keeps it aligned with the combined constraints.

## Coming from Effect

Brands keep their usual types and runtime behavior. For an expected failure on invalid input, use the constructor's `result` with `fromResult`, or wrap the constructor with `Effect.try`. Run the resulting Effect with `try` or handle its failure with `catch`.
