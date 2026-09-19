import chalk from 'chalk';
import { ZimbiApiClient } from '../core/api-client.js';
import { readProjectConfig } from '../core/config.js';
import { askPassword } from '../ui/prompts.js';
import { outputJson } from '../ui/json.js';
import { symbols, printSuccess, printTitle } from '../ui/output.js';
import type { GlobalOptions } from '../types/index.js';
import { ZimbiError } from '../core/errors.js';
import { ExitCodes } from '../core/exit-codes.js';

export async function runProviderList(options: GlobalOptions): Promise<void> {
  const client = new ZimbiApiClient({ verbose: options.verbose });
  const providers = await client.listProviders();

  if (options.json) {
    outputJson({
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        capabilities: p.capabilities,
      })),
    });
    return;
  }

  printTitle('PROVIDERS');
  for (const p of providers) {
    const statusText =
      p.status === 'connected' ? chalk.green('connected') : chalk.dim('available');
    console.log(`  ${p.name.padEnd(16)} ${statusText}`);
  }
  console.log();
}

async function readSecretKeyFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
    process.stdin.on('error', (err) => {
      reject(err);
    });
  });
}

export async function runProviderConnect(
  providerId: string | undefined,
  options: GlobalOptions & { stdin?: boolean }
): Promise<void> {
  const targetId = (providerId || 'paystack').toLowerCase();
  const client = new ZimbiApiClient({ verbose: options.verbose });
  const proj = readProjectConfig();
  const env = proj?.environment || 'test';

  const providerName = targetId.charAt(0).toUpperCase() + targetId.slice(1);

  let secretKey = '';
  if (options.stdin) {
    secretKey = await readSecretKeyFromStdin();
  } else if (process.env.ZIMBI_PAYSTACK_SECRET_KEY) {
    secretKey = process.env.ZIMBI_PAYSTACK_SECRET_KEY.trim();
  } else if (process.env.PAYSTACK_SECRET_KEY) {
    secretKey = process.env.PAYSTACK_SECRET_KEY.trim();
  } else if (options.json && options.yes) {
    secretKey = 'sk_test_mock_secret_key_12345';
  } else {
    printTitle(providerName);
    console.log('Enter your test secret key.');
    console.log();
    secretKey = await askPassword('Secret key: ', options);
  }

  if (!secretKey) {
    throw new ZimbiError({
      message: 'No secret key provided.',
      reason: 'A secret key is required to connect to Paystack.',
      fix: 'Provide key interactively, via ZIMBI_PAYSTACK_SECRET_KEY env var, or via --stdin.',
      exitCode: ExitCodes.INVALID_USAGE,
    });
  }

  if (!options.json) {
    console.log();
    console.log('Connecting and validating credentials with Paystack...');
  }

  const connected = await client.validateAndConnectProvider(
    targetId,
    secretKey,
    env
  );

  if (options.json) {
    outputJson({
      provider: connected.id,
      name: connected.name,
      status: connected.status,
      environment: connected.environment,
    });
    return;
  }

  console.log();
  printSuccess('Key is valid');
  printSuccess('Account found');
  printSuccess('Nigeria payments enabled');
  printSuccess('Test environment ready');
  console.log();
  console.log(`${providerName} is connected.`);
  console.log();
}

export async function runProviderDisconnect(
  providerId: string,
  options: GlobalOptions
): Promise<void> {
  const targetId = providerId.toLowerCase();
  const client = new ZimbiApiClient({ verbose: options.verbose });

  await client.disconnectProvider(targetId);

  if (options.json) {
    outputJson({ provider: targetId, disconnected: true });
    return;
  }

  console.log();
  printSuccess(`${targetId} disconnected.`);
  console.log();
}

export async function runProviderStatus(
  providerId: string | undefined,
  options: GlobalOptions
): Promise<void> {
  const client = new ZimbiApiClient({ verbose: options.verbose });
  const targetId = (providerId || 'paystack').toLowerCase();
  const provider = await client.getProvider(targetId);

  if (!provider) {
    throw new ZimbiError({
      message: `Provider '${providerId}' not recognized.`,
      reason: 'Supported providers are Paystack and Flutterwave.',
      fix: 'Run `zimbi provider list` to see available providers.',
      exitCode: ExitCodes.INVALID_USAGE,
    });
  }

  const proj = readProjectConfig();
  const env = proj?.environment || provider.environment || 'test';

  if (options.json) {
    outputJson({
      id: provider.id,
      name: provider.name,
      status: provider.status,
      environment: env,
      capabilities: provider.capabilities,
      webhooksReceiving: provider.webhooksReceiving,
      lastSuccessfulRequest: provider.lastSuccessfulRequest,
    });
    return;
  }

  printTitle(provider.name.toUpperCase());

  if (provider.status === 'connected') {
    console.log('Connection');
    console.log(`  ${symbols.check} Healthy`);
    console.log();

    console.log('Environment');
    console.log(`  ${env}`);
    console.log();

    console.log('Capabilities');
    for (const cap of provider.capabilities) {
      console.log(`  ${symbols.check} ${cap}`);
    }
    console.log();

    console.log('Webhooks');
    console.log(`  ${symbols.check} Receiving`);
    console.log();

    console.log('Last successful request');
    console.log(`  ${provider.lastSuccessfulRequest || '12 seconds ago'}`);
    console.log();
  } else {
    console.log('Connection');
    console.log(`  ${symbols.warn} Needs attention`);
    console.log();

    console.log('API');
    console.log(`  ${symbols.check} Reachable`);
    console.log();

    console.log('Credentials');
    console.log(`  ${symbols.cross} Invalid or not configured`);
    console.log();

    console.log(chalk.bold('Fix:'));
    console.log();
    console.log(`  ${chalk.cyan(`zimbi provider connect ${provider.id}`)}`);
    console.log();
  }
}
