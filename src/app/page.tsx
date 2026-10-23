import { redirect } from "next/navigation";

/** The host app lives under /app; the proxy sends signed-out visitors to /login. */
export default function Home() {
  redirect("/app");
}
