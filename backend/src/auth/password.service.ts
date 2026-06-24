import { Injectable } from '@nestjs/common';
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

@Injectable()
export class PasswordService {
  // Заздалегідь обчислений «фейковий» хеш для захисту від енумерації акаунтів за
  // таймінгом (L2). Пароль для нього — випадковий і НЕ належить жодному реальному
  // користувачу. Формат/параметри (scrypt, KEY_LENGTH) збігаються зі справжніми
  // хешами, тож verify() проти нього робить рівно таку саму роботу. Обчислюється
  // один раз при старті — ця вартість не входить у час відповіді на логін.
  private readonly dummyHash: Promise<string> = this.hash(
    randomBytes(32).toString('hex'),
  );

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
    return `scrypt$${salt}$${derived.toString('hex')}`;
  }

  async verify(password: string, storedHash: string): Promise<boolean> {
    const [algorithm, salt, hash] = storedHash.split('$');
    if (algorithm !== 'scrypt' || !salt || !hash) return false;

    const expected = Buffer.from(hash, 'hex');
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;

    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }

  // Виконує рівно таку саму роботу, що й verify(), але проти фейкового хеша, і
  // завжди повертає false. Викликається у login(), коли акаунта не існує, щоб час
  // відповіді не відрізнявся від випадку «акаунт є, але пароль невірний».
  async verifyAgainstDummyHash(password: string): Promise<boolean> {
    return this.verify(password, await this.dummyHash);
  }
}
