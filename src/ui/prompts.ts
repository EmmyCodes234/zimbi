import { select, confirm, input, password } from '@inquirer/prompts';

export interface PromptOptions {
  yes?: boolean;
}

export async function askSelect<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T; description?: string }>,
  options: PromptOptions = {}
): Promise<T> {
  if (options.yes) {
    return choices[0].value;
  }

  return select({
    message,
    choices,
  });
}

export async function askConfirm(
  message: string,
  defaultValue: boolean = true,
  options: PromptOptions = {}
): Promise<boolean> {
  if (options.yes) {
    return defaultValue;
  }

  return confirm({
    message,
    default: defaultValue,
  });
}

export async function askInput(
  message: string,
  defaultValue?: string,
  options: PromptOptions = {}
): Promise<string> {
  if (options.yes && defaultValue !== undefined) {
    return defaultValue;
  }

  return input({
    message,
    default: defaultValue,
  });
}

export async function askPassword(
  message: string,
  options: PromptOptions = {}
): Promise<string> {
  if (options.yes) {
    return 'sk_test_mock_secret_key_12345';
  }

  return password({
    message,
    mask: '*',
  });
}
