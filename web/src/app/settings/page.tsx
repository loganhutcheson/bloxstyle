import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/signin?callbackUrl=%2Fsettings");
  }
  const user = session.user;

  return (
    <div className="min-h-screen w-full p-6">
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>
      <div className="max-w-xl rounded-md border border-black/10 dark:border-white/10 p-4">
        <h2 className="text-lg font-medium mb-3">User</h2>
        <div className="flex items-center gap-3">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt={user.name || user.email || "user"} className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <div className="h-12 w-12 rounded-full bg-black/20 dark:bg-white/20 flex items-center justify-center">
              <span className="text-base">{(user.name || user.email || "?")?.slice(0, 1).toUpperCase()}</span>
            </div>
          )}
          <div>
            <div className="text-sm">{user.name || "Unnamed"}</div>
            <div className="text-sm text-black/60 dark:text-white/60">{user.email}</div>
          </div>
        </div>
      </div>
    </div>
  );
}


