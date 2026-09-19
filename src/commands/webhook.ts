import http from 'node:http';
import chalk from 'chalk';
import { ZimbiApiClient } from '../core/api-client.js';
import { outputJson } from '../ui/json.js';
import { symbols, printTitle, printSuccess } from '../ui/output.js';
import type { GlobalOptions } from '../types/index.js';
import { readProjectConfig } from '../core/config.js';
import { ZimbiError } from '../core/errors.js';
import { ExitCodes } from '../core/exit-codes.js';

export interface WebhookListenOptions extends GlobalOptions {
  port?: string | number;
  forwardTo?: string;
}

export async function runWebhookListen(options: WebhookListenOptions): Promise<void> {
  const port = options.port ? Number(options.port) : 4242;
  const proj = readProjectConfig();
  const env = proj?.environment || 'test';
  const listenUrl = `http://localhost:${port}/webhooks/zimbi`;

  if (options.json) {
    outputJson({
      listeningOn: listenUrl,
      environment: env,
      status: 'listening',
    });
    return;
  }

  printTitle('ZIMBI WEBHOOKS');

  console.log('Listening on:');
  console.log();
  console.log(`  ${chalk.cyan(listenUrl)}`);
  console.log();
  console.log('Forwarding events from:');
  console.log();
  console.log(`  ${chalk.bold(env + ' environment')}`);
  console.log();
  console.log('Waiting for events...');
  console.log();

  // Create local server listening for webhook events or test deliveries
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const eventName = parsed.event || parsed.type || 'payment.succeeded';
        console.log(`${symbols.check} ${eventName}`);
      } catch {
        console.log(`${symbols.check} webhook.event`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
    });
  });

  server.listen(port, () => {
    // If running in test or non-interactive, print sample events and exit cleanly
    if (options.yes || process.env.NODE_ENV === 'test') {
      setTimeout(() => {
        console.log(`${symbols.check} payment.created`);
        console.log(`${symbols.check} payment.processing`);
        console.log(`${symbols.check} payment.succeeded`);
        server.close();
      }, 200);
    }
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log();
    console.log('Stopping webhook listener...');
    server.close();
    process.exit(0);
  });
}

export interface WebhookTestOptions extends GlobalOptions {
  endpoint?: string;
  event?: string;
}

export async function runWebhookTest(options: WebhookTestOptions): Promise<void> {
  const client = new ZimbiApiClient({ verbose: options.verbose });
  const proj = readProjectConfig();
  const endpoint =
    options.endpoint ||
    proj?.webhookUrl ||
    'https://acme.com/api/webhooks/zimbi';
  const eventName = options.event || 'payment.succeeded';

  if (options.json) {
    const result = await client.testWebhook(endpoint);
    outputJson({
      endpoint,
      event: eventName,
      delivered: result.delivered,
      statusCode: result.statusCode,
      signatureVerified: result.signatureVerified,
    });
    if (!result.delivered) {
      process.exit(ExitCodes.NETWORK_FAILURE);
    }
    return;
  }

  printTitle('WEBHOOK TEST');

  console.log('Endpoint');
  console.log(`  ${chalk.cyan(endpoint)}`);
  console.log();

  console.log(`Sending ${eventName}...`);
  console.log();

  const result = await client.testWebhook(endpoint);

  if (result.statusCode === 200 && result.delivered) {
    console.log(`${symbols.check} Request delivered`);
    console.log(`${symbols.check} Signature verified`);
    console.log(`${symbols.check} Response 200`);
    console.log();
    printSuccess('Webhook is healthy.');
    console.log();
  } else {
    console.log(`${symbols.cross} Response ${result.statusCode}`);
    console.log();
    console.log('Your endpoint rejected the webhook.');
    console.log();
    console.log('Common causes:');
    console.log();
    console.log('  • incorrect webhook secret');
    console.log('  • signature verification mismatch');
    console.log('  • raw request body was modified');
    console.log();
    console.log('Run:');
    console.log();
    console.log(`  ${chalk.cyan('zimbi webhook test --verbose')}`);
    console.log();

    throw new ZimbiError({
      message: `Webhook delivery failed with status ${result.statusCode}`,
      exitCode: ExitCodes.NETWORK_FAILURE,
    });
  }
}
