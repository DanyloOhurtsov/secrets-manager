import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class UpdateOrganizationDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class AddMemberDto {
  @IsEmail()
  email: string;

  @IsIn(['member', 'admin'])
  @IsOptional()
  role?: string;
}

export class ChangeMemberRoleDto {
  @IsIn(['member', 'admin'])
  role: string;
}

export class TransferOwnershipDto {
  @IsString()
  @IsNotEmpty()
  identityId: string;
}
