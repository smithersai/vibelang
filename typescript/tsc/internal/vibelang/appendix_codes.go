package vibelang

// Appendix B assigns these identifiers ahead of their owning VIP implementations.
// Registration alone never adds a checker or changes a diagnostic trigger.
var (
	EK0101 = message(101, errorCategory, "Effect f() { } or async f() { } outside a class or object literal. Use the matching effect or async function form; move legacy JavaScript to a .ts file.")
	EK0102 = message(102, errorCategory, "Await, for await or await using in effect code. Use the matching effect or async function form; move legacy JavaScript to a .ts file.")
	EK0104 = message(104, errorCategory, "Effect on a getter, setter or constructor. Use the matching effect or async function form; move legacy JavaScript to a .ts file.")
	EK0105 = message(105, errorCategory, "Effect and async on one function. Use the matching effect or async function form; move legacy JavaScript to a .ts file.")
	EK0106 = message(106, errorCategory, "An effect function whose written return type is not an Effect. Use the matching effect or async function form; move legacy JavaScript to a .ts file.")
	EK0107 = message(107, errorCategory, "Eval, Function, arguments, var or with in a .vibe file. Use the matching effect or async function form; move legacy JavaScript to a .ts file.")
	EK0301 = message(301, errorCategory, "! beside a union, an intersection, a function type or a conditional type without parentheses. Parenthesize the intended type before combining ! with another type operator.")
	EK0401 = message(401, errorCategory, "A throw, a call that may throw, or a parameter default that may throw, in an effectful function. Wrap throwing code with Effect.try or tryPromise, or declare a compatible @throws contract.")
	EK0402 = message(402, errorCategory, "A function that may throw where a function type doesn't admit its thrown type. Wrap throwing code with Effect.try or tryPromise, or declare a compatible @throws contract.")
	EK0403 = message(403, errorCategory, "An unwrapped call, new expression or tagged template that may throw, in effect code or a plain catch handler. Wrap throwing code with Effect.try or tryPromise, or declare a compatible @throws contract.")
	EK0404 = message(404, errorCategory, "An unwrapped Promise-producing call, new expression or async match in effect code. Wrap throwing code with Effect.try or tryPromise, or declare a compatible @throws contract.")
	EK0405 = message(405, errorCategory, "A body that throws more than its written @throws {T}. Wrap throwing code with Effect.try or tryPromise, or declare a compatible @throws contract.")
	EK0501 = message(501, errorCategory, "Try outside effect code, the top level included. Run an Effect with try inside effect code; use a function literal as the catch handler.")
	EK0503 = message(503, errorCategory, "A try statement in effect code. Run an Effect with try inside effect code; use a function literal as the catch handler.")
	EK0504 = message(504, errorCategory, "Catch outside effect code. Run an Effect with try inside effect code; use a function literal as the catch handler.")
	EK0505 = message(505, errorCategory, "Try x catch h. Run an Effect with try inside effect code; use a function literal as the catch handler.")
	EK0506 = message(506, errorCategory, "E catch h where e is not an Effect. Run an Effect with try inside effect code; use a function literal as the catch handler.")
	EK0507 = message(507, errorCategory, "A handler whose result is a Promise or thenable. Run an Effect with try inside effect code; use a function literal as the catch handler.")
	EK0508 = message(508, warningCategory, "A plain handler whose result is an Effect; use catch effect. Run an Effect with try inside effect code; use a function literal as the catch handler.")
	EK0801 = message(801, warningCategory, "Using in effect code; use acquireDisposable inside scoped. Use acquireDisposable inside scoped for an Effect resource.")
	EK0901 = message(901, errorCategory, "A static key without readonly, or whose initializer is not a string literal. Declare service contracts only, and supply a static readonly string-literal key if no key can be derived.")
	EK0902 = message(902, errorCategory, "A service member that is not a PropertySignature, MethodSignature, KeyMember or DefaultMember. Declare service contracts only, and supply a static readonly string-literal key if no key can be derived.")
	EK0903 = message(903, errorCategory, "A service with no derived key and no static readonly key. Declare service contracts only, and supply a static readonly string-literal key if no key can be derived.")
	EK1201 = message(1201, errorCategory, "Provide outside effect code. Move provide into an effect function or effect block.")
	EK1401 = message(1401, errorCategory, "A namespace name that two subpaths export, or a subpath and the root. Import the conflicting modules under distinct names.")
	EK1701 = message(1701, errorCategory, "Fork or join outside effect code. Move fork or join into an effect function or effect block.")
	EK1901 = message(1901, errorCategory, "A for concurrent operand that is not an Iterable. Iterate an Iterable inside effect code, and use continue to end an item.")
	EK1902 = message(1902, errorCategory, "For concurrent outside effect code. Iterate an Iterable inside effect code, and use continue to end an item.")
	EK1905 = message(1905, errorCategory, "continue cannot leave a for concurrent item: each item runs in its own fiber.")
	EK2001 = message(2001, errorCategory, "For try outside effect code. Iterate a Stream with for try inside effect code and keep control flow inside the loop.")
	EK2002 = message(2002, errorCategory, "Return in a for try body. Iterate a Stream with for try inside effect code and keep control flow inside the loop.")
	EK2003 = message(2003, errorCategory, "A labeled break or continue from a for try body to a statement outside it. Iterate a Stream with for try inside effect code and keep control flow inside the loop.")
	EK2004 = message(2004, errorCategory, "A for try operand that is not a Stream. Iterate a Stream with for try inside effect code and keep control flow inside the loop.")
	EK2102 = message(2102, errorCategory, "A producer whose written return type is not a Stream. Yield values from a producer and return without a value; its return type is a Stream.")
	EK2103 = message(2103, errorCategory, "Yield* in a producer. Yield values from a producer and return without a value; its return type is a Stream.")
	EK2201 = message(2201, errorCategory, "An interruption block outside effect code. Use interruption blocks inside effect code and restore inside the same uninterruptible region.")
	EK2202 = message(2202, errorCategory, "Restore in an effect arrow or block nested in an uninterruptible block. Use interruption blocks inside effect code and restore inside the same uninterruptible region.")
	EK2803 = message(2803, errorCategory, "A default on a generic data type parameter. Use at most four unconstrained type parameters without defaults.")
	EK3006 = message(3006, errorCategory, "An error code or an unknown code in vibe.severities; remove the entry. Remove the invalid entry from vibe.severities; only warning codes may be configured.")
)

func init() {
	for _, m := range []*Message{EK0101, EK0102, EK0104, EK0105, EK0106, EK0107, EK0301, EK0401, EK0402, EK0403, EK0404, EK0405, EK0501, EK0503, EK0504, EK0505, EK0506, EK0507, EK0508, EK0801, EK0901, EK0902, EK0903, EK1201, EK1401, EK1701, EK1901, EK1902, EK1905, EK2001, EK2002, EK2003, EK2004, EK2102, EK2103, EK2201, EK2202, EK2803, EK3006} {
		registry[m.Code] = m
	}
}
