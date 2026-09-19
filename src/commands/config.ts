import chalk from 'chalk';
import { readProjectConfig, getProjectConfigPath } from '../core/config.js';
import { outputJson } from '../ui/json.js';
import { printTitle } from '../ui/output.js';
import type { GlobalOptions } from '../types/index.js';

export function runConfigCommand(options: GlobalOptions): void {
  const proj = readProjectConfig();
  const configPath = getProjectConfigPath();

  if (options.json) {
    outputJson({
      path: configPath,
      exists: Boolean(proj),
      config: proj,
    });
    return;
  }

  printTitle('ZIMBI CONFIGURATION');

  if (!proj) {
    console.log('No local configuration found.');
    console.log();
    console.log(`Run ${chalk.cyan('zimbi init')} to connect this project.`);
    console.log();
    return;
  }

  console.log(chalk.bold('Project'));
  console.log(`  ${proj.project}`);
  console.log();

  console.log(chalk.bold('Environment'));
  console.log(`  ${proj.environment}`);
  console.log();

  if (proj.markets && proj.markets.length > 0) {
    console.log(chalk.bold('Markets'));
    for (const m of proj.markets) {
      console.log(`  ${m}`);
    }
    console.log();
  }

  if (proj.providers) {
    console.log(chalk.bold('Providers'));
    for (const [pId, pData] of Object.entries(proj.providers)) {
      console.log(`  ${pId}: ${pData.connected ? 'connected' : 'disconnected'}`);
    }
    console.log();
  }

  console.log(chalk.dim(`Config file: ${configPath}`));
  console.log();
}
