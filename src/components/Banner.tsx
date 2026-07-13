type Props = {
  tone: "error" | "info";
  children: React.ReactNode;
};

/** Inline status banner. Error (red) for failures, info (amber) for the
 *  truncation / big-process note that bridges to the CTA. */
export default function Banner({ tone, children }: Props) {
  const styles =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border px-4 py-3 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}
