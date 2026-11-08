import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
  });
  app.enableShutdownHooks();
  app.setGlobalPrefix('api');
  app.useWebSocketAdapter(new WsAdapter(app));

  const webDist = join(__dirname, '../../web/dist');
  if (existsSync(webDist)) {
    app.useStaticAssets(webDist);
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (
        req.path.startsWith('/api') ||
        req.path.startsWith('/ws') ||
        req.path.startsWith('/socket.io')
      ) {
        return next();
      }
      res.sendFile(join(webDist, 'index.html'));
    });
  }

  // PORT=0 lets the OS assign an ephemeral port; HOST defaults to localhost.
  const requestedPort = Number(process.env.PORT ?? 0);
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(requestedPort, host);

  const address = app.getHttpServer().address();
  const port =
    typeof address === 'object' && address !== null ? address.port : requestedPort;
  console.log(`Karaokej listening on http://${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start Karaokej API:', err);
  process.exit(1);
});
