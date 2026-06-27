import type { NextAuthConfig, DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

declare module "next-auth" {
  interface User {
    role?: string;
    locale?: string;
  }
  interface Session {
    user: {
      id: string;
      role?: string;
      locale?: string;
    } & DefaultSession["user"];
  }
}

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authConfig = {
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = LoginSchema.safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;

          const user = await db.user.findUnique({
            where: { email },
          });

          if (!user || !user.passwordHash) return null;

          const passwordsMatch = await bcrypt.compare(password, user.passwordHash);

          if (passwordsMatch) {
            return {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
              locale: user.locale,
            };
          }
        }

        return null;
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // On sign-in / sign-up: hydrate the token with the freshly loaded user.
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.locale = user.locale;
      }

      // On a client-triggered session update (useSession().update /
      // unstable_update) — persist the new locale claim so middleware and
      // Server Components pick it up without a full re-login (Requirement 2.2,
      // 2.6). `session` is unvalidated client data; whitelist the locale.
      if (trigger === "update" && session?.user?.locale) {
        const nextLocale = session.user.locale;
        if (nextLocale === "EN" || nextLocale === "ID") {
          token.locale = nextLocale;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.locale = token.locale as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
