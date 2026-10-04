# Architecture

```
src/
├── config/branding.ts      marque/engine names (licensing layer)
├── core/                   event bus, deterministic RNG, units
├── data/                   DATA — no logic beyond pure helpers
│   ├── spec.ts             vehicle specification + torque tables (with verification status)
│   ├── parts.ts            PartDef: item types, measurements, inspection text, containers
│   ├── slots.ts            SlotDef: every serviceable location: fit, access, fasteners, threads
│   ├── tools.ts            ToolDef + size-fit rules
│   ├── fluids.ts           fluid types, circuits, compatibility, mixing
│   ├── layout.ts           vehicle-local geometry shared by sim & render
│   ├── procedures.ts       reusable procedures; steps detected from state, each with a "why"
│   ├── faults.ts           diagnostic faults (state changes only) + diagnosis list
│   ├── jobs.ts             Tier work orders (customer complaints = symptoms only)
│   └── education.ts        educational-mode content
├── sim/                    SIMULATION — never imports three.js
│   ├── vehicle.ts          VehicleState (slots ↔ part instances, fluids, support, engine runtime)
│   ├── access.ts           reachability, removal and fit rules (why not?)
│   ├── threads.ts          fastener mechanics: engagement, seating, torque, breakaway, cross-thread, strip, rounding
│   ├── electrical.ts       nodal-analysis DC circuit solver: meter, test lamp, cranking, charging, fuses
│   ├── engine.ts           ignition, fuel, starting, rpm, lubrication, cooling, leaks, smoke
│   └── diagnostics.ts      error detection ("why won't it start") + assembly validation
├── game/                   GAMEPLAY — verbs over the simulation
│   ├── state.ts            serialisable GameState
│   ├── Game.ts             tick, tools, fasteners, fluids routing, jack/stands, economy, jobs, grading
│   └── actions.ts          context actions for a selected component
├── render/                 PRESENTATION — reads state, never owns it
│   ├── CarBody.ts / loft.ts  procedural body loft (bonnet, tub, doors, greenhouse, hatch), trim & interior
│   ├── EngineModel.ts      procedural engine with moving internals and explode vectors
│   ├── Chassis.ts, Wheels.ts, Workshop.ts, Equipment.ts
│   ├── CarModel.ts         slot ↔ mesh bindings, pose, fastener travel, x-ray / cutaway / exploded
│   ├── CameraController.ts, Interaction.ts, Renderer.ts
├── audio/Audio.ts          procedural WebAudio; engine AudioWorklet fires per-cylinder pulses
├── ui/                     DOM HUD and modals
└── save/Save.ts            StorageAdapter (localStorage now, cloud later) + migration
```

## Principles
* **Data separate from presentation.** A part's condition lives in `PartState`. Meshes are bound to *slots*
  through `Binder.bind(slotId, object)`. Replacing a placeholder mesh with a detailed asset means changing the
  binding and nothing else.
* **Slots vs parts.** A `SlotDef` is a place on the car (for example "spark plug, cylinder 4"). A `PartDef` is
  a kind of item (for example "Champion N5"). Slots list the parts they accept, so wrong-but-fitting parts are
  possible (for example a short-reach plug). Kits, used parts and junkyard parts all use the same mechanism.
* **Symptoms emerge.** Faults only change component state (contact resistance, belt deflection, plug fouling,
  clip torque…). Cranking speed, clicking, misfire, charging voltage, overheating, leaks and meter readings all
  come out of `electrical.ts` and `engine.ts`. No symptom text is scripted.
* **Steps are detected, not clicked.** Procedures evaluate predicates over state and latch per job.
* **Every refusal has a reason.** Access, removal, fit and tool checks return human-readable reasons. The UI
  shows them, and assistance level decides how many.
* **Deterministic consequences.** Cross-threading happens if and only if a tool starts an un-started thread.
  Stripping happens if and only if torque exceeds the host's limit. Rounding happens if and only if a
  loose-fitting tool is loaded. The only randomness is measurement scatter within tool resolution.

## Adding content
* **A component:** add a `SlotDef` (and a `PartDef` if it is a new item type), then bind a mesh in the
  relevant render module.
* **A fastener:** add a `thread` spec to the slot. Torque, tools, the manual table and validation all follow.
* **A fault:** add a `FaultDef` with `apply` and `resolved`, then reference it from a job.
* **A tier:** add `JobDef`s with `tier: 2|3`. Phase-gated slots (`access: phase 3/4`) become serviceable when
  `BUILD_PHASE` in `sim/access.ts` is raised.
