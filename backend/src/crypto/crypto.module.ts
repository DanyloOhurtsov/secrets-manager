import { Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { KeyProvider } from './key-provider.service';

@Module({
  providers: [CryptoService, KeyProvider],
  exports: [CryptoService, KeyProvider],
})
export class CryptoModule {}
