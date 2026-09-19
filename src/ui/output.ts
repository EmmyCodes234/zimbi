import chalk from 'chalk';

export const symbols = {
  check: chalk.green('✓'),
  cross: chalk.red('✕'),
  bullet: chalk.green('●'),
  warn: chalk.yellow('!'),
  arrow: chalk.dim('›'),
  divider: chalk.dim('────────────────────────────────────'),
  shortDivider: chalk.dim('────────────────────────────'),
};

export function printTitle(title: string): void {
  console.log();
  console.log(chalk.bold(title));
  console.log();
}

export function printSection(title: string): void {
  console.log(chalk.bold(title));
}

export function printSuccess(message: string): void {
  console.log(`${symbols.check} ${message}`);
}

export function printError(message: string): void {
  console.log(`${symbols.cross} ${message}`);
}

export function printWarning(message: string): void {
  console.log(`${symbols.warn} ${message}`);
}

export function printBullet(message: string): void {
  console.log(`  ${symbols.bullet} ${message}`);
}

export function printKeyValue(key: string, value: string, indent: number = 2): void {
  const pad = ' '.repeat(indent);
  console.log(`${pad}${chalk.dim(key.padEnd(16))} ${value}`);
}

export function printCheckItem(label: string, value: string): void {
  console.log(`  ${symbols.check} ${label.padEnd(14)} ${value}`);
}

export function printDivider(): void {
  console.log(symbols.divider);
}

export function printShortDivider(): void {
  console.log(symbols.shortDivider);
}

export function printNextSteps(steps: string[]): void {
  console.log();
  console.log('Next:');
  console.log();
  for (const step of steps) {
    if (step.startsWith('npm ') || step.startsWith('zimbi ')) {
      console.log(`  ${chalk.cyan(step)}`);
    } else {
      console.log(`  ${step}`);
    }
  }
  console.log();
}

export function formatErrorDisplay(options: {
  message: string;
  reason?: string;
  fix?: string;
  requestId?: string;
  technicalDetails?: string;
  verbose?: boolean;
}): void {
  console.log();
  console.log(`${symbols.cross} ${chalk.red(options.message)}`);
  
  if (options.reason) {
    console.log();
    console.log(options.reason);
  }

  if (options.fix) {
    console.log();
    console.log(chalk.bold('Fix:'));
    console.log();
    const lines = options.fix.split('\n');
    for (const line of lines) {
      console.log(`  ${line}`);
    }
  }

  if (options.requestId) {
    console.log();
    console.log(chalk.dim('Request ID'));
    console.log(`  ${chalk.dim(options.requestId)}`);
  }

  if (options.verbose && options.technicalDetails) {
    console.log();
    console.log(chalk.dim('Technical details:'));
    const techLines = options.technicalDetails.split('\n');
    for (const line of techLines) {
      console.log(`  ${chalk.dim(line)}`);
    }
  }
  console.log();
}
