import { Command } from 'commander';
import { runRootCommand } from './commands/root.js';
import { runInitCommand } from './commands/init.js';
import { runLoginCommand, runLogoutCommand, runWhoamiCommand } from './commands/auth.js';
import {
  runProjectListCommand,
  runProjectCurrentCommand,
  runProjectUseCommand,
  runProjectCreateCommand,
} from './commands/project.js';
import {
  runMarketList,
  runMarketAdd,
  runMarketRemove,
  runMarketStatus,
} from './commands/market.js';
import {
  runProviderList,
  runProviderConnect,
  runProviderDisconnect,
  runProviderStatus,
} from './commands/provider.js';
import { runDoctorCommand } from './commands/doctor.js';
import { runPaymentTest, runPaymentInspect, runPaymentReconcile } from './commands/payment.js';
import { runWebhookListen, runWebhookTest } from './commands/webhook.js';
import { runEnvList, runEnvUse } from './commands/env.js';
import { runConfigCommand } from './commands/config.js';
import { ZimbiError } from './core/errors.js';
import { ExitCodes } from './core/exit-codes.js';
import { formatErrorDisplay } from './ui/output.js';
import { outputJson } from './ui/json.js';
import type { GlobalOptions } from './types/index.js';

const program = new Command();

program
  .name('zimbi')
  .description('Global payments infrastructure. Soft outside. Powerful inside.')
  .version('zimbi 0.1.0', '-v, --version', 'Output the version number')
  .option('--json', 'Output results as deterministic JSON')
  .option('--verbose', 'Show detailed network requests, IDs, and timings')
  .option('--yes', 'Non-interactive mode; accept default prompts')
  .option('--ci', 'CI mode; exit non-zero on warnings or failures');

function getGlobalOpts(): GlobalOptions {
  return program.opts<GlobalOptions>();
}

// Bare command overview
program.action(() => {
  runRootCommand(getGlobalOpts());
});

// Init command
program
  .command('init')
  .description('Connect ZIMBI to a project')
  .option('--project <name>', 'Project name')
  .option('--market <country>', 'Primary market code (e.g. NG)')
  .option('--env <environment>', 'Environment (test or production)')
  .action(async (cmdOpts) => {
    const opts = { ...getGlobalOpts(), ...cmdOpts };
    await runInitCommand(opts);
  });

// Login, logout, whoami
program
  .command('login')
  .description('Authenticate with your ZIMBI account')
  .action(async () => {
    await runLoginCommand(getGlobalOpts());
  });

program
  .command('logout')
  .description('Sign out of your ZIMBI account')
  .action(() => {
    runLogoutCommand(getGlobalOpts());
  });

program
  .command('whoami')
  .description('View active user session and project')
  .action(() => {
    runWhoamiCommand(getGlobalOpts());
  });

// Project commands
const projectCmd = program.command('project').description('Manage ZIMBI projects in your account');

projectCmd
  .command('list')
  .description('List projects in your account')
  .action(async () => {
    await runProjectListCommand(getGlobalOpts());
  });

projectCmd
  .command('current')
  .description('Display the active project in this directory')
  .action(async () => {
    await runProjectCurrentCommand(getGlobalOpts());
  });

projectCmd
  .command('use <projectId>')
  .description('Switch this directory to a project in your account')
  .option('--env <environment>', 'Environment (test or production)')
  .action(async (projectId, cmdOpts) => {
    await runProjectUseCommand(projectId, { ...getGlobalOpts(), ...cmdOpts });
  });

projectCmd
  .command('create <name>')
  .description('Create a new project in your account')
  .option('--env <environment>', 'Environment (test or production)')
  .action(async (name, cmdOpts) => {
    await runProjectCreateCommand(name, { ...getGlobalOpts(), ...cmdOpts });
  });

// Market commands
const marketCmd = program.command('market').description('Manage payment markets');

marketCmd
  .command('list')
  .description('List active and available payment markets')
  .action(async () => {
    await runMarketList(getGlobalOpts());
  });

marketCmd
  .command('add <country>')
  .description('Enable a payment market (e.g. NG)')
  .action(async (country) => {
    await runMarketAdd(country, getGlobalOpts());
  });

marketCmd
  .command('remove <country>')
  .description('Disable an active payment market')
  .action(async (country) => {
    await runMarketRemove(country, getGlobalOpts());
  });

