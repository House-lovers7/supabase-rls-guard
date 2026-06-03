/**
 * Safe accessors for the untyped libpg-query parse tree.
 *
 * The parse tree is external, dynamically-shaped JSON, so we treat it as
 * `unknown` and narrow every access through these guards rather than reaching
 * for `any`. The `as` casts here are the canonical type-guard implementations
 * (each is preceded by a runtime check), and they are the *only* casts in the
 * parser — everything the rest of the tool sees is the fully-typed
 * {@link ../core/types.Statement} model this layer produces.
 */

export type AstObject = Record<string, unknown>

export function asObject(value: unknown): AstObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as AstObject)
    : undefined
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

export function isTrue(value: unknown): boolean {
  return value === true
}

/** Reads a property from a node, returning `undefined` if it is not an object. */
export function field(value: unknown, key: string): unknown {
  return asObject(value)?.[key]
}

/** The single wrapper key of a libpg node, e.g. `"CreateStmt"`. */
export function nodeTag(value: unknown): string | undefined {
  const obj = asObject(value)
  if (!obj) return undefined
  return Object.keys(obj)[0]
}

/** Flattens libpg's `[{ String: { sval } }, ...]` lists to `string[]`. */
export function stringValues(list: unknown): string[] {
  return asArray(list)
    .map((node) => asString(field(field(node, 'String'), 'sval')))
    .filter((value): value is string => value !== undefined)
}
