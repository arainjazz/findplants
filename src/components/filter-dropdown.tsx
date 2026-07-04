import { useEffect, useRef, useState } from "react";

export type OptionHover = { text: string; anchorId: string };
type Option = { value: string; label: string; hover?: OptionHover };

type Props = {
  label: string;
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  emptyLabel?: string;
  /** Fired when the pointer enters an option that carries hover info (or null on leave). */
  onOptionHover?: (hover: OptionHover | null) => void;
};

/** Hover-to-open dropdown with click-to-select; sticky once opened by click. */
export function FilterDropdown({ label, value, options, onChange, emptyLabel = "全部", onOptionHover }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  const cancelClose = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = value && options.find((o) => o.value === value);
  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`border border-ink px-3 py-2 text-sm transition-colors ${
          active ? "bg-ink text-background" : "hover:bg-paper-deep"
        }`}
      >
        {label}
        {active ? `：${active.label}` : ""}
        <span className="ml-1 text-xs opacity-70">▾</span>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full pt-1 z-50 min-w-[14rem] max-h-80 overflow-auto bg-background border border-ink shadow-lg py-1"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-paper-deep ${
              !value ? "font-semibold" : ""
            }`}
          >
            {emptyLabel}
          </button>
          <div className="border-t border-rule my-1" />
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-faint">暂无数据</div>
          ) : (
            options.map((o) => (
              <button
                key={o.value}
                type="button"
                onMouseEnter={() => onOptionHover?.(o.hover ?? null)}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-paper-deep ${
                  value === o.value ? "font-semibold text-vermilion" : ""
                }`}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}