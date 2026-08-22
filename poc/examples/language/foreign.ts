/** @module @throws {never} */
export class ForeignFailure extends Error {}

/** @throws {never} */
export function trustedLength(value: string): number {
  return value.length;
}

/** @throws {never} */
export function trustedLog(...values: unknown[]): void {
  console.log(...values);
}

/** @throws {ForeignFailure} */
export function declaredFailure(fail: boolean): string {
  if (fail) throw new ForeignFailure("declared foreign failure");
  return "ok";
}

export async function untrustedAsync(value: string): Promise<string> {
  return value.toUpperCase();
}

export const foreignAny: any = {
  unwrap(): string {
    return "real foreign method named unwrap";
  },
};

export class AccessFailure extends Error {}

export const foreignClient = {
  /** @throws {never} */
  trustedMethod(value: string): string {
    return value.toUpperCase();
  },
  untrustedMethod(value: string): string {
    return value.toLowerCase();
  },
  /** @throws {AccessFailure} */
  declaredMethod(fail: boolean): string {
    if (fail) throw new AccessFailure("declared method failure");
    return "ok";
  },
  /** @throws {AccessFailure} */
  get dangerousValue(): string {
    throw new AccessFailure("getter failure");
  },
  /** @throws {never} */
  get safeValue(): string {
    return "safe";
  },
};

export function makeCallable(): (value: string) => string {
  return (value) => value.toUpperCase();
}

export async function makeAsyncCallable(): Promise<(value: string) => Promise<string>> {
  return async (value) => value.toUpperCase();
}

export function receiveCallback(callback: () => void): void {
  callback();
}

export function receiveCallbackOptions(options: { readonly onValue: () => void }): void {
  options.onValue();
}

/** @throws {never} */
export function trustedCallbackHost(callback: () => void): void {
  callback();
}

export class UntrustedConstructed {
  constructor(readonly value: string) {}
}

export class DeclaredConstructed {
  /** @throws {AccessFailure} */
  constructor(readonly value: string) {
    if (!value) throw new AccessFailure("declared constructor failure");
  }
}

export class TrustedConstructed {
  /** @throws {never} */
  constructor(readonly value: string) {}
}
