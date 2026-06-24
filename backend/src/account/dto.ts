import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateTokenDto {
  @IsString()
  @IsOptional()
  label?: string;

  @IsInt()
  @Min(1)
  @Max(3650)
  @IsOptional()
  expiresInDays?: number;
}

export class SetActiveOrgDto {
  @IsString()
  @IsNotEmpty()
  organizationId: string;
}
