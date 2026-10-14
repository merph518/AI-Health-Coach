"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./nav.module.css";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/coach", label: "Coach" },
  { href: "/settings", label: "Settings" },
];

export default function AppNav({ name }: { name: string }) {
  const path = usePathname();
  return (
    <header className={styles.header}>
      <div>
        <strong className={styles.brand}>Scale &amp; Plate</strong>
        <span className="muted"> · {name}</span>
      </div>
      <nav className={styles.nav} aria-label="Main">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
