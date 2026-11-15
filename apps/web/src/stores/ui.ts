/**
 * Pages wait on the reveal gate before playing their entrance: on first load the
 * gate opens when the intro loader lifts, on navigation when the curtain lifts.
 */
let openGate: () => void = () => {};
let gate = new Promise<void>((resolve) => (openGate = resolve));

export function revealGate(): Promise<void> {
  return gate;
}

export function closeRevealGate(): void {
  gate = new Promise<void>((resolve) => (openGate = resolve));
}

export function openRevealGate(): void {
  openGate();
}
