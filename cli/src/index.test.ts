import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProgram, resolveSpawnInvocation } from './index';

test('run passes child flags through when PowerShell removes the -- separator', async () => {
  const program = createProgram();
  const run = program.commands.find((command) => command.name() === 'run');
  assert.ok(run);

  let received:
    | { commandParts: string[]; environmentId: string }
    | undefined;
  run.action((commandParts: string[], opts: { env: string }) => {
    received = { commandParts, environmentId: opts.env };
  });

  await program.parseAsync(
    [
      'run',
      '-e',
      'env-123',
      'node',
      '-e',
      "console.log('child command')",
    ],
    { from: 'user' },
  );

  assert.deepEqual(received, {
    commandParts: ['node', '-e', "console.log('child command')"],
    environmentId: 'env-123',
  });
});

test('run launches npm through cmd.exe on Windows', () => {
  assert.deepEqual(
    resolveSpawnInvocation(
      'npm',
      ['start'],
      'win32',
      'C:\\Windows\\System32\\cmd.exe',
    ),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd', 'start'],
    },
  );
});

test('run preserves direct executables and non-Windows commands', () => {
  assert.deepEqual(resolveSpawnInvocation('node', ['app.js'], 'win32'), {
    command: 'node',
    args: ['app.js'],
  });
  assert.deepEqual(resolveSpawnInvocation('npm', ['start'], 'linux'), {
    command: 'npm',
    args: ['start'],
  });
});
