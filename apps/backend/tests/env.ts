// Loaded by jest setupFiles — runs in the same V8 context as tests.
// Sets env vars before any module is imported so database URL etc are ready.
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Override for test-specific values
process.env.NODE_ENV = 'test';
process.env.STORAGE_PATH = path.join(__dirname, '..', 'uploads-test');
