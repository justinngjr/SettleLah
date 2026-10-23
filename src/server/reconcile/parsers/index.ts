import "server-only";

import type { BankAlertParser, InboundEmail } from "../types";
import { dbsParser } from "./dbs";

/** Registered parsers, tried in order. Add other banks here. */
export const BANK_ALERT_PARSERS: readonly BankAlertParser[] = [dbsParser];

export function findParser(email: InboundEmail, parsers: readonly BankAlertParser[] = BANK_ALERT_PARSERS): BankAlertParser | null {
  return parsers.find((parser) => parser.canParse(email)) ?? null;
}

export { dbsParser };
