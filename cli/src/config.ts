import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
} from 'node:fs';

const CONFIG_DIR = join(homedir(), '.secrets-manager');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface Config {
  apiUrl?: string;
  token?: string;
}

// Записує конфіг за вказаним шляхом і ГАРАНТУЄ права 0600. Винесено окремо (з
// параметром шляху), щоб тести могли перевіряти права на тимчасовому файлі, не
// чіпаючи реальний ~/.secrets-manager/config.json.
export function writeConfigFileAt(filePath: string, config: Config): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, JSON.stringify(config, null, 2), { mode: 0o600 });
  // mode у writeFileSync діє ЛИШЕ при створенні файлу. Якщо config.json уже
  // існував із ширшими правами (напр. 0644) — явний chmod все одно звужує до 0600.
  chmodSync(filePath, 0o600);
}

export function saveConfig(config: Config): void {
  writeConfigFileAt(CONFIG_FILE, config);
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
