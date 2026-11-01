# Plain code throws as JavaScript does

A constructor, an accessor, a class static block and a module's top level are
plain JavaScript (VIP-1, VIP-26), and a throw there is JavaScript's throw
(VIP-4): it reaches the code that constructs, reads, or imports, whose
JavaScript `catch` catches it. This covers an error class's constructor and an
ordinary one, class and object-literal accessors, a static block, a rethrow
from a constructor's catch, a class declared inside a function, and top-level
throw statements and a throw expression, each in a module of its own because
the first top-level throw ends the module's evaluation.

Before VIP-4 none of this code could fail: each throw was EK9203, or EK1001 at
the top level (D282).
