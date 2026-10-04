# Simulated vehicle

| | |
|---|---|
| In-game name | **Cougar Type E** — Series 1 4.2 Fixed Head Coupé |
| Engine (in-game) | **4.2L JET Inline-Six** |
| Model year | 1965 |
| Series | Series 1, 4.2 litre, covered headlamps |
| Body | Fixed Head Coupé: monocoque centre section with a bolted tubular front frame and one-piece forward-hinged bonnet |
| Steering | Right-hand drive (home market) |
| Engine | In-line six, DOHC, 2 valves per cylinder, 4235 cc, 92.07 × 106 mm, 9 : 1 compression, 3 × SU HD8 |
| Transmission | 4-speed all-synchromesh; Salisbury final drive with Powr-Lok limited-slip differential |
| Electrical | 12 V **negative earth**, alternator with separate regulator, pre-engaged starter |
| Suspension | Front: wishbones + longitudinal torsion bars. Rear: independent (IRS cage, lower wishbones, driveshafts as upper links, twin coil/damper units per side) |
| Brakes | Discs all round, servo-assisted, rear discs inboard |
| Wheels / tyres | 72-spoke wire wheels 15 × 5K with eared knock-off spinners; 185 VR 15 |

The variant is fixed so that no specifications from incompatible generations are mixed: no 3.8 Moss gearbox, no
positive-earth dynamo electrics, no Series 2 open headlamps, no 2+2 dimensions. Example: valve clearances use
the early 4.2 cam profile (0.004 in / 0.006 in), not the 0.012–0.014 in of later engines.

## Source of truth

All values live in [`src/data/spec.ts`](../src/data/spec.ts) (and torque values in the `TORQUE` table there).
Slot definitions refer to those keys, so the in-game manual, the torque wrench and the validation logic always
agree.

Every value carries a status:

* **reference**: cross-checked against published owner-club or supplier data for this variant. For example:
  sump refill 15 Imp pints (= 18 US pints), cooling system 32 Imp pints (= 38½ US pints), gearbox 2½ Imp pints,
  static timing 10° BTDC at 9 : 1, Champion N5 plugs gapped 0.025 in on pre-March-1967 cars, tyres 32 psi cold,
  head nuts 54 lb ft with the composite gasket.
* **provisional (†)**: the best figure available, flagged in the manual with † until it has been checked against
  the factory service manual. Examples are the drain-plug and filter-bolt torques, the crank journal
  tolerances, the thermostat range, the battery capacity and the fuse grouping.

**Before release, every † value must be verified against the factory service manual** and its status changed
to `reference`. Gameplay tolerances are data-driven, so correcting a value needs no code changes.

### Known simplifications (placeholders, not claims)
* The fuse block is modelled as 6 circuits with simplified grouping.
* The placement of some ancillaries (distributor side, dipstick side, oil filler position) is approximated and
  should be checked against reference photographs.
* The body is procedural lofted geometry, a placeholder with stable slot bindings that detailed assets can replace.

## Branding
All marque and engine names come from [`src/config/branding.ts`](../src/config/branding.ts). The game uses
fictional names (Cougar / Type E / JET), and part numbers are generated (`CTE-xxxxx`), not real factory numbers.
Restoring licensed names, if a licence is obtained, only means editing that file plus the two text textures on
the cam cover and tail badge, which also read from `BRANDING`.
