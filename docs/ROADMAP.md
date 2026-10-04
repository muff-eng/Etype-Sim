# Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Workshop, car exterior, interactive bonnet, wheels, engine bay, camera, interaction, tool system | **Done** |
| 2 | Fluids, oil change, tyres & wheel change, battery, fuses, charging, cooling, ignition, diagnostics → **Tier I** | **Done** (7 work orders) |
| 3 | Engine removal (hoist, stand, connection detection), strip-down, measurement (micrometer, bore gauge, Plastigauge), reassembly → **Tier II** | Data groundwork in place: crank journals, pistons, rods, valves, head nuts with torque, `phase: 3` access gates |
| 4 | Gearbox, suspension, brakes (bleeding, air in the system), full electrical (lighting, wipers), fuel system tuning (SU synchronisation) | Slots defined, gated `phase: 4` |
| 5 | Junkyard shell, body restoration (rust, panels, paint), machine shop (money + days), complete engine & gearbox rebuild → **Tier III** | Parts PC tabs reserved |
| 6 | Advanced diagnostics, educational mode expansion, physics polish, audio, optimisation (LOD, instancing, asset streaming) | Ongoing |

## Next concrete steps (Phase 3)
1. Raise `BUILD_PHASE` to 3 in `sim/access.ts` and add removal fasteners for the inlet manifold, cam
   covers, head nuts (spiral sequence), timing chain and sump bolts.
2. Add an `EngineAssembly` state that detaches the engine group from the car once every
   connection is released: battery, fuel, HT, coolant hoses, exhaust down-pipes, propshaft and mounts.
   The connection list is data-driven, so the engine cannot "pass through" the car while anything is
   still attached.
3. Hoist interaction: chain hook points, load leveller angle, lift and manoeuvre with collision against the
   front frame.
4. Measurement sessions on the bench, using the `MeasurementDef` entries that already exist (for example
   `main1…main7`), with reuse / machine / replace decisions.
5. Tier II job: "Knocking at idle" (bearing damage), which is already simulated when oil pressure collapses.

## Asset plan
Placeholder procedural meshes are bound to slot ids (`Binder.bind`). Detailed glTF assets can replace any of them
one at a time with no gameplay change. Hero assets go first (engine, suspension, brakes, gearbox), using
instanced fasteners and LODs for the body.
