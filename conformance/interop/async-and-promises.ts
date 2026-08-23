// Ordinary TypeScript async behavior, including rejection handling and
// Promise combinators, which authored `.sm` deliberately forbids.

async function delayed<T>(value: T): Promise<T> {
  await Promise.resolve();
  return value;
}

async function failing(): Promise<number> {
  throw new RangeError("host failure");
}

async function main(): Promise<void> {
  const values = await Promise.all([delayed(1), delayed(2), delayed(3)]);
  console.log(values.join(","));

  const settled = await Promise.allSettled([delayed("ok"), failing()]);
  console.log(settled.map((entry) => entry.status).join(","));

  const recovered = await failing().catch((error: unknown) =>
    error instanceof RangeError ? `caught ${error.message}` : "other",
  );
  console.log(recovered);

  try {
    await failing();
  } catch (error) {
    console.log(`try/catch ${(error as Error).message}`);
  }
}

await main();

// This file is an ES module: the fork emits ESM, and module scope is what a
// real interop file has. Without it these top-level declarations would be
// script globals and could collide with the standard library.
export {};
