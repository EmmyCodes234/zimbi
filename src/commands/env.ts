import chalk from 'chalk';
import { readProjectConfig, updateProjectConfig } from '../core/config.js';
import { askConfirm } from '../ui/prompts.js';
import { outputJson } from '../ui/json.js';
import { symbols, printTitle, printSuccess } from '../ui/output.js';
import type { EnvironmentMode, GlobalOptions } from '../types/index.js';
import { ZimbiError } from '../core/errors.js';
import { ExitCodes } from '../core/exit-codes.js';

export function runEnvList(options: GlobalOptions): void {
  const proj = readProjectConfig();
  const currentEnv = proj?.environment || 'test';

  if (options.json) {
    outputJson({
      active: currentEnv,
      environments: [
        { name: 'test', status: currentEnv === 'test' ? 'active' : 'available' },
        { name: 'production', status: currentEnv === 'production' ? 'active' : 'available' },
      ],
    });
    return;
  }

  printTitle('ENVIRONMENTS');

  const testStatus = currentEnv === 'test' ? chalk.green('active') : chalk.dim('available');
  const prodStatus = currentEnv === 'production' ? chalk.green('active') : chalk.dim('available');

  console.log(`  ${'test'.padEnd(14)} ${testStatus}`);
  console.log(`  ${'production'.padEnd(14)} ${prodStatus}`);
  console.log();
}

export async function runEnvUse(targetEnv: string, options: GlobalOptions): Promise<void> {
  const normalized = targetEnv.toLowerCase() as EnvironmentMode;

  if (normalized !== 'test' && normalized !== 'production') {
    throw new ZimbiError({
      message: `Invalid environment '${targetEnv}'.`,
      reason: "ZIMBI environments can only be 'test' or 'production'.",
      fix: 'Run: zimbi env use test or zimbi env use production',
      exitCode: ExitCodes.INVALID_USAGE,
    });
  }

  const proj = readProjectConfig();
  const current = proj?.environment || 'test';

  if (current === normalized) {
    if (options.json) {
      outputJson({ environment: normalized, unchanged: true });
      return;
    }
    console.log();
    console.log(`Already using ${chalk.bold(normalized)} environment.`);
    console.log();
    return;
  }

  if (normalized === 'production') {
    if (!options.yes && !options.json) {
      console.log();
      console.log("You're switching to production.");
      console.log();
      console.log('Payments created here can move real money.');
      console.log();

      const confirmed = await askConfirm('Continue?', false, options);
      if (!confirmed) {
        console.log('Cancelled switch to production.');
        return;
      }
    }
  }

  updateProjectConfig({ environment: normalized });

  if (options.json) {
    outputJson({
      environment: normalized,
      previousEnvironment: current,
      switched: true,
    });
    return;
  }

  console.log();
  printSuccess(`Switched to ${chalk.bold(normalized)} environment.`);
  console.log();
}
