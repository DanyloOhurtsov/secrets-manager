import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

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

  @IsBoolean()
  @IsOptional()
  canManageGrants?: boolean;
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

  @IsBoolean()
  @IsOptional()
  canManageGrants?: boolean;
}
