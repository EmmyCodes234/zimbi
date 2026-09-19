import chalk from 'chalk';
import { ZimbiApiClient } from '../core/api-client.js';
import { askInput, askSelect } from '../ui/prompts.js';
import { outputJson } from '../ui/json.js';
import { symbols, printTitle, printSuccess } from '../ui/output.js';
import type { GlobalOptions } from '../types/index.js';
import { ZimbiError } from '../core/errors.js';
import { ExitCodes } from '../core/exit-codes.js';

export interface PaymentTestOptions extends GlobalOptions {
  market?: string;
  amount?: string | number;
  method?: string;
}

export async function runPaymentTest(options: PaymentTestOptions): Promise<void> {
  const client = new ZimbiApiClient({ verbose: options.verbose });

  const chosenMarket = options.market || 'NG';
  const amountNum = typeof options.amount === 'number' ? options.amount : options.amount ? parseInt(options.amount, 10) : 20000;
  const chosenMethod = options.method || 'Bank transfer';

  if (options.json) {
    const payment = await client.createPayment({
      market: chosenMarket,
      amount: amountNum,
      method: chosenMethod,
    });
    outputJson(payment);
    return;
  }

  printTitle('TEST PAYMENT');

  let selectedMarket = chosenMarket;
  if (!options.market) {
    selectedMarket = await askSelect(
      'Market',
      [
        { name: '🇳🇬 Nigeria', value: 'NG' },
        { name: '🇺🇸 United States', value: 'US' },
        { name: '🇬🇧 United Kingdom', value: 'GB' },
      ],
      options
    );
  }

  let finalAmount = amountNum;
  if (!options.amount) {
    const amountStr = await askInput('Amount', '₦20,000', options);
    const cleaned = amountStr.replace(/[^\d]/g, '');
    finalAmount = cleaned ? parseInt(cleaned, 10) : 20000;
  }

  let finalMethod = chosenMethod;
  if (!options.method) {
    finalMethod = await askSelect(
      'Payment method',
      [
        { name: 'Bank transfer', value: 'Bank transfer' },
        { name: 'Card', value: 'Card' },
        { name: 'USSD', value: 'USSD' },
        { name: 'OPay', value: 'OPay' },
      ],
      options
    );
  }

  console.log();
  console.log('Creating test payment...');
  await new Promise((r) => setTimeout(r, 600));

  const payment = await client.createPayment({
    market: selectedMarket,
    amount: finalAmount,
    method: finalMethod,
  });

  console.log();
  printSuccess('Payment created');
  console.log();
  console.log(chalk.bold('Payment'));
  console.log(`  ${chalk.cyan(payment.id)}`);
  console.log();
  console.log(chalk.bold('Amount'));
  console.log(`  ${payment.formattedAmount}`);
  console.log();
  console.log(chalk.bold('Status'));
  console.log(`  ${payment.status}`);
  console.log();
  console.log(chalk.bold('Checkout'));
  console.log(`  ${chalk.underline(payment.checkoutUrl)}`);
  console.log();
}

export async function runPaymentInspect(
  paymentId: string | undefined,
  options: GlobalOptions
): Promise<void> {
  if (!paymentId) {
    throw new ZimbiError({
      message: 'Payment ID is required.',
      reason: 'Please specify the ID of the payment you want to inspect.',
      fix: 'Run: zimbi payment inspect pay_test_123',
      exitCode: ExitCodes.INVALID_USAGE,
    });
  }

  const client = new ZimbiApiClient({ verbose: options.verbose });
  const payment = await client.inspectPayment(paymentId);

  if (!payment) {
    throw new ZimbiError({
      message: `Payment '${paymentId}' not found.`,
      reason: 'No payment found matching this ID.',
      fix: 'Run: zimbi payment test to generate a new payment.',
      exitCode: ExitCodes.GENERAL_FAILURE,
    });
  }

  if (options.json) {
    outputJson(payment);
    return;
  }

  printTitle('PAYMENT');

  console.log(chalk.bold('ID'));
  console.log(`  ${payment.id}`);
  console.log();

  console.log(chalk.bold('Status'));
  const statusColor =
    payment.status === 'succeeded'
      ? chalk.green(payment.status)
      : payment.status === 'failed'
      ? chalk.red(payment.status)
      : chalk.yellow(payment.status);
  console.log(`  ${statusColor}`);
  console.log();

  console.log(chalk.bold('Amount'));
  console.log(`  ${payment.formattedAmount}`);
  console.log();

  console.log(chalk.bold('Market'));
  console.log(`  ${payment.market}`);
  console.log();

  console.log(chalk.bold('Method'));
  console.log(`  ${payment.method}`);
  console.log();

  console.log(chalk.bold('Provider'));
  console.log(`  ${payment.provider}`);
  console.log();

  console.log(chalk.bold('Created'));
  console.log(`  ${payment.createdAt}`);
  console.log();

  console.log(chalk.bold('Updated'));
  console.log(`  ${payment.updatedAt}`);
  console.log();

  if (options.verbose) {
    if (payment.providerTransactionId) {
      console.log(chalk.bold('Provider transaction ID'));
      console.log(`  ${payment.providerTransactionId}`);
      console.log();
    }

    if (payment.routingDecision) {
      console.log(chalk.bold('Routing decision'));
      console.log(`  ${payment.routingDecision}`);
      console.log();
    }

    if (payment.requestId) {
      console.log(chalk.bold('Request ID'));
      console.log(`  ${payment.requestId}`);
      console.log();
    }

    if (payment.webhookEvents && payment.webhookEvents.length > 0) {
      console.log(chalk.bold('Webhook events'));
      for (const ev of payment.webhookEvents) {
        console.log(`  ${symbols.check} ${ev.event.padEnd(22)} ${ev.timestamp} (${ev.status})`);
      }
      console.log();
    }
  }
}

export async function runPaymentReconcile(
  paymentId: string | undefined,
  options: GlobalOptions
): Promise<void> {
  if (!paymentId) {
    throw new ZimbiError({
      message: 'Payment ID is required.',
      reason: 'Please specify the ID of the payment you want to reconcile.',
      fix: 'Run: zimbi payment reconcile pay_test_123',
      exitCode: ExitCodes.INVALID_USAGE,
    });
  }

  const client = new ZimbiApiClient({ verbose: options.verbose });

  if (options.json) {
    const res = await client.reconcilePayment(paymentId);
    outputJson(res);
    return;
  }

  printTitle('RECONCILE PAYMENT');
  console.log(`Checking payment ${chalk.cyan(paymentId)} with provider...`);
  console.log();

  const res = await client.reconcilePayment(paymentId);

  console.log(chalk.bold('Provider'));
  console.log(`  ${res.provider}`);
  console.log();

  console.log(chalk.bold('Local status'));
  console.log(`  ${res.localStatus}`);
  console.log();

  console.log(chalk.bold('Provider status'));
  console.log(`  ${res.providerStatus}`);
  console.log();

  if (res.discrepancyDetected) {
    printSuccess('Discrepancy resolved');
    console.log(`  ${res.message}`);
    console.log();
    console.log(`  Payment status updated to: ${chalk.green(res.localStatus)}`);
  } else {
    printSuccess('Payment in sync');
    console.log(`  ${res.message}`);
  }
  console.log();
}
