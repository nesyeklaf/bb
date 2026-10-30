import { z } from "zod";

export const PROFILE_LABEL_MAX_LENGTH = 64;

export const serverProfileSchema = z
  .object({
    id: z.string().min(1),
    serverUrl: z.string().url(),
    label: z.string().min(1).max(PROFILE_LABEL_MAX_LENGTH),
    createdAt: z.number().int().nonnegative(),
    mode: z.literal("direct"),
  })
  .strict();

export type ServerProfile = z.infer<typeof serverProfileSchema>;
export type NewServerProfile = Omit<ServerProfile, "id" | "createdAt">;

export type ServerProfilePatch = Partial<
  Pick<ServerProfile, "label" | "serverUrl">
>;
