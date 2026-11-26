# pida

An agent harness with persistent workspaces, tool execution and model connections.

[Korean user guide](docs/USER-GUIDE.ko.md) | [CLI commands](docs/COMMANDS.md) | [Architecture](docs/ARCHITECTURE.md)
## PersonaSubstrate

When PersonaSubstrate is installed in a Python environment on the host PATH, pida initializes a member store on each agent’s first run. To select a particular installation, set `PIDA_PERSONA_SUBSTRATE_PYTHON` to its absolute Python executable before starting pida. Each workspace, principal, agent and source gets its own persistent member identity. The model receives the member identifier and current control state. Goals and stored artifacts stay in the member store.

Without that installation, a standalone workspace uses local agent memory with an initially empty persona. An embedding host can supply a provider or a catalogue through the workspace API.
To connect an existing member store, an embedding host can return `createSubstratePersona(python, root, context, sourceId, { store, ownerId })` from its authorized provider factory. Supply an absolute store path and its registered owner UUID. A missing store or mismatched owner stops the run.
