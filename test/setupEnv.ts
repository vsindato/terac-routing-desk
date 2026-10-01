import "dotenv/config";

// Every test talks to the dedicated test database, never the dev one.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
