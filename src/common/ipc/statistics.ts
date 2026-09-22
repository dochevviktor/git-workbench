import { z } from 'zod';

const day = z.iso.date();
const count = z.number().int().nonnegative();
const repositoryId = z.string().regex(/^repo-[a-f0-9]{64}$/u);
export const statisticsLimitScaleSchema = z.union([z.literal(1), z.literal(2), z.literal(5), z.literal(10)]);
export type StatisticsLimitScale = z.infer<typeof statisticsLimitScaleSchema>;
export function statisticsLimits(scale: StatisticsLimitScale = 1) {
  return {
    commits: 10000 * scale,
    paths: 2000 * scale,
    changes: 100000 * scale,
    outputBytes: 16 * 1024 * 1024 * scale,
    timeoutMs: 15000 + 8000 * scale,
  };
}
export const statisticsRequestSchema = z
  .strictObject({
    id: repositoryId,
    readId: z.string().uuid(),
    from: day.nullable(),
    to: day.nullable(),
    refresh: z.boolean(),
    limitScale: statisticsLimitScaleSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, 'Invalid date range');
export const statisticsCancelSchema = z.strictObject({
  id: repositoryId,
  readId: z.string().uuid(),
});
export const statisticsSchema = z
  .strictObject({
    head: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/u)
      .nullable(),
    shallow: z.boolean(),
    from: day.nullable(),
    to: day.nullable(),
    commits: z
      .array(
        z.strictObject({
          oid: z.string().regex(/^[a-f0-9]{40,64}$/u),
          author: z.string().max(4096),
          date: day,
          subject: z.string().max(4096),
        }),
      )
      .max(100000),
    months: z
      .array(z.strictObject({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u), count }))
      .max(12000),
    authors: z.array(z.strictObject({ author: z.string().max(4096), count })).max(100000),
    files: z
      .array(z.strictObject({ path: z.string().min(1).max(4096), commits: z.array(count).max(100000) }))
      .max(20000),
  })
  .refine(
    (value) =>
      value.files.every((file) => file.commits.every((index) => index < value.commits.length)) &&
      value.files.reduce((sum, file) => sum + file.commits.length, 0) <= 1000000 &&
      value.authors.reduce((sum, author) => sum + author.count, 0) === value.commits.length &&
      value.months.reduce((sum, month) => sum + month.count, 0) === value.commits.length,
    'Inconsistent statistics totals or file references',
  );
export type StatisticsRequest = z.infer<typeof statisticsRequestSchema>;
export type Statistics = z.infer<typeof statisticsSchema>;
