import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BIN = path.resolve('bin/zimbi.js');

describe('ZIMBI CLI - Init, Market & Env', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zimbi-test-'));
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'acme-test', version: '1.0.0' }, null, 2)
    );
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  test('zimbi init initializes project non-interactively with --yes', () => {
    const stdout = execSync(
      `node "${BIN}" init --project acme-test --market NG --env test --yes`,
      { cwd: tmpDir, encoding: 'utf8' }
    );
    assert.match(stdout, /ZIMBI is connected/);
    assert.match(stdout, /Nigeria/);

    const configPath = path.join(tmpDir, '.zimbi', 'project.json');
    assert.ok(fs.existsSync(configPath));
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.strictEqual(config.project, 'acme-test');
    assert.strictEqual(config.environment, 'test');
  });

  test('zimbi market list lists active and inactive markets', () => {
    const stdout = execSync(`node "${BIN}" market list`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    assert.match(stdout, /Nigeria/);
    assert.match(stdout, /active/);
  });

  test('zimbi market list --json outputs deterministic JSON', () => {
    const stdout = execSync(`node "${BIN}" market list --json`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(stdout);
    assert.ok(Array.isArray(parsed.markets));
    const ng = parsed.markets.find((m: any) => m.country === 'NG');
    assert.ok(ng);
    assert.strictEqual(ng.status, 'active');
  });

  test('zimbi market status NG shows human-readable capabilities', () => {
    const stdout = execSync(`node "${BIN}" market status NG`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    assert.match(stdout, /NIGERIA/);
    assert.match(stdout, /Active/);
    assert.match(stdout, /Currency/);
    assert.match(stdout, /Card/);
    assert.match(stdout, /Bank transfer/);
  });

  test('zimbi env and zimbi env use manages environments', () => {
    const envOut = execSync(`node "${BIN}" env`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    assert.match(envOut, /test\s+active/);

    execSync(`node "${BIN}" env use production --yes`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    const prodConfig = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.zimbi', 'project.json'), 'utf8')
    );
    assert.strictEqual(prodConfig.environment, 'production');

    // Switch back to test
    execSync(`node "${BIN}" env use test --yes`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });
  });
});
