import chalk from 'chalk';
import { exec } from 'node:child_process';
import { ZimbiApiClient } from '../core/api-client.js';
import {
  getAccountSession,
  saveAccountSession,
  clearAccountSession,
} from '../core/secure-store.js';
import { readProjectConfig } from '../core/config.js';
import { outputJson } from '../ui/json.js';
import { printTitle, printSuccess, symbols } from '../ui/output.js';
import type { GlobalOptions } from '../types/index.js';

export interface AuthCommandOptions extends GlobalOptions {
  email?: string;
}

function openBrowser(url: string): void {
  const start =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
      ? 'start'
      : 'xdg-open';
  exec(`${start} "${url}"`, () => {});
}

export async function runLoginCommand(options: AuthCommandOptions): Promise<void> {
  const cwd = process.cwd();
  const client = new ZimbiApiClient({ cwd, verbose: options.verbose });

  // 1. Request device authorization
  const deviceAuth = await client.requestDeviceCode({
    cliVersion: '0.1.0',
    platform: process.platform,
    arch: process.arch,
    location: 'CLI Terminal',
  });

  const verificationUrl = `${process.env.ZIMBI_API_URL || 'https://zimbi-api.onrender.com'}/device?code=${deviceAuth.userCode}`;

  if (options.json) {
    outputJson({
      deviceCode: deviceAuth.deviceCode,
      userCode: deviceAuth.userCode,
      verificationUri: verificationUrl,
      expiresIn: deviceAuth.expiresIn,
    });
    return;
  }

  printTitle('ZIMBI');
  console.log('Authenticate this CLI');
  console.log();
  console.log(`Visit: ${chalk.cyan.underline(verificationUrl)}`);
  console.log(`and enter: ${chalk.bold.green(deviceAuth.userCode)}`);
  console.log();
  console.log('Opening your browser...');
  openBrowser(verificationUrl);
  console.log();
  console.log('Waiting for approval...');

  // 2. Poll for token exchange
  const startTime = Date.now();
  const timeoutMs = (deviceAuth.expiresIn || 600) * 1000;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, (deviceAuth.interval || 2) * 1000));

    try {
      const poll = await client.pollDeviceToken(deviceAuth.deviceCode);

      if (poll.status === 'approved' && poll.sessionToken) {
        saveAccountSession({
          accountId: poll.account?.id || 'acc_default',
          email: poll.account?.email || 'developer@zimbi.dev',
          name: poll.account?.name,
          sessionToken: poll.sessionToken,
          createdAt: new Date().toISOString(),
        });

        console.log();
        printSuccess('Authentication complete');
        console.log(`Signed in as ${chalk.bold(poll.account?.email || 'developer')}`);
        console.log();
        console.log('Next:');
        console.log(`  ${chalk.cyan('zimbi project list')}`);
        console.log(`  ${chalk.cyan('zimbi init')}`);
        return;
      }

      if (poll.status === 'expired' || poll.status === 'denied') {
        console.log();
        console.error(chalk.red(`Authorization ${poll.status}: ${poll.error || 'Please run zimbi login again.'}`));
        process.exit(1);
      }
    } catch {
      // Continue polling on transient network hiccup
    }
  }

  console.log();
  console.error(chalk.red('Login timed out. Please run `zimbi login` again.'));
  process.exit(1);
}

export async function runLogoutCommand(options: GlobalOptions): Promise<void> {
  const cwd = process.cwd();
  const client = new ZimbiApiClient({ cwd, verbose: options.verbose });

  try {
    await client.logout();
  } catch {
    // Ignore server error on logout
  }

  clearAccountSession();

  if (options.json) {
    outputJson({ status: 'success', loggedOut: true });
    return;
  }

  printSuccess('Logged out of ZIMBI');
}

export async function runWhoamiCommand(options: GlobalOptions): Promise<void> {
  const cwd = process.cwd();
  const session = getAccountSession();
  const proj = readProjectConfig(cwd);

  if (options.json) {
    outputJson({
      authenticated: Boolean(session),
      account: session ? { id: session.accountId, email: session.email, name: session.name } : null,
      currentProject: proj?.project || null,
      environment: proj?.environment || null,
    });
    return;
  }

  if (!session) {
    console.log('Not logged in. Run `zimbi login` to authenticate.');
    return;
  }

  console.log(session.email);
  if (options.verbose) {
    console.log(`  Account ID : ${session.accountId}`);
    console.log(`  Current Dir: ${proj?.project ? proj.project : 'No project linked'}`);
  }
}
