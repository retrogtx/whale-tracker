import Whop from "@whop/sdk";

export function createWhopClient(apiKey: string, baseURL: string | undefined): Whop {
  return new Whop({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
}

export type WhopClient = Whop;

export interface WhopAccount {
  id: string;
  title: string | null;
  type: "business" | "personal";
}

interface AccountRow {
  id?: string;
  title?: string | null;
}

function toAccount(row: AccountRow): WhopAccount | null {
  if (!row?.id) return null;
  return { id: row.id, title: row.title ?? null, type: row.id.startsWith("user_") ? "personal" : "business" };
}

/** Discover the accounts a credential can act on (business + connected personal). */
export async function listAccounts(whop: WhopClient): Promise<WhopAccount[]> {
  const found = new Map<string, WhopAccount>();
  const add = (row: AccountRow | undefined) => {
    const acct = row ? toAccount(row) : null;
    if (acct) found.set(acct.id, acct);
  };
  const probe = async (path: string, pick: (res: unknown) => void) => {
    try {
      pick(await whop.get(path));
    } catch (err) {
      console.error(`[discoverAccounts] ${path} failed:`, err instanceof Error ? err.message : err);
    }
  };

  // Connected accounts the key can act on (business key → its business + connected).
  await probe("/accounts", (res) => {
    const rows = Array.isArray(res) ? res : ((res as { data?: AccountRow[] })?.data ?? []);
    for (const row of rows) add(row);
  });
  // The requesting business account itself.
  await probe("/accounts/me", (res) => add(res as AccountRow));
  // The personal /finance account — this is the user_ ID.
  await probe("/users/me", (res) => add(res as AccountRow));

  console.error(`[discoverAccounts] resolved ${found.size} account(s):`, [...found.keys()]);
  return [...found.values()];
}

interface BalanceRow {
  symbol?: string;
  balance?: string | number;
  breakdown?: { available?: string | number } | null;
}

function extractTokens(res: unknown): string[] {
  const obj = (res ?? {}) as { balances?: unknown; wallet?: { balances?: unknown } };
  const rows = Array.isArray(obj.balances)
    ? obj.balances
    : Array.isArray(obj.wallet?.balances)
      ? obj.wallet.balances
      : [];
  const tokens: string[] = [];
  for (const row of rows as BalanceRow[]) {
    const symbol = row?.symbol;
    const available = Number(row?.breakdown?.available ?? row?.balance ?? 0);
    if (symbol && Number.isFinite(available) && available > 0) tokens.push(symbol);
  }
  return tokens;
}

/** Token symbols the account actually holds (positive available balance). */
export async function fetchAccountTokens(whop: WhopClient, accountId: string): Promise<string[]> {
  try {
    const res = await whop.get(`/accounts/${accountId}`);
    const tokens = extractTokens(res);
    console.error(
      `[balances] ${accountId}:`,
      tokens.length ? tokens : `(none) raw=${JSON.stringify(res).slice(0, 600)}`,
    );
    return tokens;
  } catch (err) {
    console.error(`[balances] ${accountId} failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}
