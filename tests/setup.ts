// Jest global setup — load .env before any test runs
import dotenv from 'dotenv';
dotenv.config({ path: '.env.example' });

// Silence logger noise during tests
process.env['LOG_LEVEL'] = 'error';
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'file:./test.db';
process.env['UPLOAD_DIR'] = './tests/fixtures/uploads';
process.env['TEMP_DIR'] = './tests/fixtures/tmp';
process.env['JWT_SECRET'] = 'test-jwt-secret-minimum-32-characters-long';
process.env['OCR_PROVIDER'] = 'google_vision';
