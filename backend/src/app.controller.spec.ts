import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('renders a human-friendly landing page without scripts', () => {
      const html = appController.getLandingPage();

      expect(html).toContain('<!doctype html>');
      expect(html).toContain('Secrets, delivered');
      expect(html).toContain('API surface');
      expect(html).toContain('href="api.css"');
      expect(html).not.toContain('<script');
    });

    it('serves the landing page stylesheet', () => {
      const css = appController.getLandingStyles();

      expect(css).toContain('.hero');
      expect(css).toContain('@media (max-width: 760px)');
    });

    it('describes the API as machine-readable metadata', () => {
      expect(appController.getInfo()).toEqual({
        name: 'Secrets Manager API',
        description:
          'Self-hosted API for encrypted secret storage and runtime secret injection.',
        version: expect.any(String),
        documentation:
          'https://github.com/DanyloOhurtsov/secrets-manager#readme',
        endpoints: {
          health: 'GET /health',
          info: 'GET /info',
          signup: 'POST /signup',
          login: 'POST /auth/login',
          currentIdentity: 'GET /auth/me',
          projects: 'GET /projects',
        },
      });
    });

    it('returns public liveness metadata', () => {
      expect(appController.getHealth()).toEqual({
        status: 'ok',
        service: 'secrets-manager-api',
        version: expect.any(String),
        timestamp: expect.any(String),
      });
    });
  });
});
