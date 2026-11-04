import path from 'node:path';
import { config } from 'dotenv';

// Integration tests run against the dedicated `syncnotes_test` database.
// Explicitly provided env vars (e.g. CI service containers) take precedence.
config({ path: path.resolve(__dirname, '../../../.env.test'), quiet: true });
process.env.NODE_ENV = 'test';
