import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';

const CONFIG_DIR = join(homedir(), '.secrets-manager');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface Config {
  apiUrl?: string;
  token?: string;
}

export function saveConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // mode 0o600 — читати/писати може лише власник
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as Config;
  } catch {
    return {};
  }
}

export function getApiUrl(): string {
  return (
    process.env.SECRETS_API_URL ??
    loadConfig().apiUrl ??
    'http://localhost:3000'
  );
}

export function getToken(): string | undefined {
  return process.env.SECRETS_TOKEN ?? loadConfig().token;
}