marketCmd
  .command('status <country>')
  .description('Show market capabilities and readiness')
  .action(async (country) => {
    await runMarketStatus(country, getGlobalOpts());
  });

// Provider commands
const providerCmd = program.command('provider').description('Manage payment providers');

providerCmd
  .command('list')
  .description('List supported payment providers')
  .action(async () => {
    await runProviderList(getGlobalOpts());
  });

providerCmd
  .command('connect [provider]')
  .description('Connect a provider account (e.g. paystack)')
  .option('--stdin', 'Read secret key from standard input')
  .action(async (provider, cmdOpts) => {
    await runProviderConnect(provider, { ...getGlobalOpts(), ...cmdOpts });
  });

providerCmd
  .command('disconnect <provider>')
  .description('Disconnect a payment provider')
  .action(async (provider) => {
    await runProviderDisconnect(provider, getGlobalOpts());
  });

providerCmd
  .command('status [provider]')
  .description('Check provider connection health and capabilities')
  .action(async (provider) => {
    await runProviderStatus(provider, getGlobalOpts());
  });

// Doctor command
program
  .command('doctor')
  .description('Check project setup, credentials, providers, and webhooks')
  .action(async () => {
    await runDoctorCommand(getGlobalOpts());
  });

// Payment commands
const paymentCmd = program.command('payment').description('Create and inspect payments');

paymentCmd
  .command('test')
  .description('Create a test payment and generate checkout URL')
  .option('--market <country>', 'Market code (e.g. NG)')
  .option('--amount <number>', 'Amount in minor or major currency units')
  .option('--method <method>', 'Payment method (e.g. "Bank transfer", "Card")')
  .action(async (cmdOpts) => {
    await runPaymentTest({ ...getGlobalOpts(), ...cmdOpts });
  });

paymentCmd
  .command('inspect <id>')
  .description('Inspect payment status, routing, and provider details')
  .action(async (id) => {
    await runPaymentInspect(id, getGlobalOpts());
  });

paymentCmd
  .command('reconcile <id>')
  .description('Reconcile payment status with provider verification')
  .action(async (id) => {
    await runPaymentReconcile(id, getGlobalOpts());
  });

// Webhook commands
const webhookCmd = program.command('webhook').description('Manage and test webhooks');

webhookCmd
  .command('listen')
  .description('Forward webhook events to a local endpoint for development')
  .option('--port <port>', 'Local port to listen on', '4242')
  .action(async (cmdOpts) => {
    await runWebhookListen({ ...getGlobalOpts(), ...cmdOpts });
  });

webhookCmd
  .command('test')
  .description('Send a test webhook event and verify delivery')
  .option('--endpoint <url>', 'Webhook endpoint URL')
  .option('--event <name>', 'Webhook event name', 'payment.succeeded')
  .action(async (cmdOpts) => {
    await runWebhookTest({ ...getGlobalOpts(), ...cmdOpts });
  });

// Env commands
const envCmd = program.command('env').description('Manage active environment');

envCmd.action(() => {
  runEnvList(getGlobalOpts());
});

envCmd
  .command('use <environment>')
  .description('Switch between test and production environment')
  .action(async (env) => {
    await runEnvUse(env, getGlobalOpts());
  });

// Config command
program
  .command('config')
  .description('View local ZIMBI project configuration')
  .action(() => {
    runConfigCommand(getGlobalOpts());
  });

// Global error handler
async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err: unknown) {
    const opts = getGlobalOpts();
    if (err instanceof ZimbiError) {
      if (opts.json) {
        outputJson({
          error: {
            message: err.message,
            reason: err.reason,
            fix: err.fix,
            requestId: err.requestId,
            code: err.exitCode,
          },
        });
      } else {
        formatErrorDisplay({
          message: err.message,
          reason: err.reason,
          fix: err.fix,
          requestId: err.requestId,
          technicalDetails: err.technicalDetails,
          verbose: opts.verbose,
        });
      }
      process.exit(err.exitCode);
    }

    // Unhandled exception
    const error = err as Error;
    if (opts.json) {
      outputJson({
        error: {
          message: error.message || 'An unexpected error occurred.',
          code: ExitCodes.GENERAL_FAILURE,
        },
      });
    } else {
      console.error();
      console.error(`✕ ${error.message || 'An unexpected error occurred.'}`);
      if (opts.verbose && error.stack) {
        console.error();
        console.error(error.stack);
      }
      console.error();
    }
    process.exit(ExitCodes.GENERAL_FAILURE);
  }
}

main();
