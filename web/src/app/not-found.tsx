import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <p className="text-5xl font-bold text-slate-300">404</p>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">
        Page not found
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        That page doesn&apos;t exist, or the article was deleted.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
      >
        Back to your list
      </Link>
    </main>
  );
}
