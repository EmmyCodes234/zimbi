import chalk from 'chalk';
import { ZimbiApiClient } from '../core/api-client.js';
import { outputJson } from '../ui/json.js';
import {
  symbols,
  printTitle,
  printSuccess,
  printShortDivider,
  printNextSteps,
} from '../ui/output.js';
import { ExitCodes } from '../core/exit-codes.js';
import type { GlobalOptions } from '../types/index.js';

export async function runDoctorCommand(options: GlobalOptions): Promise<void> {
  const client = new ZimbiApiClient({ verbose: options.verbose });
  const report = await client.runDoctor();

  if (options.json) {
    outputJson(report);
    if (!report.healthy && options.ci) {
      process.exit(ExitCodes.GENERAL_FAILURE);
    }
    return;
  }

  if (options.ci && !report.healthy) {
    console.error('ZIMBI_DOCTOR_FAILED');
    process.exit(ExitCodes.GENERAL_FAILURE);
  }

  printTitle('ZIMBI DOCTOR');

  // Project section
  console.log('Project');
  if (report.projectDetected) {
    console.log(`  ${symbols.check} Project detected`);
  } else {
    console.log(`  ${symbols.cross} Project not detected`);
  }
  if (report.projectLinked) {
    console.log(`  ${symbols.check} Project linked`);
  } else {
    console.log(`  ${symbols.warn} Project not linked`);
  }
  console.log();

  // Environment section
  console.log('Environment');
  const envLabel = report.environment === 'production' ? 'Production environment' : 'Test environment';
  console.log(`  ${symbols.check} ${envLabel}`);
  console.log();

  // Credentials section
  console.log('Credentials');
  if (report.credentialsValid) {
    console.log(`  ${symbols.check} API key`);
  } else {
    console.log(`  ${symbols.cross} API key missing`);
  }
  console.log();

  // Markets section
  console.log('Markets');
  if (report.marketsEnabled.length > 0) {
    for (const m of report.marketsEnabled) {
      console.log(`  ${symbols.check} ${m} enabled`);
    }
  } else {
    console.log(`  ${symbols.warn} No markets enabled`);
  }
  console.log();

  // Provider section
  console.log('Provider');
  if (report.providerConnected) {
    console.log(`  ${symbols.check} Connected`);
  } else {
    console.log(`  ${symbols.cross} Connection failed`);
  }
  console.log();

  // Checkout section
  console.log('Checkout');
  if (report.checkoutValid) {
    console.log(`  ${symbols.check} Configuration valid`);
  } else {
    console.log(`  ${symbols.warn} Incomplete configuration`);
  }
  console.log();

  // Webhooks section
  console.log('Webhooks');
  if (report.webhooksReachable) {
    console.log(`  ${symbols.check} Endpoint reachable`);
    console.log(`  ${symbols.check} Signature verification enabled`);
  } else {
    console.log(`  ${symbols.warn} Cannot verify until provider is connected`);
  }
  console.log();

  printShortDivider();
  console.log();

  if (report.healthy) {
    printSuccess('Everything looks good.');
    printNextSteps(['zimbi payment test']);
  } else {
    const count = report.issues.length;
    console.log(`${count} ${count === 1 ? 'issue' : 'issues'} found.`);
    console.log();

    for (const issue of report.issues) {
      console.log(issue.description);
      console.log();
      if (issue.fixCommand) {
        console.log('Run:');
        console.log();
        console.log(`  ${chalk.cyan(issue.fixCommand)}`);
        console.log();
      }
    }

    if (options.ci) {
      process.exit(ExitCodes.CONFIG_FAILURE);
    }
  }
}
