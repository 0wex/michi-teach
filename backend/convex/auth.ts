import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile: (params) => {
        const email = params.email as string;
        const profile: { email: string; name?: string } = { email };
        if (typeof params.name === "string" && params.name.trim()) {
          profile.name = params.name.trim();
        }
        return profile;
      },
    }),
    Anonymous,
  ],
});
