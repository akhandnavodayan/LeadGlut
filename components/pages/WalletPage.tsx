import { ReactNode } from "react";

export function WalletPage({ children }: { children: ReactNode }) {
  return <div data-page="wallet">{children}</div>;
}
