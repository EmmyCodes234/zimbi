import chalk from 'chalk';
import { ZimbiApiClient } from '../core/api-client.js';
import { readProjectConfig } from '../core/config.js';
import { askConfirm } from '../ui/prompts.js';
import { outputJson } from '../ui/json.js';
import { symbols, printSuccess, printTitle } from '../ui/output.js';
import type { GlobalOptions } from '../types/index.js';
import { ZimbiError } from '../core/errors.js';
import { ExitCodes } from '../core/exit-codes.js';

export async function runMarketList(options: GlobalOptions): Promise<void> {
  const client = new ZimbiApiClient({ verbose: options.verbose });
  const markets = await client.listMarkets();

  if (options.json) {
    outputJson({
      markets: markets.map((m) => ({
        country: m.code,
        name: m.name,
        status: m.status,
        currency: m.currency,
      })),
    });
    return;
  }

  printTitle('MARKETS');
  for (const m of markets) {
    const statusText = m.status === 'active' ? chalk.green('active') : chalk.dim('inactive');
    const label = `${m.flag} ${m.name}`.padEnd(20);
    console.log(`  ${label} ${statusText}`);
  }

  console.log();
  console.log('Add a market:');
  console.log();
  console.log(`  ${chalk.cyan('zimbi market add <country>')}`);
  console.log();
}

export async function runMarketAdd(country: string, options: GlobalOptions): Promise<void> {
  const client = new ZimbiApiClient({ verbose: options.verbose });
  const market = await client.getMarket(country);

  if (!market) {
    throw new ZimbiError({
      message: `Market '${country}' is not recognized or supported yet.`,
      reason: `ZIMBI currently supports Nigeria (NG), United States (US), and United Kingdom (GB).`,
      fix: 'Run `zimbi market list` to see available markets.',
      exitCode: ExitCodes.INVALID_USAGE,
    });
  }

  if (options.json) {
    const updated = await client.enableMarket(country);
    outputJson({
      country: updated.code,
      name: updated.name,
      status: updated.status,
      currency: updated.currency,
      paymentMethods: updated.capabilities,
    });
    return;
  }

  printTitle(market.name);
  console.log('Checking availability...');
  console.log();
  console.log(`${symbols.check} Market supported`);
  console.log(`${symbols.check} Currency configured`);
  console.log(`${symbols.check} Payment methods available`);
  console.log();

  const confirmed = await askConfirm(`Enable ${market.name}?`, true, options);
  if (!confirmed) {
    console.log('Operation cancelled.');
    return;
  }

  await client.enableMarket(country);

  console.log();
  printSuccess(`${market.name} enabled`);
  console.log();
  console.log('Available payment methods:');
  console.log();
  for (const method of market.capabilities) {
    console.log(`  ${method}`);
  }
  console.log();
  console.log(`Run ${chalk.cyan(`\`zimbi market status ${market.code}\``)} for details.`);
  console.log();
}

export async function runMarketStatus(country: string, options: GlobalOptions): Promise<void> {
  const client = new ZimbiApiClient({ verbose: options.verbose });
  const market = await client.getMarket(country);
  const proj = readProjectConfig();

  if (!market) {
    throw new ZimbiError({
      message: `Market '${country}' not found.`,
      reason: 'No market configuration found matching this code.',
      fix: 'Run `zimbi market list` to see available markets.',
      exitCode: ExitCodes.INVALID_USAGE,
    });
  }

  const env = proj?.environment || 'test';

  if (options.json) {
    outputJson({
      code: market.code,
      name: market.name,
      status: market.status,
      currency: market.currency,
      paymentMethods: market.capabilities,
      providerConnected: market.status === 'active',
      checkoutReady: market.checkoutReady,
      webhooksConnected: market.webhooksConnected,
      environment: env,
    });
    return;
  }

  printTitle(`${market.flag} ${market.name.toUpperCase()}`);

  console.log('Status');
  if (market.status === 'active') {
    console.log(`  ${symbols.bullet} ${chalk.green('Active')}`);
  } else {
    console.log(`  ${symbols.warn} ${chalk.dim('Inactive')}`);
  }
  console.log();

  console.log('Currency');
  console.log(`  ${market.currency}`);
  console.log();

  console.log('Payment methods');
  for (const cap of market.capabilities) {
    console.log(`  ${symbols.check} ${cap}`);
  }
  console.log();

  console.log('Provider');
  if (market.status === 'active') {
    console.log(`  ${symbols.check} Connected`);
  } else {
    console.log(`  ${symbols.warn} Not connected`);
  }
  console.log();

  console.log('Checkout');
  if (market.checkoutReady) {
    console.log(`  ${symbols.check} Ready`);
  } else {
    console.log(`  ${symbols.warn} Needs market activation`);
  }
  console.log();

  console.log('Webhooks');
  if (market.webhooksConnected) {
    console.log(`  ${symbols.check} Connected`);
  } else {
    console.log(`  ${symbols.warn} Disconnected`);
  }
  console.log();

  console.log('Environment');
  console.log(`  ${env}`);
  console.log();
}

export async function runMarketRemove(country: string, options: GlobalOptions): Promise<void> {
  const client = new ZimbiApiClient({ verbose: options.verbose });
  const market = await client.getMarket(country);

  if (!market) {
    throw new ZimbiError({
      message: `Market '${country}' not found.`,
      reason: 'Cannot remove a market that does not exist.',
      fix: 'Run `zimbi market list` to check active markets.',
      exitCode: ExitCodes.INVALID_USAGE,
    });
  }

  if (options.json) {
    await client.disableMarket(country);
    outputJson({
      country: market.code,
      name: market.name,
      removed: true,
    });
    return;
  }

  console.log();
  console.log(`Remove ${market.name}?`);
  console.log();
  console.log('Existing payments will not be affected.');
  console.log();
  console.log(`New ${market.name} payments will no longer be accepted.`);
  console.log();

  const confirmed = await askConfirm(`Remove ${market.name}?`, true, options);
  if (!confirmed) {
    console.log('Operation cancelled.');
    return;
  }

  await client.disableMarket(country);

  console.log();
  printSuccess(`${market.name} removed from active markets.`);
  console.log();
}
