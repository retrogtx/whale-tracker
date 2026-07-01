import Whop from "@whop/sdk";

export function createWhopClient(apiKey: string, baseURL: string | undefined): Whop {
  return new Whop({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
}

export type WhopClient = Whop;
