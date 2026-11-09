package vibelang

import ()

var dataDefault = EK2803.With("{0} cannot have a default in a data declaration. Write the default on a type alias, or write this declaration as its Effect TypeScript.")

func init() {
	registry[EK2803.Code] = dataDefault
}
