process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://enversys:enversys@localhost:5432/enversys_test";
process.env.STORAGE_DIR = process.env.TEST_STORAGE_DIR ?? "./storage-test";
