import { Injectable } from '@nestjs/common';

export interface ApiInfo {
  name: string;
  description: string;
  version: string;
  documentation: string;
  endpoints: {
    health: string;
    info: string;
    signup: string;
    login: string;
    currentIdentity: string;
    projects: string;
  };
}

export interface ApiHealth {
  status: 'ok';
  service: string;
  version: string;
  timestamp: string;
}

@Injectable()
export class AppService {
  private readonly version = process.env.APP_VERSION || 'development';

  getInfo(): ApiInfo {
    return {
      name: 'Secrets Manager API',
      description:
        'Self-hosted API for encrypted secret storage and runtime secret injection.',
      version: this.version,
      documentation: 'https://github.com/DanyloOhurtsov/secrets-manager#readme',
      endpoints: {
        health: 'GET /health',
        info: 'GET /info',
        signup: 'POST /signup',
        login: 'POST /auth/login',
        currentIdentity: 'GET /auth/me',
        projects: 'GET /projects',
      },
    };
  }

  getHealth(): ApiHealth {
    return {
      status: 'ok',
      service: 'secrets-manager-api',
      version: this.version,
      timestamp: new Date().toISOString(),
    };
  }
}
