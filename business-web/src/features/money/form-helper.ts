/**
 * FORM HELPERS ONLY - not money the books rely on.
 *
 * While a shop owner types a receipt, the form shows how much of the amount
 * they have not yet assigned to a bill, so they can see at a glance whether
 * the rest will be kept as an advance. That figure is a typing aid: it is
 * never sent to the backend and never shown after saving. Once the backend
 * answers, the page shows ITS allocated and unallocated amounts instead.
 *
 * Exact decimal arithmetic on strings (4 decimal places, as the backend's
 * money schema allows), so 0.1 + 0.2 is 0.3 and not 0.30000000000000004.
 */

const SCALE = 4;
const AMOUNT = /^\d+(\.\d{1,4})?$/;

export function isAmount(value: string): boolean {
  return AMOUNT.test(value.trim());
}

/** "12.5" -> 125000n (units of 0.0001). Anything unparseable counts as 0. */
function toUnits(value: string): bigint {
  const text = value.trim();
  if (!AMOUNT.test(text)) return BigInt(0);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole + fraction.padEnd(SCALE, "0"));
}

function fromUnits(units: bigint): string {
  const negative = units < BigInt(0);
  const abs = negative ? -units : units;
  const digits = abs.toString().padStart(SCALE + 1, "0");
  const whole = digits.slice(0, -SCALE);
  const fraction = digits.slice(-SCALE, -SCALE + 2);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** What is typed in the amount box minus what is typed against bills. */
export function leftToAssign(amount: string, allocations: string[]): string {
  const assigned = allocations.reduce((sum, value) => sum + toUnits(value), BigInt(0));
  return fromUnits(toUnits(amount) - assigned);
}

/** True when a > b. For flagging "more than is due" before sending. */
export function isMore(a: string, b: string): boolean {
  return toUnits(a) > toUnits(b);
}
