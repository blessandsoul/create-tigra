#!/usr/bin/env node

import { Command } from 'commander';
import prompts from 'prompts';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_DIR = path.join(__dirname, '..', 'template');

// Files that contain template variables and need replacement
const FILES_TO_REPLACE = [
  'server/package.json',
  'server/.env.example',
  'server/docker-compose.yml',
  'client/package.json',
  'client/.env.example',
];

// Directories/files to skip when copying
const SKIP_PATTERNS = [
  'node_modules',
  '.next',
  'dist',
  'out',
  '.env',
  '.env.local',
  '.env.*.local',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
];

function toKebabCase(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function toSnakeCase(str) {
  return str.replace(/-/g, '_');
}

function toTitleCase(str) {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function validateProjectName(name) {
  if (!name || name.trim().length === 0) {
    return 'Project name cannot be empty';
  }
  const kebab = toKebabCase(name);
  if (kebab.length === 0) {
    return 'Project name must contain at least one alphanumeric character';
  }
  if (kebab.length > 214) {
    return 'Project name is too long (max 214 characters)';
  }
  return true;
}

function shouldSkip(filePath) {
  const parts = filePath.split(path.sep);
  return parts.some((part) =>
    SKIP_PATTERNS.some((pattern) => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
        return regex.test(part);
      }
      return part === pattern;
    })
  );
}

async function copyTemplate(templateDir, targetDir) {
  const entries = await fs.readdir(templateDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(templateDir, entry.name);
    const relativePath = path.relative(TEMPLATE_DIR, srcPath);

    if (shouldSkip(relativePath)) {
      continue;
    }

    // Handle dotfile renaming: gitignore -> .gitignore, _claude -> .claude
    let destName = entry.name;
    if (entry.name === 'gitignore') destName = '.gitignore';
    if (entry.name === '_claude') destName = '.claude';

    const destPath = path.join(targetDir, destName);

    if (entry.isDirectory()) {
      await fs.ensureDir(destPath);
      await copyTemplate(srcPath, destPath);
    } else {
      await fs.copy(srcPath, destPath);
    }
  }
}

function replaceVariables(content, variables) {
  let result = content;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

async function main() {
  const program = new Command();

  program
    .name('create-tigra')
    .description('Create a production-ready full-stack app with Next.js + Fastify + Prisma + Redis')
    .version('2.0.2')
    .argument('[project-name]', 'Name for your new project')
    .action(async (projectNameArg) => {
      console.log();
      console.log(chalk.bold('  Create Tigra') + chalk.dim(' v2.0.2'));
      console.log();

      let projectName = projectNameArg;

      if (!projectName) {
        const response = await prompts(
          {
            type: 'text',
            name: 'projectName',
            message: 'What is your project name?',
            validate: validateProjectName,
          },
          {
            onCancel: () => {
              console.log(chalk.red('\n  Cancelled.\n'));
              process.exit(1);
            },
          }
        );
        projectName = response.projectName;
      }

      // Validate and normalize
      const validation = validateProjectName(projectName);
      if (validation !== true) {
        console.error(chalk.red(`\n  ${validation}\n`));
        process.exit(1);
      }

      projectName = toKebabCase(projectName);

      const targetDir = path.resolve(process.cwd(), projectName);

      // Check if directory exists and is non-empty
      if (await fs.pathExists(targetDir)) {
        const files = await fs.readdir(targetDir);
        if (files.length > 0) {
          console.error(chalk.red(`\n  Directory "${projectName}" already exists and is not empty.\n`));
          process.exit(1);
        }
      }

      // Generate random port offset (1-200) so multiple projects don't conflict
      const portOffset = crypto.randomInt(1, 201);

      // Derive all variables
      const variables = {
        PROJECT_NAME: projectName,
        PROJECT_NAME_SNAKE: toSnakeCase(projectName),
        PROJECT_DISPLAY_NAME: toTitleCase(projectName),
        DATABASE_NAME: `${toSnakeCase(projectName)}_db`,
        JWT_SECRET: crypto.randomBytes(48).toString('hex'),
        MYSQL_PORT: String(3306 + portOffset),
        PHPMYADMIN_PORT: String(8080 + portOffset),
        REDIS_PORT: String(6379 + portOffset),
        REDIS_COMMANDER_PORT: String(8081 + portOffset),
      };

      // Copy template
      const spinner = ora('Scaffolding project...').start();

      try {
        await fs.ensureDir(targetDir);
        await copyTemplate(TEMPLATE_DIR, targetDir);

        // Replace template variables in specific files
        for (const filePath of FILES_TO_REPLACE) {
          const fullPath = path.join(targetDir, filePath);
          if (await fs.pathExists(fullPath)) {
            const content = await fs.readFile(fullPath, 'utf-8');
            const replaced = replaceVariables(content, variables);
            await fs.writeFile(fullPath, replaced, 'utf-8');
          }
        }

        // Generate .env from .env.example (so users don't have to copy manually)
        for (const envExample of ['server/.env.example', 'client/.env.example']) {
          const examplePath = path.join(targetDir, envExample);
          const envPath = path.join(targetDir, envExample.replace('.env.example', '.env'));
          if (await fs.pathExists(examplePath)) {
            await fs.copy(examplePath, envPath);
          }
        }

        spinner.succeed('Project scaffolded successfully!');
      } catch (error) {
        spinner.fail('Failed to scaffold project');
        console.error(chalk.red(`\n  ${error.message}\n`));
        process.exit(1);
      }

      // Print next steps
      const dim = chalk.dim;
      const bold = chalk.bold;
      const cyan = chalk.cyan;
      const green = chalk.green;
      const line = dim('  ─────────────────────────────────────────');

      console.log();
      console.log(green.bold('  ✓ Created ') + cyan.bold(projectName) + dim(` at ${targetDir}`));
      console.log();
      console.log('  ┌─────────────────────────────────────────┐');
      console.log('  │' + bold('            Getting Started              ') + '│');
      console.log('  └─────────────────────────────────────────┘');
      console.log();
      console.log(bold('  SERVER') + dim('                    cd ') + cyan(`${projectName}/server`));
      console.log();
      console.log(cyan('    1 ') + 'Install & start infrastructure');
      console.log(dim('      npm install'));
      console.log(dim('      npm run docker:up'));
      console.log();
      console.log(cyan('    2 ') + 'Set up database');
      console.log(dim('      npm run prisma:generate'));
      console.log(dim('      npm run prisma:migrate:dev -- --name init'));
      console.log();
      console.log(cyan('    3 ') + 'Start the server');
      console.log(dim('      npm run dev'));
      console.log();
      console.log(bold('  CLIENT') + dim('  (new terminal)    cd ') + cyan(`${projectName}/client`));
      console.log();
      console.log(cyan('    4 ') + 'Start the client');
      console.log(dim('      npm install'));
      console.log(dim('      npm run dev'));
      console.log();
      console.log(line);
      console.log();
      console.log(dim('  App           ') + cyan('http://localhost:3000'));
      console.log(dim('  API           ') + cyan('http://localhost:8000'));
      console.log(dim('  phpMyAdmin    ') + cyan(`http://localhost:${variables.PHPMYADMIN_PORT}`));
      console.log(dim('  Redis CMD     ') + cyan(`http://localhost:${variables.REDIS_COMMANDER_PORT}`));
      console.log();
      console.log(line);
      console.log();
      console.log(dim('  Tip: ') + 'npm run docker:down' + dim(' to stop infrastructure'));
      console.log();
      console.log(dim('  Happy coding! 🚀'));
      console.log();
    });

  program.parse();
}

main();
