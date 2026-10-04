# Cougar Type E Workshop

A browser-based 3D mechanic and restoration simulator built around a 1965 **Series 1 4.2 Fixed Head Coupé**,
called the **Cougar Type E** in-game, with its **4.2L JET Inline-Six**. You don't press a button to repair
anything. You undo fasteners with the right tool, drain fluids into a pan you positioned yourself, measure,
diagnose from symptoms, and tighten to torque. Mistakes have consequences you can trace back to their cause.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # simulation + full-job playthrough tests
npm run build      # type-check + production bundle in dist/
```

## What is playable (vertical slice: Phases 1–2)

* **Workshop:** concrete bay, bench and vice, tool chest (shop), parts computer, job board, compressor, shelving.
  Equipment for later tiers (two-post lift, engine hoist, engine stand, parts washer) is shown greyed out.
* **The car:** lofted body with the one-piece bonnet that hinges forward, opening doors and side-hinged
  hatch, covered headlamps, wire wheels with knock-off spinners, interior with working gauges, tubular front
  frame, suspension, inboard rear brakes, exhaust, and a twin-cam six with moving crank, rods, pistons, cams
  and valves.
* **224 serviceable locations** (41 of them threaded fasteners), each with condition, part number, access
  rules and fasteners.
  The component list is under **L**.
* **Tools:** sockets on a ratchet, breaker bar or click-type torque wrench (with extension), spanners, an
  adjustable spanner, screwdrivers, copper/hide mallet, pick, insulated HT pliers, multimeter, test lamp,
  feeler gauges, gap tool, vernier, tyre/tread gauges, hydrometer, pressure tester, compression tester,
  trolley jack, axle stands, chocks, drain pan, funnel and charger. Several must be **bought** before use,
  including the torque wrench.
* **Tier I — Maintenance:** 7 work orders, each a customer complaint with a hidden, simulated cause:
  oil & filter service, slow cranking (corroded terminal), lumpy idle (fouled plug), overheating
  (loose hose clip), flat battery (slipping belt), silent horn (fuse), pulling left (puncture).
* **Free Workshop** sandbox.

### Mechanics worth knowing
* **Hold the left mouse button on a fastener** to turn it with the tool in hand. **R** flips the ratchet
  direction. Start threads **by hand** (H); starting them with a tool cross-threads them. A torque wrench
  clicks at its setting; keep pulling and you over-torque, and past the host's limit an alloy thread strips.
  A near-miss socket size rounds the flats.
* **Real electrical circuit:** a nodal-analysis solver drives cranking speed, solenoid chatter, coil voltage,
  charging, blown fuses and every multimeter or test-lamp reading. For example, measure across a corroded
  clamp while cranking.
* **Engine simulation:** ignition per cylinder in firing order 1-5-3-6-2-4 (No.1 at the rear), mixture and
  choke, compression, oil pressure from viscosity, temperature and bearing wear, thermostat, fan, belt slip,
  leaks, smoke and steam. The procedural engine audio skips beats when a cylinder misfires.
* **Fluids:** oil drains faster when warm and lands where the drain pan is, or on the floor if it isn't.
  Wrong or mixed fluids are tracked and have consequences.
* **Diagnostics:** symptoms, not answers. Tests are logged in the notebook (**N**), you record a diagnosis,
  and the job report explains what was really wrong, what evidence you gathered, and what you damaged.
* **Assembly validation** (**V**) lists exactly what remains instead of saying "Complete".
* **Views:** orbit, fly (WASD), underbody, cockpit, inspect, plus **X-ray**, **Cutaway** and **Exploded**.
* **Assistance levels:** Beginner, Experienced, Expert and Master Mechanic. Higher levels remove names,
  verdicts, torque read-outs and checklists.
* **Workshop manual** (**M**): specifications, torque tables, capacities, procedures, a wiring diagram
  generated from the circuit model, diagnostic flowcharts and the maintenance schedule.
* **Saves** go to browser storage through an adapter interface, so cloud saves can be added later.

## Documentation
* [docs/VEHICLE_SPEC.md](docs/VEHICLE_SPEC.md): the simulated variant, data sources, verification status,
  and the branding layer.
* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module layout and how to add parts, faults and tiers.
* [docs/ROADMAP.md](docs/ROADMAP.md): Phase 3–6 plan (Tier II and Tier III).
