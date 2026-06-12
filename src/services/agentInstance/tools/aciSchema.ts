import { z } from 'zod/v4';

/**
 * ACI (Agent Computer Interface) protocol version for tools exposed to agents and MCP clients.
 */
export const ACI_VERSION = 1;

export const ACIDomainSchema = z.enum(['kb', 'ui']);
export type ACIDomain = z.infer<typeof ACIDomainSchema>;

export const ACIToolNameSchema = z.enum([
  'kb.search',
  'kb.read',
  'kb.write',
  'kb.delete',
  'kb.run_action',
  'kb.plugin_info',
  'ui.get_state',
  'ui.open_tiddler',
  'ui.close_tiddler',
  'ui.focus_tiddler',
  'ui.set_layout',
  'ui.set_pref',
]);
export type ACIToolName = z.infer<typeof ACIToolNameSchema>;

export const ACIErrorCodeSchema = z.enum([
  'WORKSPACE_NOT_FOUND',
  'WORKSPACE_NOT_ACTIVE',
  'VIEW_NOT_FOUND',
  'TIDDLER_TITLE_REQUIRED',
  'INVALID_ARGUMENT',
  'PREFERENCE_NOT_ALLOWED',
  'UNSUPPORTED_OPERATION',
  'INTERNAL_ERROR',
]);
export type ACIErrorCode = z.infer<typeof ACIErrorCodeSchema>;

export const ACIResultEnvelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  errorCode: ACIErrorCodeSchema.optional(),
  error: z.string().optional(),
});
export type ACIResultEnvelope = z.infer<typeof ACIResultEnvelopeSchema>;

export function successResult(
  data?: unknown,
  metadata?: Record<string, unknown>,
): ACIResultEnvelope {
  return {
    success: true,
    data,
    metadata,
  };
}

export function errorResult(
  errorCode: ACIErrorCode,
  error: string,
  metadata?: Record<string, unknown>,
): ACIResultEnvelope {
  return {
    success: false,
    errorCode,
    error,
    metadata,
  };
}
