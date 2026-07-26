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

  const token = TOKEN_PREFIX + randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  // Identity і Token створюємо ОДНІЄЮ транзакцією. Раніше це були два окремі
  // запити, і збій між ними лишав superadmin без жодного токена: повторний
  // запуск бачив existing і друкував BOOTSTRAP SKIPPED, а видати новий токен
  // можна лише через /admin, куди без токена не зайти. Тупик, з якого виходили
  // тільки скиданням БД. Як Job (60-bootstrap-job.yaml) скрипт ще й
  // перезапускається автоматично, тож цей стан став реально досяжним.
  const identity = await prisma.$transaction(async (tx) => {
    const created = await tx.identity.create({
      data: { name: 'bootstrap-admin', type: 'human', isSuperadmin: true },
    });

    await tx.token.create({
      data: { identityId: created.id, tokenHash, label: 'bootstrap' },
    });

    return created;
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
