export function parseTechRef(ref: string): { name: string; version: string } {
  const at = ref.lastIndexOf('@');
  if (at <= 0) return { name: ref, version: 'unknown' };
  return { name: ref.slice(0, at), version: ref.slice(at + 1) };
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
