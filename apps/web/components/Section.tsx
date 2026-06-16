import type { ReactNode } from "react";

interface SectionProps {
  id: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function Section({ id, title, subtitle, children }: SectionProps) {
  return (
    <section id={id} className="section">
      <div className="section-heading">
        <p className="eyebrow">{id}</p>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </section>
  );
}