import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BIN = path.resolve('bin/zimbi.js');

describe('ZIMBI CLI - Provider, Doctor & Payments', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zimbi-doctor-test-'));
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'payment-test-app', version: '1.0.0' }, null, 2)
    );
    // Initialize project
    execSync(
      `node "${BIN}" init --project payment-test-app --market NG --env test --yes`,
      { cwd: tmpDir, encoding: 'utf8' }
    );
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  test('zimbi provider list and status show connected provider', () => {
    const listOut = execSync(`node "${BIN}" provider list`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    assert.match(listOut, /Paystack/);

    const statusOut = execSync(`node "${BIN}" provider status paystack`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    assert.match(statusOut, /Healthy/);
    assert.match(statusOut, /Card/);
  });

  test('zimbi doctor passes on healthy initialized project', () => {
    const docOut = execSync(`node "${BIN}" doctor`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    assert.match(docOut, /ZIMBI DOCTOR/);
    assert.match(docOut, /Everything looks good/);
  });

  test('zimbi doctor --json returns complete diagnostic schema', () => {
    const docJson = execSync(`node "${BIN}" doctor --json`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(docJson);
    assert.strictEqual(parsed.healthy, true);
    assert.strictEqual(parsed.projectLinked, true);
    assert.strictEqual(parsed.environment, 'test');
  });

  test('zimbi payment test creates test payment with checkout URL', () => {
    const payOut = execSync(
      `node "${BIN}" payment test --market NG --amount 20000 --method "Bank transfer" --yes`,
      { cwd: tmpDir, encoding: 'utf8' }
    );
    assert.match(payOut, /Payment created/);
    assert.match(payOut, /pay_test_/);
    assert.match(payOut, /₦20,000/);
    assert.match(payOut, /checkout\.(paystack|test\.zimbi)\.com/);
  });

  test('zimbi payment inspect reveals status and verbose routing', () => {
    const payJson = execSync(
      `node "${BIN}" payment test --market NG --amount 25000 --json`,
      { cwd: tmpDir, encoding: 'utf8' }
    );
    const parsed = JSON.parse(payJson);
    assert.ok(parsed.id);

    const inspectOut = execSync(
      `node "${BIN}" payment inspect ${parsed.id} --verbose`,
      { cwd: tmpDir, encoding: 'utf8' }
    );
    assert.match(inspectOut, /PAYMENT/);
    assert.match(inspectOut, new RegExp(parsed.id));
    assert.match(inspectOut, /Routing decision/);
    assert.match(inspectOut, /Provider transaction ID/);
  });

  test('zimbi payment reconcile verifies and synchronizes payment state', () => {
    const payJson = execSync(
      `node "${BIN}" payment test --market NG --amount 30000 --json`,
      { cwd: tmpDir, encoding: 'utf8' }
    );
    const parsed = JSON.parse(payJson);
    assert.ok(parsed.id);

    const recOut = execSync(
      `node "${BIN}" payment reconcile ${parsed.id}`,
      { cwd: tmpDir, encoding: 'utf8' }
    );
    assert.match(recOut, /RECONCILE PAYMENT/);
    assert.match(recOut, /Provider/);
    assert.match(recOut, /Local status/);
    assert.match(recOut, /Provider status/);
  });

  test('zimbi webhook test reports delivery health', () => {
    const hookOut = execSync(`node "${BIN}" webhook test`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    assert.match(hookOut, /WEBHOOK TEST/);
    assert.match(hookOut, /Response 200/);
    assert.match(hookOut, /Webhook is healthy/);
  });
});
