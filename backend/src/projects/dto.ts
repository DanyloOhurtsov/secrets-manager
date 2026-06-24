import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  organizationId?: string;
}

export class TransferProjectDto {
  @IsString()
  @IsNotEmpty()
  targetOrganizationId: string;
}
