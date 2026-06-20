import { IsString, IsNotEmpty } from 'class-validator';

export class CreateEnvironmentDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}
