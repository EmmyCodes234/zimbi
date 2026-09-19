import chalk from 'chalk';
import type { GlobalOptions } from '../types/index.js';
import { outputJson } from '../ui/json.js';

export function runRootCommand(options: GlobalOptions): void {
  if (options.json) {
    outputJson({
      name: 'zimbi',
      version: '0.1.0',
      description: 'Global payments infrastructure.',
      sections: {
        gettingStarted: [
          { command: 'zimbi init', description: 'Connect ZIMBI to a project' },
          { command: 'zimbi market add NG', description: 'Enable a payment market' },
          { command: 'zimbi doctor', description: 'Check your setup' },
        ],
        payments: [
          { command: 'zimbi payment test', description: 'Create a test payment' },
          { command: 'zimbi payment inspect', description: 'Inspect a payment' },
        ],
        configuration: [
          { command: 'zimbi env', description: 'Manage environments' },
          { command: 'zimbi config', description: 'View local configuration' },
        ],
      },
    });
    return;
  }

  console.log();
  console.log(chalk.bold('ZIMBI'));
  console.log();
  console.log('Global payments infrastructure.');
  console.log();
  console.log(chalk.bold('Usage:'));
  console.log('  zimbi <command>');
  console.log();
  console.log(chalk.bold('Getting started:'));
  console.log(`  ${chalk.cyan('zimbi init'.padEnd(23))} Connect ZIMBI to a project`);
  console.log(`  ${chalk.cyan('zimbi market add NG'.padEnd(23))} Enable a payment market`);
  console.log(`  ${chalk.cyan('zimbi doctor'.padEnd(23))} Check your setup`);
  console.log();
  console.log(chalk.bold('Payments:'));
  console.log(`  ${chalk.cyan('zimbi payment test'.padEnd(23))} Create a test payment`);
  console.log(`  ${chalk.cyan('zimbi payment inspect'.padEnd(23))} Inspect a payment`);
  console.log();
  console.log(chalk.bold('Configuration:'));
  console.log(`  ${chalk.cyan('zimbi env'.padEnd(23))} Manage environments`);
  console.log(`  ${chalk.cyan('zimbi config'.padEnd(23))} View local configuration`);
  console.log();
  console.log(`Run ${chalk.cyan('`zimbi --help`')} for all commands.`);
  console.log();
}
