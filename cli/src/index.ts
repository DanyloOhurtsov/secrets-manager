#!/usr/bin/env node
import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { saveConfig, loadConfig, getApiUrl, getToken } from './config';
import { buildSecretEnv, type FetchedSecret } from './secrets-env';

const WINDOWS_PACKAGE_MANAGER_SHIMS = new Set([
  'npm',
  'npx',
  'pnpm',
  'pnpx',
  'yarn',
  'yarnpkg',
]);

export interface SpawnInvocation {
  command: string;
  args: string[];
}

export function resolveSpawnInvocation(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comSpec = process.env.ComSpec ?? 'cmd.exe',
): SpawnInvocation {
  if (platform !== 'win32') return { command, args };

  const batchCommand = WINDOWS_PACKAGE_MANAGER_SHIMS.has(command.toLowerCase())
    ? `${command}.cmd`
    : /\.(cmd|bat)$/i.test(command)
      ? command
      : null;

  // Windows cannot execute .cmd/.bat shims directly. Invoke cmd.exe explicitly
  // instead of spawn({ shell: true }), which is deprecated with argument arrays.
  if (batchCommand) {
    return {
      command: comSpec,
      args: ['/d', '/s', '/c', batchCommand, ...args],
    };
  }

  return { command, args };
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('secrets')
    .description('CLI for the Secrets Manager')
    .version('0.1.0')
    // Required for passThroughOptions() on the `run` subcommand.
    .enablePositionalOptions();

  program
    .command('ping')
    .description('Check connection to the API')
    .action(async () => {
      const apiUrl = getApiUrl();
      try {
        const res = await fetch(`${apiUrl}/`);
        console.log(`✓ API reachable at ${apiUrl} (status ${res.status})`);
      } catch (err) {
        console.error(`✗ Cannot reach API at ${apiUrl}`);
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
      }
    });

  program
    .command('login')
    .description('Save your API token locally')
    .requiredOption('-t, --token <token>', 'API token (sm_...)')
    .option('-u, --url <url>', 'API URL')
    .action((opts: { token: string; url?: string }) => {
      const current = loadConfig();
      saveConfig({ apiUrl: opts.url ?? current.apiUrl, token: opts.token });
      console.log('✓ Token saved to ~/.secrets-manager/config.json');
    });

  program
    .command('whoami')
    .description('Check current token')
    .action(() => {
      const token = getToken();
      if (!token) {
        console.log('Not logged in. Run: secrets login --token <token>');
        return;
      }
      console.log(`Logged in (token: ${token.slice(0, 8)}...)`);
    });

  program
    .command('run')
    .description('Run a command with secrets injected as env variables')
    .requiredOption(
      '-e, --env <environmentId>',
      'Environment ID to load secrets from',
    )
    .argument('<command...>', 'Command to run (after --)')
    // PowerShell consumes `--` before invoking npm's .ps1 shim. Stop parsing CLI
    // options after the child command so flags such as `node -e` still pass through.
    .passThroughOptions()
    .action(async (commandParts: string[], opts: { env: string }) => {
      const apiUrl = getApiUrl();
      const token = getToken();

      if (!token) {
        console.error('Not logged in. Run: secrets login --token <token>');
        process.exitCode = 1;
        return;
      }

      // 1. Тягнемо секрети з API
      let secrets: FetchedSecret[];
      try {
        const res = await fetch(
          `${apiUrl}/environments/${opts.env}/secrets?reveal=true`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!res.ok) {
          let detail = '';
          try {
            const body = (await res.json()) as {
              message?: string | string[];
            };
            const message = Array.isArray(body.message)
              ? body.message.join(', ')
              : body.message;
            if (message) detail = `: ${message}`;
          } catch {
            // Non-JSON error responses still include the HTTP status below.
          }
          console.error(
            `✗ Failed to fetch secrets (status ${res.status}${detail})`,
          );
          if (res.status === 404) {
            console.error(
              '  Check the environment ID and this token’s project/environment grant.',
            );
          }
          process.exitCode = 1;
          return;
        }
        secrets = (await res.json()) as FetchedSecret[];
      } catch (err) {
        console.error(`✗ Cannot reach API at ${apiUrl}`);
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
        return;
      }

      // 2. Будуємо оточення: поточне + лише секрети з реальним значенням.
      // Секрети з value: null (немає дозволу reveal) пропускаємо — інакше в env
      // потрапив би рядок "null".
      const { env: secretEnv, injected, skipped } = buildSecretEnv(secrets);
      const childEnv = { ...process.env, ...secretEnv };

      if (skipped > 0) {
        console.error(
          `⚠ Skipped ${skipped} secret(s) without reveal permission.`,
        );
      }
      console.error(`✓ Injected ${injected} secret(s)`);

      // 3. Запускаємо дочірній процес
      const [cmd, ...args] = commandParts;
      const invocation = resolveSpawnInvocation(cmd, args);
      const child = spawn(invocation.command, invocation.args, {
        env: childEnv,
        stdio: 'inherit', // вивід дочірньої команди йде прямо в термінал
      });

      // 4. Прокидаємо код виходу без примусового process.exit(): він може
      // закрити активні libuv handles під час fetch cleanup на Windows.
      child.on('exit', (code) => {
        process.exitCode = code ?? 0;
      });
      child.on('error', (err) => {
        console.error(`✗ Failed to start command: ${err.message}`);
        process.exitCode = 1;
      });
    });

  return program;
}

if (require.main === module) {
  void createProgram().parseAsync();
}
