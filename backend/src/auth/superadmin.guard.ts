import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class SuperadminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const identity = request.identity;

    if (!identity || !identity.isSuperadmin) {
      throw new ForbiddenException('Superadmin access required');
    }
    return true;
  }
}
