import Link from "next/link";

export default function BuyCancelPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2">Checkout canceled</h1>
        <p className="text-black/60 dark:text-white/60 mb-4">No charge was made.</p>
        <Link href="/buy" className="rounded-md bg-black text-white px-4 py-2 dark:bg-white dark:text-black">Try again</Link>
      </div>
    </div>
  );
}















