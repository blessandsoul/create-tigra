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
    .version('2.0.0')
    .argument('[project-name]', 'Name for your new project')
    .action(async (projectNameArg) => {
      console.log();
      console.log(chalk.bold('  Create Tigra') + chalk.dim(' v2.0.0'));
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

      // Derive all variables
      const variables = {
        PROJECT_NAME: projectName,
        PROJECT_NAME_SNAKE: toSnakeCase(projectName),
        PROJECT_DISPLAY_NAME: toTitleCase(projectName),
        DATABASE_NAME: `${toSnakeCase(projectName)}_db`,
        JWT_SECRET: crypto.randomBytes(48).toString('hex'),
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

        spinner.succeed('Project scaffolded successfully!');
      } catch (error) {
        spinner.fail('Failed to scaffold project');
        console.error(chalk.red(`\n  ${error.message}\n`));
        process.exit(1);
      }

      // Print next steps
      console.log();
      console.log(chalk.green.bold(`  Success!`) + ` Created ${chalk.cyan(projectName)} at ${chalk.dim(targetDir)}`);
      console.log();
      console.log(chalk.bold('  Next steps:'));
      console.log();
      console.log(chalk.cyan('  1.') + ' Start infrastructure:');
      console.log(chalk.dim(`     cd ${projectName}/server`));
      console.log(chalk.dim('     docker compose up -d'));
      console.log();
      console.log(chalk.cyan('  2.') + ' Install server dependencies & set up database:');
      console.log(chalk.dim('     npm install'));
      console.log(chalk.dim('     cp .env.example .env'));
      console.log(chalk.dim('     npm run prisma:generate'));
      console.log(chalk.dim('     npm run prisma:migrate:dev -- --name init'));
      console.log();
      console.log(chalk.cyan('  3.') + ' Start the server:');
      console.log(chalk.dim('     npm run dev'));
      console.log();
      console.log(chalk.cyan('  4.') + ` In a ${chalk.bold('new terminal')}, set up the client:`);
      console.log(chalk.dim(`     cd ${projectName}/client`));
      console.log(chalk.dim('     npm install'));
      console.log(chalk.dim('     cp .env.example .env'));
      console.log(chalk.dim('     npm run dev'));
      console.log();
      console.log(chalk.dim('  Server running at: ') + chalk.cyan('http://localhost:8000'));
      console.log(chalk.dim('  Client running at: ') + chalk.cyan('http://localhost:3000'));
      console.log();
      console.log(chalk.dim('  Happy coding!'));
      console.log();
    });

  program.parse();
}

main();
