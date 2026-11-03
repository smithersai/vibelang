# Plain code never throws

A constructor, an accessor, a class static block and a module's top level are
plain JavaScript (VIP-1, VIP-26). Synchronous VibeLang code never throws (Will,
2026-10-31; chapter 3), so each `throw` here is `EK0401`: an error class's
constructor and an ordinary one, class and object-literal accessors, a static
block, a rethrow from a constructor's catch, a class declared inside a function,
and top-level throw statements and a throw expression. Code that throws belongs
in a `.ts` file.
