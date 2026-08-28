import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { authSetupProblem } from "@/lib/supabase/config";

export const metadata = { title: "Create account" };

export default function Page() {
  // Read on the server, where every variable is visible — including the
  // one that was named without the NEXT_PUBLIC_ prefix and is therefore
  // invisible to the form itself.
  const problem = authSetupProblem();

  return (
    <Suspense fallback={null}>
      <AuthForm mode="signup" setupProblem={problem} />
    </Suspense>
  );
}
