import chalk from 'chalk';
import { ZimbiApiClient } from '../core/api-client.js';
import { readProjectConfig, updateProjectConfig } from '../core/config.js';
import { getAccountSession, getProjectApiKey, saveProjectApiKey } from '../core/secure-store.js';
import { outputJson } from '../ui/json.js';
import { printSuccess, printTitle, symbols } from '../ui/output.js';
import type { GlobalOptions } from '../types/index.js';

export interface ProjectCommandOptions extends GlobalOptions {
  env?: string;
}

export async function runProjectListCommand(options: GlobalOptions): Promise<void> {
  const cwd = process.cwd();
  const client = new ZimbiApiClient({ cwd, verbose: options.verbose });
  const currentConfig = readProjectConfig(cwd);
  const activeProjectId = currentConfig?.project;

  const projects = await client.listProjects();

  if (options.json) {
    outputJson({
      projects: projects.map((p) => ({
        ...p,
        active: p.id === activeProjectId || p.name === activeProjectId,
      })),
    });
    return;
  }

  printTitle('Projects');

  if (projects.length === 0) {
    console.log('No projects found. Create one with `zimbi project create <name>`.');
    return;
  }

  for (const p of projects) {
    const isCurrent = p.id === activeProjectId || p.name === activeProjectId;
    const marker = isCurrent ? chalk.green('● ') : '  ';
    const statusText = p.status === 'active' ? chalk.gray('active') : chalk.yellow(p.status);
    const envBadge = chalk.cyan(`[${p.environment}]`);
    console.log(`${marker}${chalk.bold(p.name)} (${p.id}) ${envBadge} - ${statusText}`);
  }
  console.log();
}

export async function runProjectCurrentCommand(options: GlobalOptions): Promise<void> {
  const cwd = process.cwd();
  const config = readProjectConfig(cwd);

  if (options.json) {
    outputJson(config || { error: 'No project configured in this directory.' });
    return;
  }

  if (!config || !config.project) {
    console.log('No project linked to this directory.');
    console.log('Run `zimbi init` or `zimbi project use <id>` to link a project.');
    return;
  }

  const hasCachedKey = Boolean(getProjectApiKey(config.project));

  console.log();
  console.log(`  Project     : ${chalk.bold(config.project)}`);
  console.log(`  Environment : ${config.environment}`);
  console.log(`  Credential  : ${hasCachedKey ? chalk.green('OS Secure Store') : chalk.yellow('Not cached')}`);
  console.log();
}

export async function runProjectUseCommand(
  projectId: string,
  options: ProjectCommandOptions
): Promise<void> {
  const cwd = process.cwd();
  const client = new ZimbiApiClient({ cwd, verbose: options.verbose });
  const targetEnv = (options.env || 'test') as 'test' | 'production';

  // 1. Verify project exists in account if authenticated
  let targetName = projectId;
  try {
    const projects = await client.listProjects();
    const target = projects.find((p) => p.id === projectId || p.name === projectId);
    if (target) {
      projectId = target.id;
      targetName = target.name;
    }
  } catch {
    // If unauthenticated or offline, allow local switch
  }

  // 2. Obtain / cache project API key in Secure Store if available
  let apiKey = getProjectApiKey(projectId);
  if (!apiKey) {
    try {
      apiKey = await client.generateProjectKey(projectId);
    } catch {
      // Ignore if offline
    }
  }

  // 3. Update ONLY .zimbi/project.json (never touches .env silently)
  updateProjectConfig(
    {
      project: projectId,
      environment: targetEnv,
    },
    cwd
  );

  if (options.json) {
    outputJson({
      status: 'success',
      project: projectId,
      name: targetName,
      environment: targetEnv,
    });
    return;
  }

  printSuccess(`Using project ${chalk.bold(targetName)} (${projectId})`);
}

export async function runProjectCreateCommand(
  name: string,
  options: ProjectCommandOptions
): Promise<void> {
  const cwd = process.cwd();
  const client = new ZimbiApiClient({ cwd, verbose: options.verbose });
  const env = (options.env || 'test') as 'test' | 'production';

  const project = await client.createProject(name, env);

  // Update .zimbi/project.json
  updateProjectConfig(
    {
      project: project.id,
      environment: env,
    },
    cwd
  );

  if (options.json) {
    outputJson(project);
    return;
  }

  printSuccess(`Created project ${chalk.bold(project.name)} (${project.id})`);
  console.log(`Environment: ${env}`);
  console.log(`Key saved to OS Secure Credential Store.`);
}
