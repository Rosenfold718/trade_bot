import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db as prisma } from '@/lib/prisma-auth';
import { initAuthTables } from '@/lib/init-auth-tables';
import bcrypt from 'bcryptjs';

// Ensure auth tables exist on module load (fire-and-forget, safe due to IF NOT EXISTS)
initAuthTables().catch(err => console.error('[auth] Failed to init auth tables:', err));

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'credentials',
      credentials: {
        username: { label: 'Логин', type: 'text' },
        password: { label: 'Пароль', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        try {
          await initAuthTables();
          const user = await prisma.user.findUnique({
            where: { username: credentials.username },
          });

          if (!user) return null;

          const isPasswordValid = await bcrypt.compare(credentials.password, user.password);
          if (!isPasswordValid) return null;

          return { id: user.id, name: user.username, email: `${user.id}@local` };
        } catch (err) {
          console.error('[authorize] Error:', err);
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).id = token.id;
        (session.user as any).username = token.username;
      }
      return session;
    },
  },
  // NO pages config — we handle everything client-side
  secret: process.env.NEXTAUTH_SECRET || 'fallback-secret-change-in-production-32chars!!',
};
