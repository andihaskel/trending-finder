// src/db/index.ts
import dotenv from 'dotenv';
dotenv.config();

import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { Sql } from 'postgres';
import * as schema from './schema';

// ───────────────────────────────────────────────────────────────────────────────
// Entorno
// ───────────────────────────────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL environment variable is required');

// Heurística: estamos en Lambda si AWS define el nombre de la función
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

// Si usás Supabase Pooling (puerto 6543), desactiva prepared statements.
const usingPgBouncer = /:6543\/|pooling/i.test(DATABASE_URL);

// ───────────────────────────────────────────────────────────────────────────────
// Reutilización global (beneficia Lambda y evita múltiples conexiones en hot reload)
// ───────────────────────────────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var __pg__: Sql | undefined;
  // eslint-disable-next-line no-var
  var __db__: PostgresJsDatabase<typeof schema> | undefined;
}

// ───────────────────────────────────────────────────────────────────────────────
// Config del cliente
//   - Local/server persistente: pool "normal" (max 10), sin trucos.
//   - Lambda: una sola conexión, SSL requerido, prepare:false si pgbouncer.
// ───────────────────────────────────────────────────────────────────────────────
const client =
  globalThis.__pg__ ??
  postgres(DATABASE_URL, {
    max: isLambda ? 1 : 10,
    idle_timeout: 20,
    connect_timeout: 30,
    // En Supabase suele ser necesario SSL. En local/contendedor puede no hacer falta,
    // pero 'require' no molesta si el server lo soporta.
    ssl: process.env.DB_SSL === 'disable' ? undefined : 'require',
    // Si estás usando el Connection Pooling de Supabase (pgbouncer), desactiva prepared statements
    prepare: usingPgBouncer ? false : undefined,
  });

export const db: PostgresJsDatabase<typeof schema> =
  globalThis.__db__ ?? drizzle(client, { schema });

if (!globalThis.__pg__) globalThis.__pg__ = client;
if (!globalThis.__db__) globalThis.__db__ = db;

export { schema };

// ───────────────────────────────────────────────────────────────────────────────
// Cierre elegante SOLO en entornos persistentes (no Lambda).
// En Lambda NO cierres la conexión o perdés el warm reuse.
// ───────────────────────────────────────────────────────────────────────────────
if (!isLambda) {
  const shutdown = async () => {
    try {
      await client.end();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
