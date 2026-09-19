import chalk from 'chalk';
import { getGlobalSession, saveGlobalSession, clearGlobalSession } from '../core/auth.js';
import { askInput, askSelect } from '../ui/prompts.js';
import { createSpinner } from '../ui/spinner.js';
import { outputJson } from '../ui/json.js';
import { symbols, printSuccess, printTitle } from '../ui/output.js';
import type { GlobalOptions } from '../types/index.js';
import { readProjectConfig } from '../core/config.js';

export async function runLoginCommand(options: GlobalOptions): Promise<void> {
  const existing = getGlobalSession();

  if (existing && !options.json) {
    console.log();
    console.log(`${symbols.check} Already signed in as ${chalk.bold(existing.email)}`);
    console.log();
    return;
  }

  if (options.json) {
    if (existing) {
      outputJson({ authenticated: true, user: existing });
    } else {
      const mockUser = {
        email: 'developer@example.com',
        userId: 'usr_dev123',
        token: 'zmb_live_key_dev',
        projects: [{ id: 'proj_acme', name: 'acme', createdAt: new Date().toISOString() }],
      };
      saveGlobalSession(mockUser);
      outputJson({ authenticated: true, user: mockUser });
    }
    return;
  }

  printTitle('ZIMBI');
  console.log("You'll need a ZIMBI account to continue.");
  console.log();

  const method = await askSelect(
    'Choose authentication method',
    [
      { name: 'Log in with browser', value: 'browser' },
      { name: 'Use an API key', value: 'apikey' },
      { name: 'Create account', value: 'create' },
    ],
    options
  );

  let email = 'emmy@example.com';
  let token = 'zmb_test_token_8829';

  if (method === 'apikey') {
    const key = await askInput('Enter your ZIMBI API key: ', undefined, options);
    token = key || 'zmb_test_custom_key';
    email = 'api-user@example.com';
  } else if (method === 'create') {
    email = await askInput('Enter your email address: ', 'emmy@example.com', options);
    console.log();
    console.log('Opening your browser to complete registration...');
  } else {
    console.log('Opening your browser...');
    console.log();
    console.log('Waiting for authentication.');
  }

  const spinner = createSpinner('Authenticating...');
  spinner.start();

  // Simulate authentication wait
  await new Promise((resolve) => setTimeout(resolve, 800));
  spinner.stop();

  const session = {
    email,
    userId: 'usr_' + Math.random().toString(36).substring(2, 9),
    token,
    projects: [
      { id: 'proj_acme', name: 'acme', createdAt: new Date().toISOString() },
      { id: 'proj_acme_staging', name: 'acme-staging', createdAt: new Date().toISOString() },
    ],
  };

  saveGlobalSession(session);

  console.log();
  printSuccess(`Signed in as ${chalk.bold(email)}`);
  console.log();
}

export function runLogoutCommand(options: GlobalOptions): void {
  clearGlobalSession();

  if (options.json) {
    outputJson({ signedOut: true });
    return;
  }

  console.log();
  printSuccess('Signed out of ZIMBI.');
  console.log();
}

export function runWhoamiCommand(options: GlobalOptions): void {
  const session = getGlobalSession();
  const proj = readProjectConfig();

  if (options.json) {
    if (!session) {
      outputJson({ authenticated: false });
    } else {
      outputJson({
        authenticated: true,
        user: session,
        project: proj,
      });
    }
    return;
  }

  console.log();
  if (!session) {
    console.log('Not signed in.');
    console.log();
    console.log(`Run ${chalk.cyan('zimbi login')} to authenticate.`);
  } else {
    console.log(chalk.bold('ZIMBI ACCOUNT'));
    console.log();
    console.log(`  User:    ${chalk.bold(session.email)}`);
    console.log(`  ID:      ${session.userId}`);
    if (proj) {
      console.log(`  Project: ${proj.project} (${proj.environment})`);
    }
  }
  console.log();
}
