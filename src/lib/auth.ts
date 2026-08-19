import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { findUserByUsername } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import bcrypt from 'bcryptjs';

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
        if (!credentials?.username || !credentials?.password) {
          console.warn('[authorize] Missing username or password');
          return null;
        }

        const username = credentials.username;

        try {
          // Step 1: Init tables
          try {
            await initAuthTables();
          } catch (initErr) {
            console.error('[authorize] CRITICAL: initAuthTables failed:', initErr);
            // Store error globally for diagnostic endpoint to read
            (globalThis as any).__authLastError = {
              time: new Date().toISOString(),
              step: 'initAuthTables',
              error: initErr instanceof Error ? initErr.message : String(initErr),
            };
            return null;
          }

          // Step 2: Find user
          let user;
          try {
            user = await findUserByUsername(username);
          } catch (dbErr) {
            console.error('[authorize] CRITICAL: DB query failed for user', username, ':', dbErr);
            (globalThis as any).__authLastError = {
              time: new Date().toISOString(),
              step: 'findUserByUsername',
              username,
              error: dbErr instanceof Error ? dbErr.message : String(dbErr),
            };
            return null;
          }

          if (!user) {
            console.warn('[authorize] User not found:', username);
            return null;
          }

          // Step 3: Verify password
          let isPasswordValid: boolean;
          try {
            isPasswordValid = await bcrypt.compare(credentials.password, user.password);
          } catch (bcryptErr) {
            console.error('[authorize] CRITICAL: bcrypt.compare failed for user', username, ':', bcryptErr);
            (globalThis as any).__authLastError = {
              time: new Date().toISOString(),
              step: 'bcrypt_compare',
              username,
              error: bcryptErr instanceof Error ? bcryptErr.message : String(bcryptErr),
            };
            return null;
          }

          if (!isPasswordValid) {
            console.warn('[authorize] Invalid password for user:', username);
            return null;
          }

          console.log('[authorize] SUCCESS: user', username, 'logged in (role:', user.role, ')');
          return { id: user.id, name: user.username, email: user.email || undefined };
        } catch (err) {
          console.error('[authorize] UNHANDLED error for user', username, ':', err);
          (globalThis as any).__authLastError = {
            time: new Date().toISOString(),
            step: 'unhandled',
            username,
            error: err instanceof Error ? err.message : String(err),
          };
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
        if (user.email && !String(user.email).endsWith('@local')) {
          token.email = user.email;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).id = token.id;
        (session.user as any).username = token.username;
        if (token.email && !String(token.email).endsWith('@local')) {
          session.user.email = token.email as string;
        }
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET!,
};
