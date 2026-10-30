# Why VibeLang?

VibeLang uses Effect to make a program's expected failures and dependencies visible to the compiler. Choose it when application logic needs coordinated retries, cancellation, resource cleanup, and service substitution.

## Describe work before running it

```vibe
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-13, VIP-14
// run: try Console.log(try quote)
error InvalidQuantity {
  quantity: number
}

effect function unitPrice(total: number, quantity: number) {
  if (quantity <= 0) throw new InvalidQuantity({ quantity })
  return total / quantity
}
// number!InvalidQuantity

const quote = unitPrice(72, 6)
// Output: 12
```

`quote` holds a reusable Effect; `try quote` inside an effect function runs it and returns the number. The error channel records the validation failure, so callers can handle it without inspecting this implementation.

## Share an application foundation

```vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-9, VIP-12, VIP-14
// run: try Console.log(try preview())
service Prices {
  total(sku: string): number!InvalidQuantity
}

effect function receipt(sku: string) {
  const prices = try Prices
  const amount = try prices.total(sku)
  return `Total: ${amount}`
}
// string!InvalidQuantity!Prices

const PricesTest = Layer.succeed(Prices, {
  effect total(_sku) { return 18 }
})

effect function preview() {
  provide PricesTest { return try receipt("pencil-box") }
}
// Output: Total: 18
```

Services carry dependencies in the same contract as errors and successes. Layers supply implementations and manage their resources: tests provide an in-memory implementation, the application a database or HTTP one.

## Apply composable production tools

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try Effect.provide(resilientReceipt("pencil-box"), PricesTest))
effect function resilientReceipt(sku: string) {
  return try withSpan(
    timeout(retry(receipt(sku), { times: 2 }), "800 millis"),
    "receipt"
  )
}
// Output: Total: 18
```

These operators share Effect's execution and cleanup rules. Each takes the Effect it wraps directly, as in `retry(receipt(sku), { times: 2 })`. Retry repeats the program from the beginning, timeout interrupts work past its deadline, and the span describes the whole operation. Retry only failures worth repeating, and make repeated writes safe first.

The same foundation serves streams, caches, validated input, configuration, and observability; introduce those modules as concrete problems arise.

## Learn with practical programs

Start with one operation that reads data, validates it, and returns a result. Test its success and failure cases, then add a service boundary and a deadline. Continue with [The Effect Type](003-the-effect-type.md) and [Creating Effects](005-creating-effects.md).

## Coming from Effect

VibeLang keeps Effect's library and runtime. `try` expressions sequence Effects; retry, timeout, concurrency, and provisioning keep their library APIs, with Effect arguments.

[Upstream Effect page](https://effect.website/docs/v4/getting-started/why-effect)
