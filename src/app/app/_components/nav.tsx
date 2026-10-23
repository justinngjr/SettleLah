"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/app/_ui";
import { isActiveNav, NAV_ITEMS } from "@/app/app/_lib/nav";

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex items-center gap-5 whitespace-nowrap text-sm sm:gap-7">
        {NAV_ITEMS.map((item) => {
          const active = isActiveNav(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx("inline-block py-3", active ? "font-medium text-ink underline underline-offset-8" : "text-ink-soft")}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
