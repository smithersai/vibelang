// TypeScript-only constructs that have runtime emit: enums and namespaces.

enum Direction {
  Up = 1,
  Down,
  Left = "left",
}

const enum Flags {
  None = 0,
  Read = 1,
  Write = 2,
}

namespace Geometry {
  export const origin = { x: 0, y: 0 };
  export function translate(point: { x: number; y: number }, dx: number, dy: number) {
    return { x: point.x + dx, y: point.y + dy };
  }
}

console.log(`${Direction.Up} ${Direction.Down} ${Direction.Left}`);
console.log(Direction[2]);
console.log(`${Flags.Read | Flags.Write}`);
const moved = Geometry.translate(Geometry.origin, 3, 4);
console.log(`${moved.x},${moved.y}`);

// This file is an ES module: the fork emits ESM, and module scope is what a
// real interop file has. Without it these top-level declarations would be
// script globals and could collide with the standard library.
export {};
