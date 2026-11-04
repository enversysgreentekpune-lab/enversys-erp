import Link from "next/link";
export default function Forbidden() {
  return (
    <div className="card mx-auto mt-16 max-w-md p-8 text-center">
      <div className="text-4xl">🔒</div>
      <h1 className="mt-2 text-lg font-semibold">Access restricted</h1>
      <p className="mt-1 text-sm text-slate-500">Your role does not have permission to view this page. Contact your administrator if you need access.</p>
      <Link href="/me" className="btn-primary mt-4">Go to my dashboard</Link>
    </div>
  );
}
