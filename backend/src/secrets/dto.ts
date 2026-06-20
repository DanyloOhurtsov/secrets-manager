import { IsString, IsNotEmpty } from 'class-validator';

export class CreateSecretDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  value: string;
}
