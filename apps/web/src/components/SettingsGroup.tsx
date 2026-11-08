import type { ReactNode } from 'react';

export type SettingsGroupLayout = 'stack' | 'cards-2' | 'cards-3';

interface SettingsGroupProps {
  title: string;
  lead?: ReactNode;
  layout?: SettingsGroupLayout;
  children: ReactNode;
}

export function SettingsGroup({
  title,
  lead,
  layout = 'stack',
  children,
}: SettingsGroupProps) {
  return (
    <section className="settings-group">
      <h2 className="settings-group-title">{title}</h2>
      {lead ? <p className="settings-group-lead">{lead}</p> : null}
      <div className={`settings-group-body settings-group-body--${layout}`}>
        {children}
      </div>
    </section>
  );
}
