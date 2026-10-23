import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/* Quiet Editorial primitives. See DESIGN.md. */

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "tertiary";

const BUTTON_BASE =
  "motion inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-base no-underline disabled:cursor-not-allowed";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper disabled:bg-paper-sunken disabled:text-ink-mute",
  secondary: "border border-line bg-transparent text-ink disabled:text-ink-mute",
  tertiary: "min-h-0 px-0 underline underline-offset-4 text-ink disabled:text-ink-mute",
};

export function Arrow() {
  return <span aria-hidden="true">→</span>;
}

export interface ButtonProps extends ComponentProps<"button"> {
  readonly variant?: ButtonVariant;
  /** Trailing arrow glyph; on by default for primary/secondary. */
  readonly arrow?: boolean;
}

export function Button({ variant = "primary", arrow = variant !== "tertiary", className, children, ...rest }: ButtonProps) {
  return (
    <button type={rest.type ?? "button"} className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], className)} {...rest}>
      {children}
      {arrow ? <Arrow /> : null}
    </button>
  );
}

export interface ButtonLinkProps extends ComponentProps<typeof Link> {
  readonly variant?: ButtonVariant;
  readonly arrow?: boolean;
}

export function ButtonLink({ variant = "primary", arrow = variant !== "tertiary", className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], className)} {...rest}>
      {children}
      {arrow ? <Arrow /> : null}
    </Link>
  );
}

/** A disabled action never goes unexplained. */
export function DisabledReason({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-mute">{children}</p>;
}

export function Label({ htmlFor, children, className }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cx("label block", className)}>
      {children}
    </label>
  );
}

export interface FieldProps extends ComponentProps<"input"> {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: string | null;
}

export function Field({ label, hint, error, id, className, ...rest }: FieldProps) {
  const inputId = id ?? rest.name;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cx("space-y-2", className)}>
      <Label htmlFor={inputId}>{label}</Label>
      <input
        id={inputId}
        className="field"
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-ink-mute">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface TextareaFieldProps extends ComponentProps<"textarea"> {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
}

export function TextareaField({ label, hint, id, className, ...rest }: TextareaFieldProps) {
  const inputId = id ?? rest.name;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className={cx("space-y-2", className)}>
      <Label htmlFor={inputId}>{label}</Label>
      <textarea id={inputId} className="field" aria-describedby={hintId} {...rest} />
      {hint ? (
        <p id={hintId} className="text-sm text-ink-mute">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface SelectFieldProps extends ComponentProps<"select"> {
  readonly label: ReactNode;
}

export function SelectField({ label, id, className, children, ...rest }: SelectFieldProps) {
  const inputId = id ?? rest.name;
  return (
    <div className={cx("space-y-2", className)}>
      <Label htmlFor={inputId}>{label}</Label>
      <select id={inputId} className="field" {...rest}>
        {children}
      </select>
    </div>
  );
}

export function Card({ children, className, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cx("rounded-xl border border-line bg-paper-raised p-6", className)} {...rest}>
      {children}
    </div>
  );
}

/** The one big number (or phrase) per screen. */
export function Statement({ label, children, className }: { label?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx("space-y-3", className)}>
      {label ? <p className="label">{label}</p> : null}
      <p className="statement">{children}</p>
    </div>
  );
}

export function PageIntro({
  label,
  title,
  children,
}: {
  label?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="space-y-8">
      <div className="space-y-3">
        {label ? <p className="label">{label}</p> : null}
        <h1 className="statement">{title}</h1>
      </div>
      {children ? <div className="measure text-ink-soft">{children}</div> : null}
    </header>
  );
}

export function Section({ title, meta, children, className }: { title?: ReactNode; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("hairline space-y-8 pt-8", className)}>
      {title || meta ? (
        <div className="flex items-baseline justify-between gap-6">
          {title ? <h2 className="heading">{title}</h2> : <span />}
          {meta ? <p className="label">{meta}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="space-y-6 rounded-xl border border-line p-6">
      <p className="measure text-ink-soft">{children}</p>
      {action}
    </div>
  );
}

export function Notice({ children, role = "status" }: { children: ReactNode; role?: "status" | "alert" }) {
  return (
    <p role={role} className="measure rounded-lg border border-line bg-paper-sunken px-4 py-3 text-sm text-ink">
      {children}
    </p>
  );
}

export function Loading({ children = "Loading…" }: { children?: ReactNode }) {
  return <p className="text-sm text-ink-mute">{children}</p>;
}

/** Key/value rows with mono amounts. */
export function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-line">{children}</dl>;
}

export function Row({ term, children, strong }: { term: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-6 py-3", strong && "text-lg")}>
      <dt className={cx(strong ? "text-ink" : "text-ink-soft")}>{term}</dt>
      <dd className={cx("amount text-right", strong && "text-lg")}>{children}</dd>
    </div>
  );
}
