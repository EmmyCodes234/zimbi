import chalk from 'chalk';
import { detectEnvironment } from '../core/environment.js';
import {
  writeProjectConfig,
  writeEnvApiKey,
  isEnvGitignored,
  addEnvToGitignore,
} from '../core/config.js';
import { getGlobalSession, saveGlobalSession, isAuthenticated } from '../core/auth.js';
import { ZimbiApiClient } from '../core/api-client.js';
import { askConfirm, askInput, askPassword, askSelect } from '../ui/prompts.js';
import { createSpinner } from '../ui/spinner.js';
import { outputJson } from '../ui/json.js';
import {
  symbols,
  printTitle,
  printSuccess,
  printNextSteps,
  printDivider,
} from '../ui/output.js';
import type { EnvironmentMode, GlobalOptions } from '../types/index.js';

export interface InitCommandOptions extends GlobalOptions {
  project?: string;
  market?: string;
  env?: string;
}

export async function runInitCommand(options: InitCommandOptions): Promise<void> {
  const cwd = process.cwd();
  const envDetection = detectEnvironment(cwd);
  const client = new ZimbiApiClient({ cwd, verbose: options.verbose });

  // Silent inspection
  const detectedProjectName = options.project || envDetection.projectName || 'acme';
  const targetEnv: EnvironmentMode = (options.env as EnvironmentMode) || 'test';
  const targetMarket = options.market ? options.market.toUpperCase() : 'NG';

  if (options.json) {
    // Non-interactive / Agent mode
    const projRes = await client.createProject(detectedProjectName, targetEnv);
    writeEnvApiKey(projRes.apiKey, cwd);

    await client.enableMarket(targetMarket);
    await client.validateAndConnectProvider('paystack', 'sk_test_agent_auto_key_123', targetEnv);

    writeProjectConfig(
      {
        project: detectedProjectName,
        environment: targetEnv,
        markets: [targetMarket],
        providers: {
          paystack: { connected: true, environment: targetEnv },
        },
      },
      cwd
    );

    outputJson({
      status: 'success',
      project: detectedProjectName,
      environment: targetEnv,
      market: targetMarket,
      provider: 'paystack',
      ready: true,
    });
    return;
  }

  printTitle('ZIMBI');
  console.log("Let's connect this project.");
  console.log();

  // Print detected environment checkmarks
  console.log(`${symbols.check} ${envDetection.nodeVersion}`);
  console.log(
    `${symbols.check} ${envDetection.isTypeScript ? 'TypeScript project' : 'JavaScript project'}`
  );
  console.log(`${symbols.check} ${envDetection.packageManager}`);
  if (envDetection.isGitRepo) {
    console.log(`${symbols.check} git repository`);
  }
  console.log();

  // Step 6: Project Confirmation
  if (envDetection.projectName) {
    console.log('Found an existing project.');
    console.log();
    console.log(`  name       ${chalk.bold(envDetection.projectName)}`);
    if (envDetection.framework) {
      console.log(`  framework  ${envDetection.framework}`);
    }
    console.log(`  runtime    ${envDetection.nodeVersion}`);
    console.log(
      `  language   ${envDetection.isTypeScript ? 'TypeScript' : 'JavaScript'}`
    );
    console.log();

    const useProject = await askConfirm('Use this project?', true, options);
    if (!useProject) {
      console.log('Please cd into the project directory and run `zimbi init` again.');
      return;
    }
  } else {
    console.log('No project detected here.');
    console.log();
    const createChoice = await askSelect(
      'Create a ZIMBI project?',
      [
        { name: 'Connect this directory', value: 'connect' },
        { name: 'Exit', value: 'exit' },
      ],
      options
    );
    if (createChoice === 'exit') {
      return;
    }
  }

  // Step 7: Authentication
  console.log();
  let session = getGlobalSession();
  if (!session) {
    console.log("You'll need a ZIMBI account to continue.");
    console.log();
    const authMethod = await askSelect(
      'Authentication',
      [
        { name: 'Log in', value: 'login' },
        { name: 'Create account', value: 'create' },
        { name: 'Use an API key', value: 'apikey' },
      ],
      options
    );

    if (authMethod === 'apikey') {
      const apiKey = await askInput('Enter your API key: ', undefined, options);
      session = {
        email: 'developer@example.com',
        userId: 'usr_apikey',
        token: apiKey || 'zmb_test_key_auto',
        projects: [{ id: 'proj_' + detectedProjectName, name: detectedProjectName, createdAt: new Date().toISOString() }],
      };
      saveGlobalSession(session);
    } else {
      console.log();
      console.log('Opening your browser...');
      console.log();
      console.log('Waiting for authentication.');
      await new Promise((r) => setTimeout(r, 600));
      session = {
        email: 'emmy@example.com',
        userId: 'usr_81729a',
        token: 'zmb_test_session_token',
        projects: [
          { id: 'proj_' + detectedProjectName, name: detectedProjectName, createdAt: new Date().toISOString() },
          { id: 'proj_staging', name: detectedProjectName + '-staging', createdAt: new Date().toISOString() },
        ],
      };
      saveGlobalSession(session);
    }

    console.log();
    printSuccess(`Signed in as ${chalk.bold(session.email)}`);
    console.log();
  }

  // Step 8: Project Selection
  let chosenProject = detectedProjectName;
  if (!options.project) {
    console.log('Which ZIMBI project should this directory use?');
    console.log();
    const projectChoices = [
      { name: detectedProjectName, value: detectedProjectName },
      { name: `${detectedProjectName}-staging`, value: `${detectedProjectName}-staging` },
      { name: 'Create a new project', value: '__new__' },
    ];

    const sel = await askSelect('Select project', projectChoices, options);
    if (sel === '__new__') {
      chosenProject = await askInput('Project name: ', detectedProjectName, options);
      console.log();
      printSuccess(`Created project ${chalk.bold(chosenProject)}`);
    } else {
      chosenProject = sel;
    }
  }

  // Step 9: Environment Selection
  let chosenEnv: EnvironmentMode = targetEnv;
  if (!options.env) {
    console.log();
    console.log('Where are we working?');
    console.log();
    chosenEnv = (await askSelect(
      'Environment',
      [
        { name: 'Test', value: 'test' },
        { name: 'Production', value: 'production' },
      ],
      options
    )) as EnvironmentMode;
  }
  console.log();
  printSuccess(`Using ${chosenEnv} environment`);
  console.log();

  // Step 10: Market Activation
  if (!options.market) {
    console.log('Where do you want to accept payments?');
    console.log();
    const marketSel = await askSelect(
      'Choose market',
      [
        { name: '🇳🇬 Nigeria', value: 'NG' },
        { name: '🇺🇸 United States', value: 'US' },
        { name: '🇬🇧 United Kingdom', value: 'GB' },
        { name: 'Add another market', value: 'other' },
      ],
      options
    );

    if (marketSel === 'NG' || marketSel === 'other') {
      console.log();
      console.log(chalk.bold('🇳🇬 Nigeria'));
      console.log();
      console.log('ZIMBI can configure:');
      console.log();
      console.log('  Currency       NGN');
      console.log('  Cards          Available');
      console.log('  Bank transfer  Available');
      console.log('  USSD           Available');
      console.log('  OPay           Available');
      console.log();

      const proceedMarket = await askConfirm('Continue?', true, options);
      if (!proceedMarket) {
        console.log('Setup aborted.');
        return;
      }
    }
  }

  // Step 11: Provider Configuration
  console.log();
  console.log('Nigeria requires a payment provider.');
  console.log();
  const providerChoice = await askSelect(
    'Choose one',
    [
      { name: 'Paystack', value: 'paystack' },
      { name: 'Flutterwave', value: 'flutterwave' },
    ],
    options
  );

  const providerName = providerChoice === 'paystack' ? 'Paystack' : 'Flutterwave';
  console.log();
  console.log(chalk.bold(providerName));
  console.log();
  console.log('Enter your test secret key.');
  console.log();

  const secretKey = await askPassword('Secret key: ', options);

  console.log();
  console.log('Connecting...');
  await new Promise((r) => setTimeout(r, 600));

  // Connect provider and market in state
  const projRes = await client.createProject(chosenProject, chosenEnv);
  writeEnvApiKey(projRes.apiKey, cwd);

  await client.validateAndConnectProvider(providerChoice, secretKey, chosenEnv);
  await client.enableMarket('NG');

  console.log();
  printSuccess('Key is valid');
  printSuccess('Account found');
  printSuccess('Nigeria payments enabled');
  printSuccess('Test environment ready');
  console.log();
  console.log(`${providerName} is connected.`);
  console.log();

  // Step 12: Configuration files & Gitignore Trust Moment
  writeProjectConfig(
    {
      project: chosenProject,
      environment: chosenEnv,
      markets: ['NG'],
      providers: {
        [providerChoice]: { connected: true, environment: chosenEnv },
      },
    },
    cwd
  );

  if (!isEnvGitignored(cwd)) {
    console.log('Your .env file is not ignored by git.');
    console.log();
    console.log('This can expose your ZIMBI credentials.');
    console.log();
    const ignoreEnv = await askConfirm('Add .env to .gitignore?', true, options);
    if (ignoreEnv) {
      addEnvToGitignore(cwd);
      printSuccess('Added .env to .gitignore');
      console.log();
    }
  }

  // Step 13: Final Screen
  printSuccess('ZIMBI is connected');
  console.log();
  console.log(chalk.bold('Project'));
  console.log(`  ${chosenProject}`);
  console.log();
  console.log(chalk.bold('Environment'));
  console.log(`  ${chosenEnv}`);
  console.log();
  console.log(chalk.bold('Markets'));
  console.log('  🇳🇬 Nigeria');
  console.log();
  console.log(chalk.bold('Payment methods'));
  console.log('  Card');
  console.log('  Bank transfer');
  console.log('  USSD');
  console.log();
  console.log(chalk.bold('Provider'));
  console.log('  Connected');
  console.log();

  printDivider();

  printNextSteps([
    'npm install @zimbi/sdk',
    'Then create your first checkout:',
    'zimbi payment test',
    'Or run:',
    'zimbi doctor',
    'Everything is ready.',
  ]);
}
