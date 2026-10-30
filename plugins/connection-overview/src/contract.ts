import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const socketRowSchema = z.object({
  seq: z.number().int().positive(),
  pid: z.number().int(),
  startTime: z.number().int(),
  comm: z.string(),
  inode: z.number().int(),
  proto: z.enum(["tcp", "udp"]),
  localIp: z.string(),
  localPort: z.number().int(),
  remoteIp: z.string(),
  remotePort: z.number().int(),
  tcpState: z.number().int(),
  localListening: z.boolean(),
  continued: z.boolean(),
  sampledAt: z.number(),
});
export type SocketRow = z.infer<typeof socketRowSchema>;

export const sampleGapSchema = z.object({
  id: z.number().int(),
  start: z.number(),
  end: z.number(),
  reason: z.string(),
});
export type SampleGap = z.infer<typeof sampleGapSchema>;

export const sampleReplySchema = z.object({
  supported: z.literal(true),
  generation: z.string(),
  cursor: z.number().int(),
  gapCursor: z.number().int(),
  reset: z.boolean(),
  more: z.boolean(),
  rows: z.array(socketRowSchema),
  gaps: z.array(sampleGapSchema),
  sampledAt: z.number().nullable(),
  hostNow: z.number(),
  treeSize: z.number().int(),
  unreadablePids: z.number().int(),
  rootPid: z.number().int(),
});
export type SampleReply = Omit<z.infer<typeof sampleReplySchema>, "supported">;

export const hostConnectionsContract = defineRpcContract({
  sample: {
    input: z
      .object({
        generation: z.string().nullable(),
        cursor: z.number().int().nonnegative(),
        gapCursor: z.number().int().nonnegative(),
      })
      .strict(),
    output: z.discriminatedUnion("supported", [
      sampleReplySchema,
      z.object({ supported: z.literal(false), platform: z.string() }),
    ]),
  },
});
