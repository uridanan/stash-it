import NextAuth, { type DefaultSession } from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import type {} from "next-auth/jwt";
import { prisma } from "@/lib/db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** Database User.id, set on sign-in. */
    uid?: string;
  }
}

const providers: Provider[] = [
  // Reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET from the environment automatically.
  Google,
];

// Dev-only login for local development and E2E tests. Never enable in prod.
if (process.env.AUTH_DEV_LOGIN === "true") {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Dev Login",
      credentials: {},
      async authorize() {
        return {
          id: "dev",
          email: "dev@example.com",
          name: "Dev User",
        };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  providers,
  callbacks: {
    async jwt({ token, user }) {
      // `user` is only present on sign-in; upsert our own User row by email
      // (JWT strategy, no adapter) and remember its id on the token.
      if (user?.email) {
        const dbUser = await prisma.user.upsert({
          where: { email: user.email },
          update: {
            name: user.name ?? undefined,
            image: user.image ?? undefined,
          },
          create: {
            email: user.email,
            name: user.name ?? null,
            image: user.image ?? null,
          },
        });
        token.uid = dbUser.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) {
        session.user.id = token.uid;
      }
      return session;
    },
  },
});
