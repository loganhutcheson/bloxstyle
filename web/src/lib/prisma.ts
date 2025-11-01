import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const baseClient = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

export const prisma: PrismaClient = globalForPrisma.prisma || baseClient;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;


