import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeConfigFileAt } from './config';

// Працюємо у тимчасовій теці, щоб НЕ чіпати реальний ~/.secrets-manager/config.json.

test('writeConfigFileAt creates the config file with 0600 permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-cli-'));
  const file = join(dir, 'config.json');
  try {
    writeConfigFileAt(file, { apiUrl: 'http://localhost:3000', token: 'sm_fake' });
    const mode = statSync(file).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeConfigFileAt tightens an already-existing file with looser (0644) permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-cli-'));
  const file = join(dir, 'config.json');
  try {
    // Передіснуючий config.json із ширшими правами.
    writeFileSync(file, '{}');
    chmodSync(file, 0o644);
    assert.equal(statSync(file).mode & 0o777, 0o644, 'precondition: file is 0644');

    writeConfigFileAt(file, { token: 'sm_fake' });

    assert.equal(
      statSync(file).mode & 0o777,
      0o600,
      'config must be tightened to 0600 even if it already existed',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
