import ora, { type Ora } from 'ora';

export interface SpinnerOptions {
  silent?: boolean;
}

export function createSpinner(text: string, options: SpinnerOptions = {}): Ora | {
  start: () => any;
  stop: () => any;
  succeed: (msg?: string) => any;
  fail: (msg?: string) => any;
  warn: (msg?: string) => any;
  info: (msg?: string) => any;
} {
  if (options.silent || process.env.NODE_ENV === 'test') {
    return {
      start: () => {},
      stop: () => {},
      succeed: (msg?: string) => {
        if (msg) console.log(`✓ ${msg}`);
      },
      fail: (msg?: string) => {
        if (msg) console.log(`✕ ${msg}`);
      },
      warn: (msg?: string) => {
        if (msg) console.log(`! ${msg}`);
      },
      info: (msg?: string) => {
        if (msg) console.log(`ℹ ${msg}`);
      },
    };
  }

  return ora({
    text,
    color: 'cyan',
  });
}
