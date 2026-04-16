export function parseTechRef(ref: string): { name: string; version: string } {
  const at = ref.lastIndexOf('@');
  if (at <= 0) return { name: ref, version: 'unknown' };
  return { name: ref.slice(0, at), version: ref.slice(at + 1) };
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const severityEnum = ['must', 'should', 'nice-to-have'] as const;
export type Severity = typeof severityEnum[number];

export const scopeEnum = ['global', 'product', 'feature', 'screen'] as const;
export type Scope = typeof scopeEnum[number];

export const enforcementEnum = ['automated', 'manual-check', 'ci-gate'] as const;
export type Enforcement = typeof enforcementEnum[number];

export const platformEnum = ['ios', 'android', 'web', 'all'] as const;
export type Platform = typeof platformEnum[number];

export const sourceRoleEnum = ['founder', 'csm', 'client', 'engineer', 'user'] as const;
export type SourceRole = typeof sourceRoleEnum[number];
