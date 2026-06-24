import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class CreateSecretDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  value: string;
}

export class UpdateSecretDto {
  @IsString()
  @IsNotEmpty()
  value: string;
}

export class RollbackSecretDto {
  @IsInt()
  @Min(1)
  toVersion: number;
}
