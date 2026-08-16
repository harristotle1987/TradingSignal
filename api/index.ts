import { createServer } from '../server.js';

let cachedApp: any = null;

export default async function handler(req: any, res: any) {
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'production';
  }

  if (!cachedApp) {
    cachedApp = await createServer();
  }
  return cachedApp(req, res);
}
