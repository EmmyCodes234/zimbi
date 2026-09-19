import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  canTransition,
  assertValidTransition,
  InvalidStateTransitionError,
  isTerminalStatus,
  PaymentStatus,
} from '../src/payments/stateMachine.js';

describe('ZIMBI Payment State Machine', () => {
  test('allows legal forward transitions from created', () => {
    assert.strictEqual(canTransition('created', 'pending'), true);
    assert.strictEqual(canTransition('created', 'processing'), true);
    assert.strictEqual(canTransition('created', 'cancelled'), true);
    assert.strictEqual(canTransition('created', 'expired'), true);
  });

  test('allows legal transitions from pending', () => {
    assert.strictEqual(canTransition('pending', 'processing'), true);
    assert.strictEqual(canTransition('pending', 'succeeded'), true);
    assert.strictEqual(canTransition('pending', 'failed'), true);
    assert.strictEqual(canTransition('pending', 'cancelled'), true);
    assert.strictEqual(canTransition('pending', 'expired'), true);
  });

  test('allows legal transitions from processing', () => {
    assert.strictEqual(canTransition('processing', 'succeeded'), true);
    assert.strictEqual(canTransition('processing', 'failed'), true);
    assert.strictEqual(canTransition('processing', 'cancelled'), true);
    assert.strictEqual(canTransition('processing', 'expired'), true);
  });

  test('allows only refund transitions from succeeded', () => {
    assert.strictEqual(canTransition('succeeded', 'refunded'), true);
    assert.strictEqual(canTransition('succeeded', 'partially_refunded'), true);
  });

  test('forbids invalid backward transitions from succeeded', () => {
    assert.strictEqual(canTransition('succeeded', 'pending'), false);
    assert.strictEqual(canTransition('succeeded', 'processing'), false);
    assert.strictEqual(canTransition('succeeded', 'failed'), false);
    assert.strictEqual(canTransition('succeeded', 'created'), false);
  });

  test('assertValidTransition throws on forbidden transition', () => {
    assert.throws(
      () => assertValidTransition('succeeded', 'failed'),
      InvalidStateTransitionError
    );

    assert.throws(
      () => assertValidTransition('failed', 'succeeded'),
      InvalidStateTransitionError
    );

    assert.throws(
      () => assertValidTransition('expired', 'pending'),
      InvalidStateTransitionError
    );
  });

  test('identifies terminal statuses correctly', () => {
    assert.strictEqual(isTerminalStatus('failed'), true);
    assert.strictEqual(isTerminalStatus('cancelled'), true);
    assert.strictEqual(isTerminalStatus('expired'), true);
    assert.strictEqual(isTerminalStatus('refunded'), true);

    assert.strictEqual(isTerminalStatus('pending'), false);
    assert.strictEqual(isTerminalStatus('processing'), false);
    assert.strictEqual(isTerminalStatus('succeeded'), false); // succeeded can be refunded
  });

  test('idempotent same-state check is valid', () => {
    assert.strictEqual(canTransition('succeeded', 'succeeded'), true);
    assert.strictEqual(canTransition('pending', 'pending'), true);
  });
});
