create a pack for bdd
- feature
- scenario
- given when then
- user stories

Given When Then should allow freeform, or linkage to other nodes.

Example

Given a {domainModel} exists
When a {apiEndpoint} request is made
Then a {integrationEvent} is published
And the response code is Ok
And the {apiEndpoint} response contains
    | Name        | Foo |
    | Hello world | Bar |

It should also support examples, background (givens)

And it should support value data tables which pick up the schema and allow specifying 1 or more fields

im not sure what the best way to express this as nodes are. and how much it should be lintable - eg  do we lint the table against the schema?

The {values} should be references / edges to nodes. do we have the edge type to support this (reference)