/**
 * The seed for the app under test. Rebuilt on every process start, so the app is
 * stateless between runs and no spec can poison another.
 */

export type Part = {
  id: string
  code: string
  label: string
  stageId: string
  stock: number
}

export type Job = {
  id: string
  label: string
  status: "open" | "closed"
  partIds: string[]
}

export type Stage = { id: string; label: string }

export const STAGES: Stage[] = [
  { id: "stage-intake", label: "Intake" },
  { id: "stage-bench", label: "Bench" },
  { id: "stage-paint", label: "Paint" },
  { id: "stage-quality", label: "Quality control" },
  { id: "stage-shipping", label: "Shipping" },
]

/**
 * Codes are deliberately unpadded decimals: sorted as text, "630.10" lands before
 * "630.5" and "10" before "4". The natural-order spec is what pins that down.
 */
const SEED_PARTS: Array<[string, string, string, number]> = [
  ["4", "Bottom bracket cup, threaded BSA 68 mm", "stage-bench", 12],
  ["6", "Headset bearing 45x45, sealed cartridge", "stage-bench", 40],
  ["9", "Chainring bolt set, aluminium, five pieces", "stage-intake", 8],
  ["10", "Rear derailleur hanger, replaceable, type 41", "stage-bench", 3],
  ["12", "Brake pad set, organic compound, post mount", "stage-quality", 24],
  ["17", "Freehub body, twelve-speed, alloy driver", "stage-bench", 5],
  ["23", "Cassette lockring with integrated washer", "stage-intake", 31],
  ["31", "Handlebar tape, perforated, black", "stage-shipping", 60],
  ["48", "Seatpost clamp 34.9 mm, quick release lever", "stage-bench", 14],
  ["55", "Tubeless valve stem, 44 mm, with removable core", "stage-intake", 90],
  ["61", "Crank arm dust cap, self-extracting bolt", "stage-bench", 7],
  ["77", "Rim tape roll, 25 mm, ten metres", "stage-shipping", 18],
  ["96", "Derailleur cable inner, stainless, slick finish", "stage-intake", 45],
  ["104", "Suspension fork lower leg service kit, complete", "stage-bench", 2],
  ["119", "Disc brake rotor 180 mm, six bolt, rounded edge", "stage-quality", 11],
  ["135", "Pedal axle rebuild kit with sealed bearings", "stage-bench", 6],
  ["166", "Wheel spoke, double butted, 292 mm, black", "stage-intake", 220],
  ["203", "Frame protection film, matte, precut set", "stage-paint", 9],
  ["287", "Shock eyelet hardware, 22.2 x 8 mm", "stage-bench", 4],
  ["341", "Chain quick link, twelve-speed, reusable", "stage-intake", 75],
  ["600", "Bar end plug, expanding, pair", "stage-shipping", 33],
  ["630.5", "Grease cartridge, low viscosity, 400 g", "stage-bench", 16],
  ["630.10", "Grease cartridge, high viscosity, 400 g", "stage-bench", 13],
  ["712", "Torque wrench insert, 5 mm hex, quarter inch", "stage-quality", 1],
]

export function buildParts(): Part[] {
  return SEED_PARTS.map(([code, label, stageId, stock], index) => ({
    id: `part-${String(index + 1).padStart(3, "0")}`,
    code,
    label,
    stageId,
    stock,
  }))
}

/**
 * part-014 and part-019 are consumed by OPEN jobs, so deleting them must be refused.
 * part-024 is consumed by a CLOSED job, so deleting it must succeed: without that
 * third case the delete guard would pass by always saying no.
 */
export function buildJobs(): Job[] {
  return [
    { id: "job-1", label: "Fork service, blue hardtail", status: "open", partIds: ["part-014"] },
    { id: "job-2", label: "Drivetrain swap, gravel build", status: "open", partIds: ["part-014", "part-019"] },
    { id: "job-3", label: "Winter overhaul, city bike", status: "closed", partIds: ["part-024"] },
  ]
}

export const USERS = [
  { email: "admin@example.test", password: "inconclusive", name: "Ada Admin", role: "admin" },
  { email: "viewer@example.test", password: "inconclusive", name: "Vic Viewer", role: "viewer" },
]
