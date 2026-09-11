import { env } from './runtime.node.mjs';
const database = env.PUZZLE_DB;
const check = database.sql.prepare('PRAGMA quick_check').get();
if (Object.values(check)[0] !== 'ok') throw new Error('Database integrity check failed');
database.close();
console.log('Puzzle migrations and database integrity verified.');
