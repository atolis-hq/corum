an alternative to file based, and introduced branch support.

no need to store the graph files locally, instead point at a git repository. all works through direct git commands.

stage 1. load and save changes direct to a single git branch.

stage 2. add support for branching, and enable cross branch comparison / reconcilation. Usual process is to branch from main, then make changes. Additions and changes should be highlighted for the current branch. Other branches may also make additions, which should be visible as gost. and possible to cherry pick them into this branch. Tools should show when a node or edge is in multiple branches. This paves the way for impact analysis.

Find conflicts where property values have changed.