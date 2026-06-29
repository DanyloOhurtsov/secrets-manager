import { PasswordService } from './password.service';

// L2: the dummy-hash path must do the same hashing work as a real verify so that
// unknown-email logins are indistinguishable by timing from wrong-password logins.
describe('PasswordService (L2 dummy-hash verification)', () => {
  let service: PasswordService;

  beforeEach(() => {
    service = new PasswordService();
  });

  it('hash() produces a scrypt hash with a 64-byte (128 hex) digest', async () => {
    const stored = await service.hash('correct horse');
    const [algorithm, salt, digest] = stored.split('$');
    expect(algorithm).toBe('scrypt');
    expect(salt).toHaveLength(32); // 16 random bytes, hex
    expect(digest).toHaveLength(128); // KEY_LENGTH=64 bytes, hex
  });

  it('verifyAgainstDummyHash() always returns false', async () => {
    await expect(service.verifyAgainstDummyHash('anything')).resolves.toBe(
      false,
    );
    await expect(service.verifyAgainstDummyHash('')).resolves.toBe(false);
  });

  it('verifies the dummy hash against the real scrypt verify path', async () => {
    // Spy on verify to confirm the dummy path reuses it with a properly-formed
    // scrypt hash that has the same digest length as real password hashes.
    const verifySpy = jest.spyOn(service, 'verify');

    await service.verifyAgainstDummyHash('pw');

    expect(verifySpy).toHaveBeenCalledTimes(1);
    const [password, dummyHash] = verifySpy.mock.calls[0];
    expect(password).toBe('pw');
    const [algorithm, salt, digest] = dummyHash.split('$');
    expect(algorithm).toBe('scrypt');
    expect(salt).toHaveLength(32);
    expect(digest).toHaveLength(128);
  });

  it('real verify() round-trips a hashed password', async () => {
    const stored = await service.hash('s3cret');
    await expect(service.verify('s3cret', stored)).resolves.toBe(true);
    await expect(service.verify('wrong', stored)).resolves.toBe(false);
  });
});
