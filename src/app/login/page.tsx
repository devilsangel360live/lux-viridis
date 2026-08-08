import { redirect } from "next/navigation";

import { getCurrentUser, needsSetup } from "@/server/auth";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  return <LoginForm setup={await needsSetup()} />;
}
