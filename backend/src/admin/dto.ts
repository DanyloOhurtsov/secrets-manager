import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateIdentityDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(['human', 'service'])
  type: string;
}

export class IssueTokenDto {
  @IsString()
  @IsOptional()
  label?: string;
}

export class CreateGrantDto {
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
