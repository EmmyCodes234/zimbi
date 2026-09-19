/**
 * ZIMBI Payment State Machine
 *
 * Enforces explicit, unidirectional, and deterministic lifecycle transitions
 * across all payment methods and providers.
 */

export type PaymentStatus =
  | 'created'
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'partially_refunded';

export const ALL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'created',
  'pending',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded',
] as const;

/**
 * Valid state transition matrix.
 * Any transition not explicitly listed is forbidden.
 */
export const VALID_STATE_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  // Initial state before checkout / authorization is initiated
  created: ['pending', 'processing', 'cancelled', 'expired'],

  // Customer has been directed to checkout / payment initiated
  pending: ['processing', 'succeeded', 'failed', 'cancelled', 'expired'],

  // Asynchronous processing (e.g. 3DS authentication, bank transfer settlement)
  processing: ['succeeded', 'failed', 'cancelled', 'expired'],

  // Terminal success state for the primary charge (only refundable)
  succeeded: ['refunded', 'partially_refunded'],

  // Partially refunded charge can be further refunded
  partially_refunded: ['refunded', 'partially_refunded'],

  // Terminal states (no transitions allowed)
  failed: [],
  cancelled: [],
  expired: [],
  refunded: [],
};

export class InvalidStateTransitionError extends Error {
  public readonly fromStatus: PaymentStatus;
  public readonly toStatus: PaymentStatus;

  constructor(fromStatus: PaymentStatus, toStatus: PaymentStatus, reason?: string) {
    super(
      `Invalid payment state transition from '${fromStatus}' to '${toStatus}'${
        reason ? `: ${reason}` : ''
      }`
    );
    this.name = 'InvalidStateTransitionError';
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

/**
 * Checks if a transition between two states is valid.
 */
export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return true; // Idempotent no-op
  const allowed = VALID_STATE_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Validates and asserts that a transition is allowed.
 * Throws InvalidStateTransitionError if the transition is illegal.
 */
export function assertValidTransition(
  from: PaymentStatus,
  to: PaymentStatus,
  context?: string
): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(
      from,
      to,
      context || `State '${from}' cannot transition to '${to}'`
    );
  }
}

/**
 * Returns true if the status represents a final terminal state.
 */
export function isTerminalStatus(status: PaymentStatus): boolean {
  return VALID_STATE_TRANSITIONS[status].length === 0;
}
