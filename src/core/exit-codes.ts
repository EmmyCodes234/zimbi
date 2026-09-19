/**
 * Standard ZIMBI CLI exit codes according to Section 31 of DX specification.
 *
 * 0   success
 * 1   general failure
 * 2   invalid CLI usage
 * 3   authentication failure
 * 4   configuration failure
 * 5   provider failure
 * 6   network failure
 */
export const ExitCodes = {
  SUCCESS: 0,
  GENERAL_FAILURE: 1,
  INVALID_USAGE: 2,
  AUTH_FAILURE: 3,
  CONFIG_FAILURE: 4,
  PROVIDER_FAILURE: 5,
  NETWORK_FAILURE: 6,
} as const;

export type ExitCode = typeof ExitCodes[keyof typeof ExitCodes];
