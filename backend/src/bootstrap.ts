import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, createHash } from 'node:crypto';

const TOKEN_PREFIX = 'sm_';

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  // Не плодимо дублів: якщо superadmin уже є — зупиняємось
  const existing = await prisma.identity.findFirst({
    where: { isSuperadmin: true },
  });

  if (existing) {
    console.log('\n=== BOOTSTRAP SKIPPED ===');
    console.log(
      `A superadmin already exists: ${existing.name} (${existing.id})`,
    );
    console.log('To issue a new token, use the admin API:');
    console.log(`  POST /admin/identities/${existing.id}/tokens`);
    console.log('Or reset the database to start fresh.');
    console.log('=========================\n');
    await prisma.$disconnect();
    return;
  }

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
