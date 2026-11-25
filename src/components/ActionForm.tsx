"use client";
import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export type ActionResult = { ok: boolean; error?: string; message?: string; redirect?: string; data?: any } | null;

/** Generic form wrapper for server actions: pending state, error/success display, optional redirect & reset */
export function ActionForm({ action, children, className, submitLabel, submitClass = "btn-primary", reset, confirm, hideSubmit, onDone }: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>; children?: ReactNode; className?: string;
  submitLabel?: string; submitClass?: string; reset?: boolean; confirm?: string; hideSubmit?: boolean; onDone?: (r: ActionResult) => void;
}) {
  const [state, run, pending] = useActionState(action, null);
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state?.ok) return;
    if (state.redirect) router.push(state.redirect);
    else router.refresh();
    if (reset) ref.current?.reset();
    onDone?.(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    // Submitted via onSubmit (not the form's action attribute) so React does not clear what the user typed
    // when the server rejects the input; the form is reset only after success when `reset` is set.
    <form ref={ref} className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || (confirm && !window.confirm(confirm))) return;
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => run(fd));
      }}>
      {children}
      {state?.error && <div className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-200">{state.error}</div>}
      {state?.ok && state.message && <div className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">{state.message}</div>}
      {!hideSubmit && (
        <div className="mt-3">
          <button type="submit" className={submitClass} disabled={pending}>{pending ? "Working…" : submitLabel ?? "Save"}</button>
        </div>
      )}
    </form>
  );
}
