import AppNav from "../AppNav";
import { requireUser } from "@/lib/auth";
import { logout } from "../actions";
import Notifications from "./Notifications";
import PasswordForm from "./PasswordForm";

export const metadata = { title: "Settings · Scale & Plate" };

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <main className="shell" style={{ display: "grid", gap: 16, alignContent: "start" }}>
      <AppNav name={user.name} />
      <section className="card" style={{ display: "grid", gap: 6 }}>
        <h2 style={{ fontSize: 16 }}>{user.name}</h2>
        <p className="muted">
          Program: {user.programMode === "classic" ? "Classic (calories and macros)" : "Noom-style"}.
          {" "}Switching programs arrives with the Noom-style mode in phase 4.
        </p>
      </section>
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 16 }}>Check-ins and notifications</h2>
        <Notifications publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} times={user.checkinTimes} />
      </section>
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 16 }}>Change password</h2>
        <PasswordForm />
      </section>
      <form action={logout}>
        <button className="btn">Sign out</button>
      </form>
    </main>
  );
}
