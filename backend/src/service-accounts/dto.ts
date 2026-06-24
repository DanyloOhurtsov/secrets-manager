import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateServiceAccountDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class CreateServiceAccountTokenDto {
  @IsString()
  @IsOptional()
  label?: string;

  @IsInt()
  @Min(1)
  @Max(3650)
  @IsOptional()
  expiresInDays?: number;
}
