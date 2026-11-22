"use client";
export function PrintButton() {
  return (
    <button
      type="button"
      className="border rounded px-3 py-2 print:hidden"
      onClick={() => window.print()}
    >
      Print / Save PDF
    </button>
  );
}
