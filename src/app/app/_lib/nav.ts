/** The app nav. One array so adding a screen is a one-line change. */
export interface NavItem {
  readonly href: string;
  readonly label: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/app", label: "Home" },
  { href: "/app/receipts/new", label: "Log a receipt" },
  { href: "/app/friends", label: "Friends" },
  { href: "/app/inbox", label: "Inbox" },
  { href: "/app/recurring", label: "Recurring" },
  { href: "/app/agent", label: "Agent" },
  { href: "/app/settings", label: "Settings" },
];

export function isActiveNav(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}
