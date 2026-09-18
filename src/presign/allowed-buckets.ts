/** 接口允许访问的桶白名单。新增桶时在此追加字面量即可。 */
export const ALLOWED_BUCKETS = ['audio'] as const;
export type AllowedBucket = (typeof ALLOWED_BUCKETS)[number];
export function isAllowedBucket(value: string): value is AllowedBucket {
  return (ALLOWED_BUCKETS as readonly string[]).includes(value);
}
