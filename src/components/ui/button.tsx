import * as React from "react";
import { cn } from "../../lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "glow";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const variantClasses = {
      default: "bg-slate-900 text-white shadow-sm hover:bg-slate-800 active:scale-[0.98]",
      destructive: "bg-rose-600 text-white shadow-xs hover:bg-rose-700 active:scale-[0.98]",
      outline: "border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 shadow-xs active:scale-[0.98]",
      secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200 active:scale-[0.98]",
      ghost: "hover:bg-slate-100 text-slate-700 hover:text-slate-900",
      link: "text-indigo-600 underline-offset-4 hover:underline",
      glow: "bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-500/25 hover:from-indigo-500 hover:to-blue-500 active:scale-[0.98]",
    }[variant];

    const sizeClasses = {
      default: "h-9 px-4 py-2 text-xs sm:text-sm",
      sm: "h-8 rounded-lg px-3 text-xs",
      lg: "h-11 rounded-xl px-6 text-sm sm:text-base font-semibold",
      icon: "h-9 w-9 p-0",
    }[size];

    return (
      <button
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none",
          variantClasses,
          sizeClasses,
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
