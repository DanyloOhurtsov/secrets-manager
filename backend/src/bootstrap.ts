import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, createHash } from 'node:crypto';

const TOKEN_PREFIX = 'sm_';

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const identity = await prisma.identity.create({
    data: { name: 'bootstrap-admin', type: 'human', isSuperadmin: true },
  });

  const token = TOKEN_PREFIX + randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  await prisma.token.create({
    data: { identityId: identity.id, tokenHash, label: 'bootstrap' },
  });

  console.log('\n=== BOOTSTRAP SUPERADMIN CREATED ===');
  console.log('Identity ID:', identity.id);
  console.log('TOKEN (save it now, shown only once):');
  console.log(token);
  console.log('====================================\n');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Bootstrap failed:', e);
  process.exit(1);
});
