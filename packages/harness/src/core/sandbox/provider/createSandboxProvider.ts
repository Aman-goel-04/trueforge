/**
 * Sandbox provider registry: typed settings (discriminated on `type`) and a
 * factory mapping them onto a {@link SandboxProvider}.
 *
 * Adding a provider = add its settings schema to the union + a case to the
 * switch. The switch is exhaustive: since the function declares a
 * `SandboxProvider` return type, a union member without a matching case makes
 * it no longer return on all paths and fails compilation (TS2366).
 */
import type { Logger } from 'winston';
import { z } from 'zod';
import { SANDBOX_NATS_WS_PORT } from '../constants';
import { DaytonaSandboxProvider } from './DaytonaProvider';
import type { SandboxProvider } from './Provider';

/**
 * Daytona-backed sandboxes. Keys and defaults match the gateway's
 * SANDBOX_SETTINGS JSON (sandboxComposition.ts), plus the `type` discriminator.
 */
export const DaytonaSandboxProviderSettingsSchema = z
  .object({
    type: z.literal('daytona'),
    apiKey: z.string().min(1, 'apiKey is required'),
    snapshotName: z.string().min(1, 'snapshotName is required'),
    timeoutMs: z.number().int().positive().default(60_000),
    autoStopIntervalInMinutes: z.number().int().nonnegative().default(5),
    autoArchiveIntervalInMinutes: z.number().int().nonnegative().default(60),
    autoDeleteIntervalInMinutes: z.number().int().nonnegative().default(43_200),
  })
  .strict();

/** All supported sandbox backends, discriminated on `type`. */
export const SandboxProviderSettingsSchema = z.discriminatedUnion('type', [DaytonaSandboxProviderSettingsSchema]);

export type SandboxProviderSettings = z.infer<typeof SandboxProviderSettingsSchema>;

export interface CreateSandboxProviderInput {
  settings: SandboxProviderSettings;
  /** Namespaces sandbox names and ownership checks. */
  tenantName: string;
  /** Max bytes for a single file download out of the sandbox. */
  fileMaxBytes: number;
  /** Lifetime of signed preview URLs minted for the sandbox NATS bridge. */
  previewUrlExpirySeconds: number;
  logger: Logger;
}

/** Builds the provider for the given settings. Construction is cheap and does no I/O. */
export function createSandboxProvider(input: CreateSandboxProviderInput): SandboxProvider {
  const { settings } = input;
  // Currently only Daytona is registered; switch on settings.type when more backends are added
  // so the return type stays exhaustive (TS2366).
  return new DaytonaSandboxProvider({
    apiKey: settings.apiKey,
    tenantName: input.tenantName,
    settings: {
      snapshotName: settings.snapshotName,
      timeoutMs: settings.timeoutMs,
      autoStopIntervalInMinutes: settings.autoStopIntervalInMinutes,
      autoArchiveIntervalInMinutes: settings.autoArchiveIntervalInMinutes,
      autoDeleteIntervalInMinutes: settings.autoDeleteIntervalInMinutes,
    },
    fileMaxBytes: input.fileMaxBytes,
    natsBridgePort: SANDBOX_NATS_WS_PORT,
    previewUrlExpirySeconds: input.previewUrlExpirySeconds,
    logger: input.logger,
  });
}
