#!/usr/bin/env node
import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { saveConfig, loadConfig, getApiUrl, getToken } from './config';

const program = new Command();

program
  .name('secrets')
  .description('CLI for the Secrets Manager')
  .version('0.1.0');

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
      process.exit(1);
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
  .requiredOption('-e, --env <environmentId>', 'Environment ID to load secrets from')
  .argument('<command...>', 'Command to run (after --)')
  .action(async (commandParts: string[], opts: { env: string }) => {
    const apiUrl = getApiUrl();
    const token = getToken();

    if (!token) {
      console.error('Not logged in. Run: secrets login --token <token>');
      process.exit(1);
    }

    // 1. Тягнемо секрети з API
    let secrets: Array<{ key: string; value: string }>;
    try {
      const res = await fetch(
        `${apiUrl}/environments/${opts.env}/secrets?reveal=true`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        console.error(`✗ Failed to fetch secrets (status ${res.status})`);
        process.exit(1);
      }
      secrets = await res.json();
    } catch (err) {
      console.error('✗ Cannot reach API');
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }

    // 2. Будуємо оточення: поточне + секрети
    const childEnv = { ...process.env };
    for (const s of secrets) {
      childEnv[s.key] = s.value;
    }

    console.error(`✓ Injected ${secrets.length} secret(s)`);

    // 3. Запускаємо дочірній процес
    const [cmd, ...args] = commandParts;
    const child = spawn(cmd, args, {
      env: childEnv,
      stdio: 'inherit', // вивід дочірньої команди йде прямо в термінал
    });

    // 4. Прокидаємо код виходу
    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
    child.on('error', (err) => {
      console.error(`✗ Failed to start command: ${err.message}`);
      process.exit(1);
    });
  });

program.parse();
