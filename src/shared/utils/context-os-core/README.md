# Context OS Core Utilities

Agnostic building blocks for the Kodus Context OS. This module contains the
interfaces, pipelines and utilities required to assemble context packs (core /
catalog / active layers), orchestrate MCP tools, and hook into observability.

## Features

- **Context pack contracts** (`ContextLayer`, `ContextPack`, `ContextLayerBuilder`)
- **Tri-layer pipeline** (`SequentialPackAssemblyPipeline`, `TriLayerPackBuilder`)
- **Token budgeting helpers** and layer diagnostics utilities
- **MCP registry/orchestrator** with retry/telemetry hooks
- Minimal defaults for materializers/selectors (useful for prototyping)

## Usage

```ts
import {
  SequentialPackAssemblyPipeline,
  TriLayerPackBuilder,
  InMemoryMCPRegistry,
  MCPOrchestrator,
  buildDefaultCoreLayer,
  buildDefaultCatalogLayer,
  buildDefaultActiveLayer,
} from '@context-os-core';

// create builders/materializers/selectors according to your domain
// (see examples folder for a tri-layer walkthrough)
```

For domain-specific implementations (code review, bug triage, etc.) build your
own snapshot + bundle on top of these primitives or check the `examples/`
directory.
