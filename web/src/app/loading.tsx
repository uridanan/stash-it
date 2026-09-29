export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <span
        aria-label="Loading"
        role="status"
        className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-violet-600"
      />
    </main>
  );
}
