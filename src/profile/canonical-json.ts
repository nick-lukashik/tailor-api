import { createHash } from 'node:crypto'

/** JSON with object keys sorted at every level: the same document always gives the same text. */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) =>
        item && typeof item === 'object' && !Array.isArray(item)
            ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
            : item,
    )
}

/** SHA-256 of the canonical JSON, hex. */
export const documentHash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
