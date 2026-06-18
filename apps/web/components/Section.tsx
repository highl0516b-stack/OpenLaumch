import type { ReactNode } from "react";

type SectionProps = {
  id: string;
  title: string;
  subtitle: string;
  children: ReactNode;
};

export function Section({ id, title, subtitle, children }: SectionProps) {
  return (
    <section id={id} className="section">
      <div className="section-heading">
        <p className="section-kicker">OpenLaunch</p>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </section>
  );
}
