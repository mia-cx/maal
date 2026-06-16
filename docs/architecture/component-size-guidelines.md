# Component size guidelines

Component size is a design signal, not a hard target. Extract when a component mixes multiple product concepts or owns repeated interaction machinery.

## Extract when a component contains

- more than one domain concept, such as schedule rendering plus recipe editing,
- repeated event guards or target filtering,
- repeated async state machines,
- route URL construction that belongs in a client adapter,
- drag/drop measurement plus business mutation decisions,
- form parsing plus persistence orchestration,
- dialog state for unrelated flows,
- more than one independent loading/error state cluster.

## Preferred split

- Keep shells responsible for composition and layout.
- Move fetch and route URL construction into feature client adapters.
- Move pure state transitions into tested controller/model modules.
- Move repeated markup clusters into focused presentational components.
- Keep design-system primitives generic; product wrappers live in domain feature folders.

## Review heuristic

A component over roughly 500 lines should justify why a split would make behavior harder to understand. A component over roughly 800 lines should be treated as refactor debt unless it is generated or mostly static markup.
