import fs from 'node:fs';
import path from 'node:path';
import type { ProjectConfig, EnvironmentMode } from '../types/index.js';

export const ZIMBI_DIR = '.zimbi';
export const PROJECT_CONFIG_FILE = 'project.json';

export function getProjectConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, ZIMBI_DIR, PROJECT_CONFIG_FILE);
}

export function readProjectConfig(cwd: string = process.cwd()): ProjectConfig | null {
  const configPath = getProjectConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return null;
  }
}

export function writeProjectConfig(config: ProjectConfig, cwd: string = process.cwd()): void {
  const dir = path.join(cwd, ZIMBI_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const configPath = path.join(dir, PROJECT_CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function updateProjectConfig(
  partial: Partial<ProjectConfig>,
  cwd: string = process.cwd()
): ProjectConfig {
  const existing = readProjectConfig(cwd) || {
    project: partial.project || 'proj_default',
    environment: 'test' as EnvironmentMode,
  };

  const updated: ProjectConfig = {
    ...existing,
    ...partial,
    updatedAt: new Date().toISOString(),
  };

  writeProjectConfig(updated, cwd);
  return updated;
}

export function readEnvApiKey(cwd: string = process.cwd()): string | undefined {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return undefined;

  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('ZIMBI_API_KEY=')) {
        return trimmed.replace('ZIMBI_API_KEY=', '').trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // Ignore read errors
  }
  return undefined;
}

export function writeEnvApiKey(apiKey: string, cwd: string = process.cwd()): void {
  const envPath = path.join(cwd, '.env');
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  if (content.includes('ZIMBI_API_KEY=')) {
    content = content.replace(/ZIMBI_API_KEY=.*(\r?\n|$)/g, `ZIMBI_API_KEY=${apiKey}\n`);
  } else {
    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    content += `ZIMBI_API_KEY=${apiKey}\n`;
  }

  fs.writeFileSync(envPath, content, 'utf8');
}

export function isEnvGitignored(cwd: string = process.cwd()): boolean {
  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return false;
  }
  try {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    const lines = content.split('\n').map((l) => l.trim());
    return lines.some((line) => line === '.env' || line === '*.env' || line === '.env*');
  } catch {
    return false;
  }
}

export function addEnvToGitignore(cwd: string = process.cwd()): void {
  const gitignorePath = path.join(cwd, '.gitignore');
  let content = '';
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf8');
  }

  if (!isEnvGitignored(cwd)) {
    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    content += '\n# Local environment secrets\n.env\n';
    fs.writeFileSync(gitignorePath, content, 'utf8');
  }
}
