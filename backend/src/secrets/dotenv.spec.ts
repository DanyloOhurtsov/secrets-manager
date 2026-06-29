import { parseDotenv } from './dotenv';

describe('parseDotenv', () => {
  it('parses simple KEY=VALUE lines', () => {
    const { entries, errors } = parseDotenv('FOO=bar\nBAZ=qux');
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      { key: 'FOO', value: 'bar' },
      { key: 'BAZ', value: 'qux' },
    ]);
  });

  it('skips blank lines and comments', () => {
    const { entries } = parseDotenv('# a comment\n\nFOO=bar\n   \n# another');
    expect(entries).toEqual([{ key: 'FOO', value: 'bar' }]);
  });

  it('strips the optional export prefix', () => {
    const { entries } = parseDotenv('export FOO=bar');
    expect(entries).toEqual([{ key: 'FOO', value: 'bar' }]);
  });

  it('strips double quotes and processes escapes', () => {
    const { entries } = parseDotenv('FOO="line1\\nline2"');
    expect(entries).toEqual([{ key: 'FOO', value: 'line1\nline2' }]);
  });

  it('strips single quotes literally (no escape processing)', () => {
    const { entries } = parseDotenv("FOO='a\\nb'");
    expect(entries).toEqual([{ key: 'FOO', value: 'a\\nb' }]);
  });

  it('keeps values that contain = signs', () => {
    const { entries } = parseDotenv('TOKEN=ab=cd=ef');
    expect(entries).toEqual([{ key: 'TOKEN', value: 'ab=cd=ef' }]);
  });

  it('allows empty values', () => {
    const { entries } = parseDotenv('EMPTY=');
    expect(entries).toEqual([{ key: 'EMPTY', value: '' }]);
  });

  it('de-duplicates keys, last value wins', () => {
    const { entries } = parseDotenv('FOO=one\nFOO=two');
    expect(entries).toEqual([{ key: 'FOO', value: 'two' }]);
  });

  it('reports invalid keys with a line number', () => {
    const { errors } = parseDotenv('1BAD=x');
    expect(errors).toEqual(['Line 1: invalid key "1BAD"']);
  });

  it('reports lines without an = as errors', () => {
    const { errors } = parseDotenv('FOO');
    expect(errors).toEqual(['Line 1: expected KEY=VALUE']);
  });
});
