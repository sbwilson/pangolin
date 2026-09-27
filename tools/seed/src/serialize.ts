// Canonical JSON: sorted keys, two-space indent, trailing newline. The same value always
// serialises to the same bytes, so two seed runs can be compared with `cmp`.

function canonical(value: unknown, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Not a finite number at ${path}: ${value}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, i) => canonical(item, `${path}[${i}]`));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(`Not a plain object at ${path}`);
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) throw new TypeError(`undefined at ${path}.${key}`);
      out[key] = canonical(item, `${path}.${key}`);
    }
    return out;
  }
  throw new TypeError(`Cannot serialise ${typeof value} at ${path}`);
}

/**
 * Serialises plain JSON data with object keys sorted at every depth. Throws `TypeError` for
 * anything JSON would drop or mangle: `undefined`, non-finite numbers, functions, class instances.
 */
export function serialize(value: unknown): string {
  return `${JSON.stringify(canonical(value, "$"), null, 2)}\n`;
}
