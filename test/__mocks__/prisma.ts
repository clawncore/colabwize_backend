/**
 * Shared Prisma mock factory for tests that import it directly.
 * The referral tests use inline mocks, so this file does not require a
 * third-party mock helper.
 */
import { PrismaClient } from "@prisma/client";

const prismaMock = {
  $transaction: jest.fn(),
  user: {
    findUnique: jest.fn(),
  },
  referral: {
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  subscription: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
} as unknown as PrismaClient;

export function resetPrismaMock() {
  jest.clearAllMocks();
}

export default prismaMock;
