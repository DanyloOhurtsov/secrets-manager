import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';

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

  @IsIn(['readonly', 'developer', 'admin'])
  role: string;

  @IsString()
  @IsOptional()
  environment?: string;
}
