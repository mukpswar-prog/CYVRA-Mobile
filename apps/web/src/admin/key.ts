/**
 * MIRROR OF `services/api/src/admin.ts:maskSerialKey`, FOR THE DRAWER ONLY.
 * ==========================================================================
 *
 * Why the browser needs its own copy at all: `GET /admin/serials/:id` returns
 * the FULL key (it is the only route that does), and the drawer must show
 * something *before* the operator asks for it. The list's mask cannot be
 * re-requested - fetching the whole list again to get a mask would be a
 * request the drawer has no business making.
 *
 * THE RULE IT ENFORCES
 * --------------------
 * The full key is rendered only after an explicit click. Before that, this
 * function produces exactly what the server would have sent in a list row, so
 * the drawer's collapsed view is no more privileged than the table beside it -
 * an operator who opens a record learns nothing new about the key until they
 * deliberately ask. That is the difference between "the key is behind this
 * button" and "the key happened to be in this payload".
 *
 * `LICENCE_KEY_RE` is copied verbatim from `licenceKey.ts`, including its
 * comment about being a second, independent definition of the slab set. It is
 * a mirror by necessity: `apps/web` does not import from `services/api`, and
 * this is one of the two places in this console where a mirror could drift.
 * `key.test.ts` pins it to the exact fixture `adminRedaction.test.ts` uses
 * server-side, so a change to either side fails a test on the other.
 */

/** Copied from `services/api/src/licenceKey.ts`. Change both or neither. */
const LICENCE_KEY_RE = /^CYVRA(\d{2})(\d{2})(\d{4})([SB])([0-9A-F]{4})-1-(1|3|5|7|10|25|50)$/;

/** Copied from `services/api/src/licenceKey.ts`. */
const LICENCE_PREFIX = "CYVRA";

/**
 * `CYVRA01102026SA3F1-1-5` -> `CYVRA*************-1-5`.
 *
 * Unmatched input returns `CYVRA-***` rather than a fabricated mask that
 * looks well-formed: a key that does not parse is a key we should not be
 * implying we can hide correctly, and `-1-5` on an unparseable value would be
 * invented.
 */
export function maskSerialKey(publicNumber: string): string {
  const match = LICENCE_KEY_RE.exec(publicNumber.trim().toUpperCase());
  if (!match) return `${LICENCE_PREFIX}-***`;
  return `${LICENCE_PREFIX}${"*".repeat(13)}-1-${match[6]}`;
}

/**
 * What the drawer shows before the reveal, given the full key or the list's
 * own mask. `null` (no key generated yet) stays `null` - the honest projection
 * of "no key exists", never a `CYVRA-***` that would read as a real-but-
 * unavailable credential.
 *
 * An already-masked value passes through untouched. Re-masking the list's
 * `CYVRA*************-1-5` would not match `LICENCE_KEY_RE` (it has asterisks
 * where digits go) and would collapse to `CYVRA-***`, silently throwing away
 * the slab suffix - the one part of the mask the server deliberately leaves
 * visible. "Hide the key" must never be able to hide *more* than the server's
 * own hiding does.
 */
export function beforeReveal(fullKey: string | null): string | null {
  if (fullKey === null || fullKey === "") return null;
  if (fullKey.includes("*")) return fullKey;
  return maskSerialKey(fullKey);
}
