# BigDecimal

`BigDecimal` works in VibeLang exactly as in Effect. Use it for decimal arithmetic where binary floating point loses information, such as prices imported as decimal strings.

## Representing decimal values

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(BigDecimal.format(unitPrice)); try Console.log(BigDecimal.format(bulkPrice))
const unitPrice = BigDecimal.make(875n, 2)
const bulkPrice = BigDecimal.make(875n, -1)
BigDecimal.format(unitPrice) // "8.75"
BigDecimal.format(bulkPrice) // "8750"
```

```output
8.75
8750
```

A value is an integer coefficient and a scale, meaning coefficient × 10^-scale: a positive scale places digits after the decimal point, a negative one adds integer zeros. Precision is arbitrary up to implementation and memory limits, not JavaScript's number precision.

## Constructing decimals

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(Option.isSome(parsed), Option.isNone(invalid), BigDecimal.format(whole), Option.isSome(fromNumber))
const whole = BigDecimal.fromBigInt(42n)
const parsed = BigDecimal.fromString("18.625")
const invalid = BigDecimal.fromString("eighteen")
const fromNumber = BigDecimal.fromNumber(2.5)

Option.isSome(parsed) // true
Option.isNone(invalid) // true
BigDecimal.format(whole) // "42"
```

```output
true true 42 true
```

`make` takes a coefficient and scale; `fromBigInt` uses scale zero. `fromString` and `fromNumber` return an `Option`, so invalid input stays data. Prefer strings for external decimals: converting a number cannot recover digits floating point already lost.

## Safe and unsafe constructors

```vibe
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-7, VIP-13, VIP-14
// run: try Console.log(BigDecimal.format(try parsePrice("18.625")), BigDecimal.format(fixedRate)); try Console.log(parsePrice("invalid") catch (error) => `${error._tag} ${error.input}`)
error InvalidPrice {
  input: string
}

effect function parsePrice(input: string) {
  return match (BigDecimal.fromString(input)) {
    when Option.Some(let price): price;
    when Option.None: throw new InvalidPrice({ input });
  }
}
// BigDecimal.BigDecimal!InvalidPrice

const fixedRate = BigDecimal.fromNumberUnsafe(1.25)
```

```output
18.625 1.25
InvalidPrice invalid
```

`fromStringUnsafe` throws for invalid text, `fromNumberUnsafe` for non-finite numbers. Use an unsafe constructor for a known valid constant; validate input with the safe constructor and fail explicitly.

## Performing arithmetic

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify([BigDecimal.format(total), BigDecimal.format(BigDecimal.sum(total, discount)), Option.getOrNull(Option.map(BigDecimal.divide(total, quantity), BigDecimal.format)), Option.getOrNull(Option.map(BigDecimal.remainder(total, quantity), BigDecimal.format)), BigDecimal.sign(BigDecimal.negate(total)), BigDecimal.format(BigDecimal.abs(BigDecimal.negate(total)))]))
const price = BigDecimal.make(875n, 2)
const quantity = BigDecimal.fromBigInt(4n)
const subtotal = BigDecimal.multiply(price, quantity)
const discount = BigDecimal.make(250n, 2)
const total = BigDecimal.subtract(subtotal, discount)

BigDecimal.format(total) // "32.5"
BigDecimal.format(BigDecimal.sum(total, discount)) // "35"
BigDecimal.divide(total, quantity) // Some containing 8.125
BigDecimal.remainder(total, quantity) // Some containing 0.5
BigDecimal.sign(BigDecimal.negate(total)) // -1
BigDecimal.format(BigDecimal.abs(BigDecimal.negate(total))) // "32.5"
```

```output
["32.5","35","8.125","0.5",-1,"32.5"]
```

`sum`, `subtract`, and `multiply` return new decimals. For a zero divisor, `divide` and `remainder` return `None`, and `divideUnsafe` and `remainderUnsafe` throw. A nonterminating quotient follows the library's precision policy: arbitrary precision does not mean an infinitely long quotient.

## Comparing values

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify([BigDecimal.isLessThan(amount, limit), BigDecimal.isLessThanOrEqualTo(amount, amount), BigDecimal.isGreaterThan(limit, amount), BigDecimal.isGreaterThanOrEqualTo(limit, limit), BigDecimal.format(BigDecimal.min(amount, limit)), BigDecimal.format(BigDecimal.max(amount, limit)), BigDecimal.between(amount, { minimum: BigDecimal.fromBigInt(0n), maximum: limit }), BigDecimal.isZero(amount), BigDecimal.isPositive(amount), BigDecimal.isNegative(amount), BigDecimal.isInteger(amount)]))
const amount = BigDecimal.make(325n, 1)
const limit = BigDecimal.fromBigInt(40n)
BigDecimal.isLessThan(amount, limit) // true
BigDecimal.isLessThanOrEqualTo(amount, amount) // true
BigDecimal.isGreaterThan(limit, amount) // true
BigDecimal.isGreaterThanOrEqualTo(limit, limit) // true
BigDecimal.min(amount, limit) // amount
BigDecimal.max(amount, limit) // limit
BigDecimal.between(amount, {
  minimum: BigDecimal.fromBigInt(0n), maximum: limit
}) // true
BigDecimal.isZero(amount) // false
BigDecimal.isPositive(amount) // true
BigDecimal.isNegative(amount) // false
BigDecimal.isInteger(amount) // false
```

```output
[true,true,true,true,"32.5","40",true,false,true,false,false]
```

Compare decimals directly, not as numbers. `between` bounds are inclusive. The sign and integer predicates test the value, whatever its stored scale.

## Normalization and equality

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(BigDecimal.equals(padded, BigDecimal.make(875n, 2)), BigDecimal.format(compact), BigDecimal.toExponential(compact))
const padded = BigDecimal.make(87500n, 4)
const compact = BigDecimal.normalize(padded)
BigDecimal.equals(padded, BigDecimal.make(875n, 2)) // true
BigDecimal.format(compact) // "8.75"
BigDecimal.toExponential(compact) // "8.75e+0"
```

```output
true 8.75 8.75e+0
```

Normalization strips trailing coefficient zeros and adjusts the scale. Numeric equality already ignores that difference: normalize for a compact representation, not before comparing.
