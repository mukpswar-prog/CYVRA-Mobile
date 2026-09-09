/**
 * Canonicalize then digest (guideline §8.6).
 * Never hash pretty-printed JSON. Key order must not change the digest.
 */

const encoder = new TextEncoder();

export function canonicalJson(value: unknown): string {
  return write(value);
}

function write(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("canonical JSON cannot encode non-finite numbers");
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map(write).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${write(record[key])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonical JSON cannot encode ${typeof value}`);
  }
}

export function bytesOfCanonical(value: unknown): Uint8Array {
  return encoder.encode(canonicalJson(value));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy);
  return bufferToHex(digest);
}

export async function digestCanonical(value: unknown): Promise<string> {
  return sha256Hex(bytesOfCanonical(value));
}

/** Hash the record without an embedded digest field. */
export async function digestRecord(
  record: Record<string, unknown>,
): Promise<string> {
  const { digest: _digest, ...rest } = record;
  return digestCanonical(rest);
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
