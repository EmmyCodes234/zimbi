import { test, describe } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import path from 'node:path';

const BIN = path.resolve('bin/zimbi.js');

describe('ZIMBI CLI - Core & Help', () => {
  test('zimbi --version outputs 0.1.0', () => {
    const stdout = execSync(`node "${BIN}" --version`, { encoding: 'utf8' });
    assert.match(stdout, /zimbi 0\.1\.0/);
  });

  test('zimbi bare command prints landing overview', () => {
    const stdout = execSync(`node "${BIN}"`, { encoding: 'utf8' });
    assert.match(stdout, /Global payments infrastructure/);
    assert.match(stdout, /zimbi init/);
    assert.match(stdout, /zimbi market add NG/);
    assert.match(stdout, /zimbi doctor/);
  });

  test('zimbi --json outputs valid JSON overview', () => {
    const stdout = execSync(`node "${BIN}" --json`, { encoding: 'utf8' });
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.name, 'zimbi');
    assert.strictEqual(parsed.version, '0.1.0');
    assert.ok(parsed.sections);
  });

  test('zimbi whoami outputs unauthenticated or active user', () => {
    const stdout = execSync(`node "${BIN}" whoami`, { encoding: 'utf8' });
    assert.ok(stdout.length > 0);
  });
});
