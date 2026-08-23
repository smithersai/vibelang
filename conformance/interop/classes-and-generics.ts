// Ordinary TypeScript: classes, parameter properties, abstract members,
// generics with constraints, and static state. Nothing Smithers-specific.

abstract class Shape {
  protected constructor(readonly name: string) {}
  abstract area(): number;
  describe(): string {
    return `${this.name} ${this.area().toFixed(2)}`;
  }
}

class Rectangle extends Shape {
  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    super("rectangle");
  }
  area(): number {
    return this.width * this.height;
  }
}

class Circle extends Shape {
  static readonly ratio = 3.14159;
  constructor(private readonly radius: number) {
    super("circle");
  }
  area(): number {
    return Circle.ratio * this.radius * this.radius;
  }
}

interface Named {
  readonly name: string;
}

function longestName<T extends Named>(items: readonly T[]): string {
  return items.reduce((best, item) => (item.name.length > best.length ? item.name : best), "");
}

const shapes: readonly Shape[] = [new Rectangle(3, 4), new Circle(2)];
for (const shape of shapes) console.log(shape.describe());
console.log(longestName(shapes));
console.log(`${shapes[0] instanceof Rectangle} ${shapes[1] instanceof Shape}`);

// This file is an ES module: the fork emits ESM, and module scope is what a
// real interop file has. Without it these top-level declarations would be
// script globals and could collide with the standard library.
export {};
