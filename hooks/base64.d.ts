// The mod's environment has the typed-array base64 methods; the TypeScript
// lib this build's tsconfig names does not declare them yet.
interface Uint8Array {
  toBase64(): string
}

interface Uint8ArrayConstructor {
  fromBase64(base64: string): Uint8Array<ArrayBuffer>
}
