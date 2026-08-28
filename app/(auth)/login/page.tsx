import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  // The form reads ?next= through useSearchParams, which needs a
  // boundary or the whole route opts out of static rendering.
  return (
    <Suspense fallback={null}>
      <AuthForm mode="signin" />
    </Suspense>
  );
}
