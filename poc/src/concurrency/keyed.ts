export type AwaitedRecord<Values extends object> = {
  -readonly [Key in keyof Values]: Awaited<Values[Key]>;
};

export type SettledRecord<Values extends object> = {
  -readonly [Key in keyof Values]: PromiseSettledResult<Awaited<Values[Key]>>;
};

type KeyedVariant = "all" | "all-settled";

interface KeyedEntry {
  readonly key: PropertyKey;
  value: unknown;
}

function resultRecord(entries: readonly KeyedEntry[]): Record<PropertyKey, unknown> {
  const result = Object.create(null) as Record<PropertyKey, unknown>;
  for (const { key, value } of entries) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return result;
}

function keyed<Values extends object>(
  values: Values,
  variant: KeyedVariant,
): Promise<AwaitedRecord<Values> | SettledRecord<Values>> {
  return new Promise((resolve, reject) => {
    if ((typeof values !== "object" && typeof values !== "function") || values === null) {
      reject(new TypeError(`${variant === "all" ? "allKeyed" : "allSettledKeyed"} requires an object`));
      return;
    }

    let keys: readonly PropertyKey[];
    try {
      keys = Reflect.ownKeys(values);
    } catch (error) {
      reject(error);
      return;
    }

    const entries: KeyedEntry[] = [];
    let remaining = 1;
    // The lowest-index rejection seen so far. `allKeyed` used to reject with
    // whichever input rejected FIRST IN ARRIVAL ORDER, so a dictionary with two
    // failing entries reported a different error depending on host timing —
    // arrival order leaking into an observable value. Choosing by key position
    // makes the answer a function of program order alone, and needs no
    // `Scheduler`, because position is decided before anything is dispatched.
    let lowestRejection: { readonly index: number; readonly reason: unknown } | undefined;

    const settle = (): void => {
      if (variant === "all" && lowestRejection !== undefined) {
        reject(lowestRejection.reason);
        return;
      }
      resolve(resultRecord(entries) as AwaitedRecord<Values> | SettledRecord<Values>);
    };

    for (const key of keys) {
      let descriptor: PropertyDescriptor | undefined;
      let value: unknown;
      try {
        descriptor = Object.getOwnPropertyDescriptor(values, key);
        if (!descriptor?.enumerable) continue;
        value = Reflect.get(values, key);
      } catch (error) {
        reject(error);
        return;
      }

      const index = entries.length;
      entries.push({ key, value: undefined });
      remaining += 1;

      // Install both handlers as each property is visited. If a later getter
      // throws, already-started inputs are still observed and cannot become
      // hidden unhandled rejections.
      Promise.resolve(value).then(
        (resolved) => {
          entries[index]!.value = variant === "all"
            ? resolved
            : { status: "fulfilled", value: resolved } satisfies PromiseFulfilledResult<unknown>;
          remaining -= 1;
          if (remaining === 0) settle();
        },
        (reason) => {
          if (variant === "all") {
            // Do NOT reject here: this is only the first rejection to ARRIVE.
            // Every input is still allowed to settle so the lowest-index one
            // can win, which is also why no later rejection goes unobserved.
            if (lowestRejection === undefined || index < lowestRejection.index) {
              lowestRejection = { index, reason };
            }
          } else {
            entries[index]!.value = { status: "rejected", reason } satisfies PromiseRejectedResult;
          }
          remaining -= 1;
          if (remaining === 0) settle();
        },
      );
    }

    remaining -= 1;
    if (remaining === 0) settle();
  });
}

/**
 * Await an enumerable own-property dictionary while retaining its string and
 * symbol keys. The returned record has a null prototype, matching the TC39
 * Await Dictionary proposal.
 *
 * Fallible Smithers work composes without changing Promise rejection rules:
 * `Result.all(Object.values(await allKeyed({ profile, activity })))` aggregates
 * the resolved Result values and returns their first typed Error.
 */
export function allKeyed<const Values extends object>(values: Values): Promise<AwaitedRecord<Values>> {
  return keyed(values, "all") as Promise<AwaitedRecord<Values>>;
}

/** Await every enumerable own property and retain each fulfillment or rejection. */
export function allSettledKeyed<const Values extends object>(values: Values): Promise<SettledRecord<Values>> {
  return keyed(values, "all-settled") as Promise<SettledRecord<Values>>;
}
