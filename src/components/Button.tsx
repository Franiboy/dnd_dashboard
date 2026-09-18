import { type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type ButtonBaseProps = {
  variant?: 'ghost' | 'danger' | 'accent' | 'secondary' | 'warning';
  icon?: ReactNode;
  children?: ReactNode;
};

type AsButton = ButtonBaseProps & { as?: 'button' } & ButtonHTMLAttributes<HTMLButtonElement>;
type AsLink = ButtonBaseProps & { as: 'a' } & Omit<LinkProps, 'to'> & {
    href?: string;
    to?: LinkProps['to'];
  };
type AsAnchor = ButtonBaseProps & { as: 'anchor' } & AnchorHTMLAttributes<HTMLAnchorElement>;

type ButtonProps = AsButton | AsLink | AsAnchor;

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  ghost: 'bg-transparent text-slate-400 hover:text-[var(--text-h)] hover:bg-slate-800/50',
  danger: 'bg-[var(--danger)]/20 text-[var(--danger)] hover:bg-[var(--danger)]/30',
  // The accent-2 gradient collapses to a solid accent for the default theme
  // and only shows the complementary tone for dynamic user themes.
  accent:
    'bg-[linear-gradient(120deg,var(--accent),var(--accent-2))] text-[var(--accent-contrast)] hover:brightness-110',
  secondary: 'bg-slate-700 text-[var(--text-h)] hover:bg-slate-600',
  warning: 'bg-[var(--warning)] text-slate-900 hover:brightness-110',
};

export function Button({
  variant = 'ghost',
  icon,
  children,
  as = 'button',
  className = '',
  ...props
}: ButtonProps) {
  const baseClasses =
    'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
  const styleClasses = variantClasses[variant];

  const content = (
    <>
      {icon}
      {children}
    </>
  );

  const classNames = `${baseClasses} ${styleClasses} ${className}`.trim();

  if (as === 'a') {
    const { to, href, ...rest } = props as AsLink;
    if (to)
      return (
        <Link to={to} className={classNames} {...rest}>
          {content}
        </Link>
      );
    if (href)
      return (
        <a
          href={href}
          className={classNames}
          {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
        >
          {content}
        </a>
      );
  }

  if (as === 'anchor') {
    const { href, ...rest } = props as AsAnchor;
    return (
      <a href={href} className={classNames} {...rest}>
        {content}
      </a>
    );
  }

  const { type, disabled, onClick, ...buttonProps } = props as AsButton;
  return (
    <button
      type={type || 'button'}
      disabled={disabled}
      onClick={onClick}
      className={classNames}
      {...buttonProps}
    >
      {content}
    </button>
  );
}
