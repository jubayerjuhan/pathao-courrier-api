import { createApp } from './app.js';
import { buildContext } from './bootstrap.js';

async function main(): Promise<void> {
  const ctx = await buildContext();
  const app = createApp(ctx);

  const server = app.listen(ctx.config.port, () => {
    console.log(`Invoice dashboard on http://localhost:${ctx.config.port}`);
    console.log(`Pathao base URL: ${ctx.config.pathao.baseUrl}`);
  });

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(() => {
      ctx.db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
