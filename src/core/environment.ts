import fs from 'node:fs';
import path from 'node:path';

export interface EnvironmentDetection {
  nodeVersion: string;
  isTypeScript: boolean;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  framework?: string;
  projectName?: string;
  isGitRepo: boolean;
  hasEnvFile: boolean;
  hasZimbiConfig: boolean;
  rootDir: string;
}

export function detectEnvironment(cwd: string = process.cwd()): EnvironmentDetection {
  const rootDir = path.resolve(cwd);
  
  // Node version (clean e.g. "Node.js 22")
  const nodeMajor = process.versions.node.split('.')[0];
  const nodeVersion = `Node.js ${nodeMajor}`;

  // Package manager detection
  let packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' = 'npm';
  if (fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml'))) {
    packageManager = 'pnpm';
  } else if (fs.existsSync(path.join(rootDir, 'yarn.lock'))) {
    packageManager = 'yarn';
  } else if (fs.existsSync(path.join(rootDir, 'bun.lockb')) || fs.existsSync(path.join(rootDir, 'bun.lock'))) {
    packageManager = 'bun';
  }

  // Git detection
  const isGitRepo = fs.existsSync(path.join(rootDir, '.git'));

  // TypeScript detection
  const isTypeScript = fs.existsSync(path.join(rootDir, 'tsconfig.json'));

  // Env file detection
  const hasEnvFile = fs.existsSync(path.join(rootDir, '.env'));

  // Zimbi config detection
  const hasZimbiConfig = fs.existsSync(path.join(rootDir, '.zimbi', 'project.json'));

  // Package.json detection
  let projectName: string | undefined;
  let framework: string | undefined;

  const pkgJsonPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const raw = fs.readFileSync(pkgJsonPath, 'utf8');
      const pkg = JSON.parse(raw);
      projectName = pkg.name;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      if (allDeps['next']) framework = 'Next.js';
      else if (allDeps['vite']) framework = 'Vite';
      else if (allDeps['@remix-run/react'] || allDeps['@remix-run/node']) framework = 'Remix';
      else if (allDeps['nuxt']) framework = 'Nuxt';
      else if (allDeps['astro']) framework = 'Astro';
      else if (allDeps['svelte'] || allDeps['@sveltejs/kit']) framework = 'SvelteKit';
      else if (allDeps['express']) framework = 'Express';
      else if (allDeps['fastify']) framework = 'Fastify';
      else if (allDeps['nestjs'] || allDeps['@nestjs/core']) framework = 'NestJS';
      else if (allDeps['react']) framework = 'React';
    } catch {
      // Ignore JSON parse errors in project inspection
    }
  }

  if (!projectName) {
    projectName = path.basename(rootDir);
  }

  return {
    nodeVersion,
    isTypeScript,
    packageManager,
    framework,
    projectName,
    isGitRepo,
    hasEnvFile,
    hasZimbiConfig,
    rootDir,
  };
}
