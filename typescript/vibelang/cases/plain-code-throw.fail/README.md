# D282: plain JavaScript code never fails

A constructor, an accessor and a class static block run as plain JavaScript,
as a module's top level does. Each throw here can escape such code, so each
is EK9203, or EK1001 at the top level: an error class's constructor and an
ordinary one, class and object-literal accessors, a static block, a rethrow
from a constructor's catch, a class declared inside a function, and top-level
throw statements and a throw expression.
