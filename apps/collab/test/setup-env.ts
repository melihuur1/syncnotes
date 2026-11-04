import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../../../.env.test'), quiet: true });
process.env.NODE_ENV = 'test';
