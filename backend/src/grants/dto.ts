import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

// canManageGrants НАВМИСНО відсутній у публічних DTO: керування грантами —
// площина org owner/admin, а не data-plane прапорець. Колись він давав делегату
// і grant CRUD, і доступ до аудиту проєкту — це self-escalation. Тепер authz на
// нього не спирається (див. authorization.service / admin.service), а API його
// не приймає; у БД колонка лишається (default false) лише для legacy-рядків.
export class CreateGrantDto {
  @IsString()
  @IsNotEmpty()
  identityId: string;

  // Проєкт обираємо в тілі запиту — гранти керуються з рівня організації
  // (POST /organizations/:organizationId/grants), а не з рівня проєкту.
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsIn(['viewer', 'reader', 'readonly', 'developer', 'admin'])
  role: string;

  @IsString()
  @IsOptional()
  environment?: string;

  @IsBoolean()
  @IsOptional()
  canRevealSecrets?: boolean;

  @IsBoolean()
  @IsOptional()
  canCreateSecrets?: boolean;

  @IsBoolean()
  @IsOptional()
  canUpdateSecrets?: boolean;

  @IsBoolean()
  @IsOptional()
  canDeleteSecrets?: boolean;

  @IsBoolean()
  @IsOptional()
  canRollbackSecrets?: boolean;
}

export class UpdateGrantDto {
  @IsIn(['viewer', 'reader', 'readonly', 'developer', 'admin'])
  @IsOptional()
  role?: string;

  // Скоуп можна перемикати на льоту: непорожнє значення (id або name оточення)
  // звужує грант до одного середовища, порожній рядок повертає на весь проєкт.
  // undefined — не чіпаємо скоуп узагалі (звичайне оновлення ролі/capability).
  @IsString()
  @IsOptional()
  environment?: string;

  @IsBoolean()
  @IsOptional()
  canRevealSecrets?: boolean;

  @IsBoolean()
  @IsOptional()
  canCreateSecrets?: boolean;

  @IsBoolean()
  @IsOptional()
  canUpdateSecrets?: boolean;

  @IsBoolean()
  @IsOptional()
  canDeleteSecrets?: boolean;

  @IsBoolean()
  @IsOptional()
  canRollbackSecrets?: boolean;
}
