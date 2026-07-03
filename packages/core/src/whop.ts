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
