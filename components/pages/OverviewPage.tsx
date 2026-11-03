import { ReactNode } from "react";

export function OverviewPage({ children }: { children: ReactNode }) {
  return <div data-page="overview">{children}</div>;
}
