import { ReactNode } from "react";

export function SettingsPage({ children }: { children: ReactNode }) {
  return <div data-page="settings">{children}</div>;
}
