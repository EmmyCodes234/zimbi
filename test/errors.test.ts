import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BIN = path.resolve('bin/zimbi.js');

describe('ZIMBI CLI - Exit Codes and Error Handling', () => {
  let emptyTmpDir: string;

  before(() => {
    emptyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zimbi-error-test-'));
  });

  after(() => {
    try {
      fs.rmSync(emptyTmpDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  test('zimbi doctor in unconfigured directory reports issues and next steps', () => {
    const stdout = execSync(`node "${BIN}" doctor`, {
      cwd: emptyTmpDir,
      encoding: 'utf8',
    });
    assert.match(stdout, /ZIMBI DOCTOR/);
    assert.match(stdout, /Project not linked/);
    assert.match(stdout, /zimbi init/);
  });

  test('zimbi doctor --ci in unconfigured directory exits non-zero', () => {
    let failed = false;
    try {
      execSync(`node "${BIN}" doctor --ci`, {
        cwd: emptyTmpDir,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err: any) {
      failed = true;
      assert.notStrictEqual(err.status, 0);
      const output = (err.stderr || '').toString() + (err.stdout || '').toString();
      assert.ok(output.includes('ZIMBI_DOCTOR_FAILED') || output.includes('Project not linked') || output.includes('issue'));
    }
    assert.strictEqual(failed, true, 'doctor --ci should exit non-zero on failure');
  });

  test('invalid market code throws precise technical error with fix', () => {
    let failed = false;
    try {
      execSync(`node "${BIN}" market add INVALID_CODE --yes`, {
        cwd: emptyTmpDir,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err: any) {
      failed = true;
      assert.notStrictEqual(err.status, 0);
      const output = (err.stdout || '').toString() + (err.stderr || '').toString();
      assert.match(output, /Fix:/);
    }
    assert.strictEqual(failed, true, 'invalid market should fail with guidance');
  });
});
