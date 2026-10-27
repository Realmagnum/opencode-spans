/**
 * Cheap, dependency-free content fingerprint.
 *
 * Used only to notice that an assistant reply changed between staging an annotation
 * and sending it. Not a security primitive: two independent 32-bit lanes plus the
 * text length are enough to catch edits and regenerations.
 */
export function hashText(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b + code, 0x85ebca6b) ^ (b >>> 13)
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}:${text.length}`
}
