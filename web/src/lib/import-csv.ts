import { Importer, instapaperToRecords } from "@/lib/backup";
import { parseInstapaperCsv } from "@/lib/instapaper";
import type { ImportSummary } from "@/lib/backup";

export class CsvImportError extends Error {}

/**
 * Imports an Instapaper-style CSV. Read state always comes from the file;
 * collections follow the caller's choice.
 */
export async function importInstapaperText(
  userId: string,
  text: string,
  tags: "assign" | "import",
): Promise<ImportSummary & { rowsRead: number; rowsSkipped: number }> {
  const parsed = parseInstapaperCsv(text);
  if (parsed.rows.length === 0) {
    throw new CsvImportError("No usable rows found in that CSV");
  }

  const importer = new Importer(userId, { tags, updateReadingState: true });
  await importer.load();
  for (const record of instapaperToRecords(parsed.rows)) {
    await importer.add(record);
  }
  for (const skip of parsed.skipped.slice(0, 20)) {
    importer.note(`line ${skip.line}: ${skip.reason}`);
  }

  const summary = await importer.finish();
  return {
    ...summary,
    rowsRead: parsed.rows.length,
    rowsSkipped: parsed.skipped.length,
  };
}
