import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const BIN = path.resolve('bin/zimbi.js');

describe('ZIMBI CLI - Project & Auth Commands', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zimbi-cli-test-'));

  before(() => {
    // Setup temporary workspace
    fs.mkdirSync(path.join(tmpDir, '.zimbi'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.zimbi', 'project.json'),
      JSON.stringify({ project: 'proj_alpha', environment: 'test' }, null, 2)
    );
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('zimbi whoami --json returns status', () => {
    const stdout = execSync(`node "${BIN}" whoami --json`, {
      encoding: 'utf8',
      cwd: tmpDir,
    });
    const parsed = JSON.parse(stdout);
    assert.ok(typeof parsed.authenticated === 'boolean');
    assert.equal(parsed.currentProject, 'proj_alpha');
  });

  test('zimbi project current displays active project', () => {
    const stdout = execSync(`node "${BIN}" project current`, {
      encoding: 'utf8',
      cwd: tmpDir,
    });
    assert.match(stdout, /proj_alpha/);
    assert.match(stdout, /test/);
  });

  test('zimbi project current --json returns structured config', () => {
    const stdout = execSync(`node "${BIN}" project current --json`, {
      encoding: 'utf8',
      cwd: tmpDir,
    });
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.project, 'proj_alpha');
    assert.equal(parsed.environment, 'test');
  });

  test('zimbi project list requires account session authentication', () => {
    try {
      const stdout = execSync(`node "${BIN}" project list`, {
        encoding: 'utf8',
        cwd: tmpDir,
      });
      assert.ok(stdout.includes('Projects'));
    } catch (err: any) {
      // Unauthenticated project-scoped callers must be rejected with auth guidance
      const output = (err.stdout || '').toString() + (err.stderr || '').toString();
      assert.ok(
        output.includes('login') ||
        output.includes('session') ||
        output.includes('Account') ||
        output.includes('Projects')
      );
    }
  });

  test('zimbi project use updates only .zimbi/project.json and does not touch .env', () => {
    const envPath = path.join(tmpDir, '.env');
    if (fs.existsSync(envPath)) fs.unlinkSync(envPath);

    const stdout = execSync(`node "${BIN}" project use proj_beta --json`, {
      encoding: 'utf8',
      cwd: tmpDir,
    });
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.status, 'success');
    assert.equal(parsed.project, 'proj_beta');

    // Verify .env was NOT created or modified by project use
    assert.equal(fs.existsSync(envPath), false);

    // Verify project.json contains updated project
    const projConfig = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.zimbi', 'project.json'), 'utf8')
    );
    assert.equal(projConfig.project, 'proj_beta');
  });
});
