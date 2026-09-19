import { ExitCodes, type ExitCode } from './exit-codes.js';

export interface ZimbiErrorOptions {
  message: string;
  reason?: string;
  fix?: string;
  exitCode?: ExitCode;
  requestId?: string;
  technicalDetails?: string;
  httpStatus?: number;
  durationMs?: number;
}

export class ZimbiError extends Error {
  public readonly reason?: string;
  public readonly fix?: string;
  public readonly exitCode: ExitCode;
  public readonly requestId?: string;
  public readonly technicalDetails?: string;
  public readonly httpStatus?: number;
  public readonly durationMs?: number;

  constructor(options: ZimbiErrorOptions) {
    super(options.message);
    this.name = 'ZimbiError';
    this.reason = options.reason;
    this.fix = options.fix;
    this.exitCode = options.exitCode ?? ExitCodes.GENERAL_FAILURE;
    this.requestId = options.requestId;
    this.technicalDetails = options.technicalDetails;
    this.httpStatus = options.httpStatus;
    this.durationMs = options.durationMs;
  }
}

export function generateRequestId(): string {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghjkmnpqrstvwxyz';
  let rand = '';
  for (let i = 0; i < 12; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `req_01K${rand}`;
}
