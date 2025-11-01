import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID || process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET || process.env.GOOGLE_CLIENT_SECRET || "",
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  secret: process.env.AUTH_SECRET,
  events: {
    async signIn({ user }) {
      const email = user?.email?.toLowerCase();
      if (!email) return;
      try {
        await prisma.credit.upsert({
          where: { email },
          update: {},
          create: { email, credits: 3 },
        });
      } catch {
        // ignore
      }
    },
  },
  callbacks: {
    async session({ session }) {
      try {
        const email = session.user?.email?.toLowerCase();
        if (!email) return session;
        const row = await prisma.credit.findUnique({ where: { email } });
        if (row) {
          // @ts-expect-error augment at runtime
          session.user.credits = row.credits;
        }
      } catch {
        // ignore
      }
      return session;
    },
  },
};


